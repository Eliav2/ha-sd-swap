import { $ } from "bun";
import { findDataPartition, getPartitionGeometry } from "./injector.ts";

const DATA_MOUNT = "/mnt/newsd";
const LOOP_DEV = "/dev/loop0";
const DIND_SOCK = "/run/dind.sock";

// Map uname -m to the HA supervisor image arch prefix
const ARCH_MAP: Record<string, string> = { aarch64: "aarch64", x86_64: "amd64" };
const rawArch = (await $`uname -m`.text()).trim();
const SUPERVISOR_ARCH = ARCH_MAP[rawArch] ?? rawArch;
const SUPERVISOR_IMAGE = `ghcr.io/home-assistant/${SUPERVISOR_ARCH}-hassio-supervisor:latest`;

// HA Core gets 172.30.32.1 (first available); Supervisor is pinned to .2 via --ip.
// The Supervisor hardcodes 172.30.32.1 as the homeassistant container IP, so
// homeassistant must claim that address. We poll HA Core at .1:8123.
const SUPERVISOR_IP = "172.30.32.1";

// Module-level state for the "user is done" deferred and proxy URL
let sandboxDoneResolve: (() => void) | null = null;
let sandboxProxyUrl: string | null = null;

/** Called by POST /api/sandbox/done — signals the sandbox that the user finished restoring. */
export function signalSandboxDone(): void {
  sandboxDoneResolve?.();
}

/** Returns the URL of the running HA Core instance for proxying, or null if not ready. */
export function getSandboxProxyUrl(): string | null {
  return sandboxProxyUrl;
}

/** Set up loop device for the data partition (page cache aliasing safety). */
async function setupLoop(devicePath: string): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
  const partitionPath = await findDataPartition(devicePath);
  const { offset, sizelimit } = await getPartitionGeometry(partitionPath);
  console.log(`[sandbox] Loop device: offset=${offset}, sizelimit=${sizelimit}`);
  await $`losetup -o ${offset} --sizelimit ${sizelimit} ${LOOP_DEV} ${devicePath}`;
}

async function mountPartition(): Promise<void> {
  await $`mkdir -p ${DATA_MOUNT}`;
  await $`mount -t ext4 -o rw ${LOOP_DEV} ${DATA_MOUNT}`;
}

async function unmountSafe(): Promise<void> {
  try {
    await $`sync`;
    await $`umount ${DATA_MOUNT}`;
  } catch {
    /* ignore — may not be mounted */
  }
}

async function teardownLoop(): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
}

/** Write the inner dockerd config file. */
async function writeDaemonConfig(): Promise<void> {
  const config = {
    "storage-driver": "overlay2",
    "iptables": true,
    "seccomp-profile": "unconfined",
    "dns": ["8.8.8.8", "8.8.4.4"],
    "data-root": `${DATA_MOUNT}/docker`,
  };
  await Bun.write("/tmp/dind-daemon.json", JSON.stringify(config, null, 2));
}

