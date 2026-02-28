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

// HA Core runs in Docker --network=host mode (Supervisor default when no HA OS is present).
// It binds to 0.0.0.0:8123 in the outer container's network namespace.
// Poll and proxy via 127.0.0.1:8123.
const SUPERVISOR_IP = "127.0.0.1";

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

  // Grow the data partition to fill available disk space.
  // Freshly-flashed HA OS images have a small (~1.3GB) fixed data partition.
  // The sandbox needs several GB for Docker image storage.
  // sfdisk ", +" extends the partition to the end of the disk and also fixes
  // the GPT secondary header location (which parted fails to handle here).
  const partNum = partitionPath.match(/(\d+)$/)?.[1];
  if (partNum) {
    await $`echo ', +' | sfdisk --force -N ${partNum} ${devicePath}`.nothrow().quiet();
    console.log(`[sandbox] Grew data partition ${partitionPath} to fill disk`);
  }

  const { offset, sizelimit } = await getPartitionGeometry(partitionPath);
  console.log(`[sandbox] Loop device: offset=${offset}, sizelimit=${sizelimit}`);
  await $`losetup -o ${offset} --sizelimit ${sizelimit} ${LOOP_DEV} ${devicePath}`;

  // Resize the ext4 filesystem to fill the newly expanded partition.
  await $`e2fsck -f -p ${LOOP_DEV}`.nothrow().quiet();
  await $`resize2fs ${LOOP_DEV}`.nothrow().quiet();
  console.log(`[sandbox] Filesystem resized to fill partition`);
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
    // Disable inner dockerd iptables management. When enabled, dockerd pollutes the
    // addon container's network namespace with DOCKER chains containing blanket DROP
    // rules that block the outer Supervisor's ingress proxy from reaching this addon
    // (causing the panel to go blank during and after sandbox execution).
    // We add only the minimal MASQUERADE rules manually after dockerd starts.
    "iptables": false,
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
    // Supervisor data dir = /mnt/newsd/supervisor (matches real HA OS disk layout).
    // This means the injected backup at /mnt/newsd/supervisor/backup/ is automatically
    // visible to the inner Supervisor as /data/backup/ without any extra copying.
    // audio/external must pre-exist: audio plugin fails on CAP_SYS_NICE and never
    // creates it, but HA Core bind-mounts it and errors out if the path is missing.
    // cid_files/homeassistant.cid must pre-exist as an empty file: Docker bind-mounts
    // a file (not a directory) here, and refuses to create a non-existent file source.
    // config.json removal forces fresh-boot mode (not "Detected Supervisor restart"):
    // in restart mode the Supervisor defers Core start to a ~5-minute periodic watchdog;
    // in fresh mode it starts Core immediately during initialization.
    // homeassistant dir removal forces fresh onboarding on every sandbox run so the
    // iframe always shows the onboarding UI (not a dashboard from a previous run).
    await $`mkdir -p /mnt/newsd/supervisor/audio/external /mnt/newsd/supervisor/cid_files`.nothrow().quiet();
    await $`touch /mnt/newsd/supervisor/cid_files/homeassistant.cid`.nothrow().quiet();
    await $`rm -f /mnt/newsd/supervisor/config.json`.nothrow().quiet();
    await $`rm -rf /mnt/newsd/supervisor/homeassistant`.nothrow().quiet();
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
        // mount --make-shared /mnt/newsd: Docker bind-mounts require the parent mount
        // to be shared or slave. After unshare --mount, /mnt/newsd is private.
        // Making it shared allows the inner dockerd to bind-mount subdirectories
        // (e.g. /mnt/newsd/sandbox/share) into HA Core's container.
        `mount -o remount,rw /proc/sys && mount -o remount,rw /sys/fs/cgroup && sysctl -w net.ipv4.conf.default.rp_filter=0 && mount --make-shared /mnt/newsd && exec ${dockerdArgs}`,
      ],
      { stdout: Bun.file("/tmp/dind.log"), stderr: Bun.file("/tmp/dind.log") },
    );

    await waitForDockerd(30_000);
    console.log("[sandbox] Inner dockerd ready");

    // Add the minimal NAT rules inner containers need to reach the internet.
    // We use --iptables=false on dockerd so it doesn't add DOCKER chains with DROP
    // rules. Instead we only MASQUERADE traffic from inner networks leaving eth0.
    await $`iptables -t nat -A POSTROUTING -s 172.30.32.0/23 -o eth0 -j MASQUERADE`.nothrow().quiet();
    await $`iptables -t nat -A POSTROUTING -s 10.99.99.0/24 -o eth0 -j MASQUERADE`.nothrow().quiet();

    // Overwrite resolv.conf with real DNS BEFORE any docker pull.
    // The outer container's /etc/resolv.conf contains 127.0.0.11 (Docker's embedded
    // DNS). If a previous sandbox run (or the hassio bridge creation below) disrupts
    // routing, 127.0.0.11 may become unreachable and pull fails with "server
    // misbehaving". Using 8.8.8.8 directly avoids any such routing dependency.
    await Bun.write("/etc/resolv.conf", "nameserver 8.8.8.8\nnameserver 8.8.4.4\nsearch local.hass.io\n");

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
    // (also 172.30.32.0/23). We replace it with a precise /24 for the inner subnet:
    //
    //   172.30.32.0/24 dev hassio — inner containers (.1 HA Core, .2 Supervisor,
    //       .3+ plugins) reach each other and their gateway via the hassio bridge.
    //
    // The outer Supervisor is also at 172.30.32.2 (IP collision). A plain host route
    // "172.30.32.2 dev eth0" would break MASQUERADE replies: conntrack de-NATs
    // internet replies (dst=addon_ip → dst=172.30.32.2) and the host route sends
    // them out eth0 instead of into the hassio bridge. The inner Supervisor loses
    // internet connectivity while the DNS container (.3, no host route) works fine.
    //
    // Fix: policy routing table 101 handles ingress responses only.
    // - OUTPUT packets from port 8099 (our HTTP/WS server) to 172.30.32.2 are marked 2
    //   → routed via table 101 → eth0 (outer Supervisor receives the response).
    // - MASQUERADE de-NAT'd replies (FORWARD path, no OUTPUT mark) use the main
    //   routing table → /24 dev hassio → inner Supervisor receives them.
    await $`ip route del 172.30.32.0/23 dev hassio`.nothrow().quiet();
    await $`ip route add 172.30.32.0/24 dev hassio src 172.30.33.254`.nothrow().quiet();
    await $`iptables -t mangle -A OUTPUT -d 172.30.32.2 -p tcp --sport 8099 -j MARK --set-mark 2`.nothrow().quiet();
    await $`ip rule add fwmark 2 lookup 101`.nothrow().quiet();
    await $`ip route add 172.30.32.2 dev eth0 table 101`.nothrow().quiet();

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
      -e SUPERVISOR_SHARE=/mnt/newsd/supervisor \
      -e SUPERVISOR_NAME=hassio_supervisor \
      -e SUPERVISOR_MACHINE=${machine} \
      -e SUPERVISOR_WAIT_BOOT=180 \
      -v ${DIND_SOCK}:/run/docker.sock:rw \
      -v /mnt/newsd/supervisor:/data:rw \
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

    // Remove the MASQUERADE rules, mangle marks, policy routes, and hassio route we added.
    await $`iptables -t nat -D POSTROUTING -s 172.30.32.0/23 -o eth0 -j MASQUERADE`.nothrow().quiet();
    await $`iptables -t nat -D POSTROUTING -s 10.99.99.0/24 -o eth0 -j MASQUERADE`.nothrow().quiet();
    await $`iptables -t mangle -D OUTPUT -d 172.30.32.2 -p tcp --sport 8099 -j MARK --set-mark 2`.nothrow().quiet();
    await $`ip rule del fwmark 2 lookup 101`.nothrow().quiet();
    await $`ip route del 172.30.32.2 dev eth0 table 101`.nothrow().quiet();
    await $`ip route del 172.30.32.0/24 dev hassio`.nothrow().quiet();
    console.log("[sandbox] iptables/route cleanup done");

    // Flush and unmount
    await unmountSafe();
    await teardownLoop();

    // Ensure securityfs is mounted — the inner dockerd can unmount it as a
    // side-effect of mount namespace cleanup, which breaks AppArmor on the host.
    await $`mount -t securityfs securityfs /sys/kernel/security`.nothrow().quiet();
  }
}
