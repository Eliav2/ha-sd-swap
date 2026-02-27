import { $ } from "bun";
import { findDataPartition, findBackupFile, getPartitionGeometry } from "./injector.ts";

const DATA_MOUNT = "/mnt/newsd";
const LOOP_DEV = "/dev/loop0";

// Containerd root dir inside Docker's data directory on the target disk.
// This is where HA OS's Docker/containerd stores its content store and metadata.
const CONTAINERD_ROOT = `${DATA_MOUNT}/docker/containerd/daemon`;
const CONTENT_STORE_BLOBS = `${CONTAINERD_ROOT}/io.containerd.content.v1.content/blobs/sha256`;

// Ephemeral paths for the temporary containerd daemon (in addon tmpfs, not written to disk)
const CTR_SOCKET = "/tmp/containerd-cache.sock";
const CTR_STATE = "/tmp/containerd-cache-state";

/** Extract and parse backup.json from a backup tar to get homeassistant version. */
async function parseBackupMeta(backupPath: string): Promise<{ homeassistant?: { version?: string } }> {
  const json = await $`tar -xf ${backupPath} ./backup.json -O`.text();
  return JSON.parse(json);
}

/** Get the expected compressed size of the image layers from the registry manifest. */
async function getImageSize(imageRef: string): Promise<number | null> {
  try {
    const json = await $`crane manifest ${imageRef}`.text();
    const manifest = JSON.parse(json);
    let total = 0;
    if (manifest.config?.size) total += manifest.config.size;
    if (Array.isArray(manifest.layers)) {
      for (const layer of manifest.layers) total += layer.size ?? 0;
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** Set up a loop device for the data partition (page cache aliasing safety). */
async function setupLoop(partitionPath: string, devicePath: string): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
  const { offset, sizelimit } = await getPartitionGeometry(partitionPath);
  console.log(`[cache] Setting up loop device: offset=${offset}, size=${sizelimit}`);
  await $`losetup -o ${offset} --sizelimit ${sizelimit} ${LOOP_DEV} ${devicePath}`;
}

async function teardownLoop(): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
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

/** Wait for the containerd unix socket to become available (polls every 500ms). */
async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await $`ctr --address ${socketPath} version`.nothrow().quiet();
    if (result.exitCode === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Containerd socket ${socketPath} not ready after ${timeoutMs}ms`);
}

/**
 * Pre-cache Docker images onto the new disk for faster first boot.
 *
 * Strategy: start a temporary containerd v2.2.1 daemon with --root pointing
 * to the USB disk's Docker data directory, then pull the HA Core image using
 * `ctr -n moby images pull`. This creates:
 *   - Content-addressable blobs in the containerd content store
 *   - BoltDB metadata entries (meta.db) with proper image records
 *   - Image record in the `moby` namespace (the namespace Docker Engine uses)
 *
 * On first boot, Docker finds the image already present in its namespace and
 * skips the ~715 MB network download — only a local unpack (fast) is needed.
 *
 * The containerd version MUST match HA OS (Docker 29.x → containerd v2.2.1) to
 * ensure BoltDB schema compatibility. We copy the binary from the official
 * containerd/containerd:2.2.1 Docker image in the Dockerfile.
 *
 * If this stage fails, the disk is still fully functional — just slower first boot.
 */
export async function precacheImages(
  devicePath: string,
  backupSlug: string,
  machine: string,
  progressCb: (percent: number, description?: string, speed?: number, eta?: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 1. Parse backup.json to get HA Core version
  progressCb(0, "Reading backup metadata…");
  const backupPath = await findBackupFile(backupSlug);
  const meta = await parseBackupMeta(backupPath);
  const coreVersion = meta.homeassistant?.version;
  if (!coreVersion) throw new Error("Could not determine HA Core version from backup");

  const coreImage = `ghcr.io/home-assistant/${machine}-homeassistant:${coreVersion}`;
  console.log(`[cache] Will pre-cache: ${coreImage}`);

  // 2. Get expected image size for progress tracking (sum of compressed layer sizes)
  progressCb(5, "Fetching image manifest…");
  const expectedBytes = await getImageSize(coreImage);
  console.log(`[cache] Expected size: ${expectedBytes ? `${(expectedBytes / 1024 / 1024).toFixed(0)} MB` : "unknown"}`);

  // 3. Mount data partition via loop device (page cache aliasing safety)
  progressCb(10, "Mounting data partition…");
  await $`partprobe ${devicePath}`.nothrow().quiet();
  await $`udevadm settle --timeout=5`.nothrow().quiet();
  const partitionPath = await findDataPartition(devicePath);
  await setupLoop(partitionPath, devicePath);

  let containerdProc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    await mountPartition();

    // 4. Prepare directories
    await $`mkdir -p ${CONTAINERD_ROOT}`;
    await $`rm -rf ${CTR_STATE}`;
    await $`mkdir -p ${CTR_STATE}`;
    await $`rm -f ${CTR_SOCKET}`.nothrow().quiet();

    // 5. Start a temporary containerd daemon pointing to the disk's Docker data directory.
    //    --root: persistent state (content store + BoltDB metadata) → written to the disk
    //    --state: ephemeral state (sockets, pids)                   → addon tmpfs, discarded
    //    --address: unix socket path                                 → addon tmpfs, discarded
    console.log(`[cache] Starting containerd daemon, root=${CONTAINERD_ROOT}`);
    containerdProc = Bun.spawn(
      [
        "containerd",
        "--root", CONTAINERD_ROOT,
        "--state", CTR_STATE,
        "--address", CTR_SOCKET,
        "--log-level", "warn",
      ],
      { stdout: "inherit", stderr: "inherit" },
    );

    progressCb(15, "Starting containerd daemon…");
    await waitForSocket(CTR_SOCKET, 30_000);
    console.log(`[cache] Containerd ready`);

    // 6. Pull image in the `moby` namespace — the namespace Docker Engine uses.
    //    `ctr images pull` fetches blobs to the content store AND creates image records
    //    in BoltDB. The image record prevents GC from removing the blobs on first boot.
    //    No --unpack: unpacking happens on first container start (fast local I/O).
    const desc = `Downloading ${machine}-homeassistant:${coreVersion}…`;
    progressCb(20, desc);

    const pullProc = Bun.spawn(
      [
        "ctr",
        "--address", CTR_SOCKET,
        "--namespace", "moby",
        "images", "pull",
        coreImage,
      ],
      { stdout: "inherit", stderr: "inherit", signal },
    );

    // Poll content store size vs manifest total for progress (20–85%)
    const dlStart = Date.now();
    const pollInterval = setInterval(async () => {
      try {
        const output = await $`du -sb ${CONTENT_STORE_BLOBS} 2>/dev/null`.nothrow().text();
        const size = parseInt(output.split("\t")[0], 10);
        if (size > 0) {
          const elapsed = (Date.now() - dlStart) / 1000;
          const speed = elapsed > 0 ? size / elapsed : 0;
          if (expectedBytes) {
            const fraction = Math.min(size / expectedBytes, 1);
            const percent = 20 + Math.round(fraction * 65);
            const eta = speed > 0 ? (expectedBytes - size) / speed : 0;
            progressCb(Math.min(percent, 85), desc, speed, eta);
          } else {
            progressCb(50, desc, speed, 0);
          }
        }
      } catch { /* dir may not exist yet */ }
    }, 500);

    try {
      await pullProc.exited;
    } finally {
      clearInterval(pollInterval);
    }

    if (pullProc.exitCode !== 0) {
      throw new Error(`ctr pull failed with exit code ${pullProc.exitCode}`);
    }

    const blobCount = (await $`ls ${CONTENT_STORE_BLOBS} 2>/dev/null | wc -l`.nothrow().text()).trim();
    console.log(`[cache] Pre-cached ${blobCount} blobs for ${coreImage}`);

    progressCb(90, "Flushing writes…");
    await $`sync`;
  } finally {
    // Stop containerd before unmounting — containerd holds the BoltDB file open
    if (containerdProc) {
      containerdProc.kill("SIGTERM");
      await Promise.race([
        containerdProc.exited,
        new Promise<void>((r) => setTimeout(r, 8_000)),
      ]);
      containerdProc.kill("SIGKILL");
      await $`rm -rf ${CTR_STATE} ${CTR_SOCKET}`.nothrow().quiet();
    }
    await unmountSafe();
    await teardownLoop();
  }
}