/** Poll the dockerd unix socket until it responds (500ms intervals). */
async function waitForDockerd(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await $`docker -H unix://${DIND_SOCK} version`.nothrow().quiet();
    if (result.exitCode === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dockerd socket ${DIND_SOCK} not ready after ${timeoutMs}ms`);
}

/** Poll HTTP until a non-5xx response arrives (500ms intervals). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return; // 200, 302, 401, 403 are all "HA is up"
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`HA Core at ${url} not ready after ${timeoutMs}ms`);
}

/**
 * Run the ephemeral HA sandbox stage.
 *
 * Boots a real HA Supervisor + Core inside the add-on using Docker-in-Docker,
 * with the inner dockerd writing to the target disk's Docker data directory.
 * This means after the sandbox session, the HA Core image is already on disk
 * (same benefit as the old pre-cache stage) PLUS the user has interactively
 * restored their backup through the real HA UI.
 *
 * Non-fatal: if this stage fails, the disk is still fully functional — the user
 * will just need to do a normal first-boot restore.
 */
export async function runSandboxStage(
  devicePath: string,
  machine: string,
  progressCb: (percent: number, description?: string) => void,
  signal: AbortSignal,
): Promise<void> {
  // Reset module-level state
  sandboxDoneResolve = null;
  sandboxProxyUrl = null;

  let dockerdProc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    // 1. Mount target disk's data partition via loop device
    progressCb(0, "Mounting data partition…");
    await $`partprobe ${devicePath}`.nothrow().quiet();
    await $`udevadm settle --timeout=5`.nothrow().quiet();
    await setupLoop(devicePath);
    await mountPartition();

    if (signal.aborted) throw new Error("Cancelled");

    // 2. Write inner dockerd config (data-root on target disk so HA Core image persists)
    progressCb(5, "Configuring sandbox environment…");
    await writeDaemonConfig();

    // 3. Set up required host paths for Supervisor plugins
    await $`mkdir -p /run/dbus`.nothrow().quiet();
    await $`mkdir -p /tmp/sandbox/data`.nothrow().quiet();
    // Observer plugin needs /run/docker.sock → point to our DinD socket
    try {
      await $`ln -sf ${DIND_SOCK} /run/docker.sock`.quiet();
    } catch {
      /* already exists */
    }
    // Audio plugin needs /etc/machine-id (bind mount source)
    try {
      await $`sh -c "echo deadbeefdeadbeef > /etc/machine-id"`.quiet();
    } catch {
      /* may already exist */
    }

    if (signal.aborted) throw new Error("Cancelled");

    // 4. Start inner dockerd
    progressCb(15, "Starting sandbox Docker daemon…");

    // Start dockerd inside a new mount namespace so we can remount /proc/sys
    // read-write without the change propagating to the host.
    // /proc/sys is read-only in the addon container; dockerd needs to write
    // sysctl values (hairpin mode, IPv6 RA) when creating bridge networks.
    const dockerdArgs = [
      "dockerd",
      "--config-file", "/tmp/dind-daemon.json",
      "--host", `unix://${DIND_SOCK}`,
      "--bip", "10.99.99.1/24",
      "--userland-proxy=false",
      "--log-level", "info",
    ].join(" ");
    dockerdProc = Bun.spawn(
      [
        "unshare", "--mount",
        "/bin/sh", "-c",
        `mount -o remount,rw /proc/sys && mount -o remount,rw /sys/fs/cgroup && exec ${dockerdArgs}`,
      ],
      { stdout: Bun.file("/tmp/dind.log"), stderr: Bun.file("/tmp/dind.log") },
    );

    await waitForDockerd(30_000);
    console.log("[sandbox] Inner dockerd ready");

    if (signal.aborted) throw new Error("Cancelled");

    // 5. Pull Supervisor image BEFORE creating the hassio network.
    //    Creating hassio (172.30.32.0/23) adds a conflicting kernel route that
    //    breaks internet connectivity for the inner dockerd process.
    //    Pulling first ensures we have the image locally before the route exists.
    progressCb(20, "Pulling HA Supervisor image…");
    await $`docker -H unix://${DIND_SOCK} pull ${SUPERVISOR_IMAGE}`;
    console.log("[sandbox] Supervisor image pulled");

    if (signal.aborted) throw new Error("Cancelled");

    // 6. Create inner hassio network (Supervisor hardcodes 172.30.32.0/23 with
    //    gateway 172.30.33.254).
    progressCb(25, "Setting up HA network…");
    await $`docker -H unix://${DIND_SOCK} network create \
      --driver bridge \
      --subnet 172.30.32.0/23 \
      --gateway 172.30.33.254 \
      --opt com.docker.network.bridge.name=hassio \
      hassio`.nothrow().quiet();

    // The hassio bridge adds a /23 route that overlaps with the outer HA network
    // (also 172.30.32.0/23). This causes the kernel to route traffic for the outer
    // gateway (172.30.32.1) to the hassio bridge instead of eth0, breaking internet.
    // Fix: delete the broad /23 hassio route, add a /24 for inner traffic only,
    // and pin the gateway IP to eth0 so the default route stays functional.
    await $`ip route del 172.30.32.0/23 dev hassio`.nothrow().quiet();
    await $`ip route add 172.30.32.0/24 dev hassio src 172.30.33.254`.nothrow().quiet();
    await $`ip route add 172.30.32.1 dev eth0`.nothrow().quiet();

    // The inner dockerd's iptables rules break the outer Docker's embedded DNS
    // (127.0.0.11). Switch to real resolvers so subsequent pulls and curl work.
    await Bun.write("/etc/resolv.conf", "nameserver 8.8.8.8\nnameserver 8.8.4.4\nsearch local.hass.io\n");

    console.log("[sandbox] hassio network ready");

    if (signal.aborted) throw new Error("Cancelled");

    // 7. Start HA Supervisor (remove any leftover container from a previous run first)
    progressCb(30, "Starting HA Supervisor…");
    await $`docker -H unix://${DIND_SOCK} rm -f hassio_supervisor`.nothrow().quiet();
    await $`docker -H unix://${DIND_SOCK} run -d \
      --rm \
      --name hassio_supervisor \
      --network hassio \
      --ip 172.30.32.2 \
      --privileged \
      --security-opt apparmor=unconfined \
      --security-opt seccomp=unconfined \
      -e SUPERVISOR_SHARE=/tmp/sandbox/data \
      -e SUPERVISOR_NAME=hassio_supervisor \
      -e SUPERVISOR_MACHINE=${machine} \
      -e SUPERVISOR_WAIT_BOOT=180 \
      -v ${DIND_SOCK}:/run/docker.sock:rw \
      -v /tmp/sandbox/data:/data:rw \
      -v /etc/machine-id:/etc/machine-id:ro \
      ${SUPERVISOR_IMAGE}`;
    console.log("[sandbox] Supervisor container started");

    if (signal.aborted) throw new Error("Cancelled");

    // 7. Poll for HA Core readiness (40-90% progress range).
    //    Supervisor downloads plugins (CLI ~5MB, DNS ~5MB, Observer ~5MB) then
    //    pulls HA Core (~715MB) and starts it. This can take several minutes
    //    depending on network speed and whether image is cached.
    progressCb(40, "Waiting for HA Core to start (this may take a few minutes)…");
    const pollStart = Date.now();
    const HA_READY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
    const coreUrl = `http://${SUPERVISOR_IP}:8123`;

    let lastLogLine = "";
    const pollInterval = setInterval(async () => {
      if (signal.aborted) return;
      try {
        // Check Supervisor logs for progress hints
        const logs = await $`docker -H unix://${DIND_SOCK} logs --tail 3 hassio_supervisor 2>&1`.nothrow().text();
        const lastLine = logs.trim().split("\n").at(-1) ?? "";
        if (lastLine !== lastLogLine) {
          lastLogLine = lastLine;
          // Rough progress: 40% + time-based estimate up to 88%
          const elapsed = Date.now() - pollStart;
          const fraction = Math.min(elapsed / HA_READY_TIMEOUT, 1);
          const pct = Math.round(40 + fraction * 48);
          progressCb(pct, "Waiting for HA Core to start…");
        }
      } catch {
        /* ignore */
      }
    }, 5000);

    try {
      await waitForHttp(coreUrl, HA_READY_TIMEOUT);
    } finally {
      clearInterval(pollInterval);
    }

    console.log("[sandbox] HA Core is ready at", coreUrl);

    if (signal.aborted) throw new Error("Cancelled");

    // 8. HA is ready — expose proxy URL and signal frontend
    sandboxProxyUrl = coreUrl;
    progressCb(99, "sandbox_ready");

    // 9. Wait for user to click "Done" (POST /api/sandbox/done → signalSandboxDone).
    //    Broadcast sandbox_ready every 5s so any freshly-connected WS client (e.g.
    //    after a page refresh) picks up the state without needing a dedicated poll.
    const readyInterval = setInterval(() => progressCb(99, "sandbox_ready"), 5_000);
    try {
      await new Promise<void>((resolve) => {
        sandboxDoneResolve = resolve;
        // If the signal fires while waiting, resolve immediately so cleanup runs
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      clearInterval(readyInterval);
    }

    progressCb(99, "Shutting down sandbox…");

  } finally {
    // 10. Graceful cleanup
    sandboxProxyUrl = null;
    sandboxDoneResolve = null;

    // Stop Supervisor container
    await $`docker -H unix://${DIND_SOCK} stop hassio_supervisor`.nothrow().quiet();

    // Stop inner dockerd
    if (dockerdProc) {
      dockerdProc.kill("SIGTERM");
      await Promise.race([
        dockerdProc.exited,
        new Promise<void>((r) => setTimeout(r, 15_000)),
      ]);
      try { dockerdProc.kill("SIGKILL"); } catch { /* already exited */ }
    }

    // Flush and unmount
    await unmountSafe();
    await teardownLoop();

    // Ensure securityfs is mounted — the inner dockerd can unmount it as a
    // side-effect of mount namespace cleanup, which breaks AppArmor on the host.
    await $`mount -t securityfs securityfs /sys/kernel/security`.nothrow().quiet();
  }
}
