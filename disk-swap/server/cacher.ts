import { $ } from "bun";
import { findDataPartition, findBackupFile, getPartitionGeometry } from "./injector.ts";

const DATA_MOUNT = "/mnt/newsd";
const OVERLAY_MOUNT = "/mnt/overlay";
const LOOP_DATA = "/dev/loop0";
const LOOP_OVERLAY = "/dev/loop1";

const SERVICE_NAME = "precache-load.service";
const SERVICE_CONTENT = `[Unit]
Description=Load pre-cached Docker images
After=docker.service
Before=hassio-supervisor.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=-/bin/bash -c 'for f in /mnt/data/precache/*.tar; do [ -f "$$f" ] && docker load -i "$$f" && rm -f "$$f"; done; rmdir /mnt/data/precache 2>/dev/null; rm -f /etc/systemd/system/${SERVICE_NAME} /etc/systemd/system/multi-user.target.wants/${SERVICE_NAME}; systemctl daemon-reload'
RemainAfterExit=true
`;

/** Find the hassos-overlay partition on the target device. */
async function findOverlayPartition(devicePath: string): Promise<string> {
  const output = await $`lsblk -nro NAME,PARTLABEL ${devicePath}`.text();

  for (const line of output.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === "hassos-overlay") {
      return `/dev/${parts[0]}`;
    }
  }

  throw new Error(
    `Could not find hassos-overlay partition on ${devicePath}. ` +
      `Partition layout may be unexpected.`,
  );
}

/** Set up a loop device for a partition (page cache aliasing safety). */
async function setupLoop(loopDev: string, partitionPath: string, devicePath: string): Promise<void> {
  await $`losetup -d ${loopDev}`.nothrow().quiet();
  const { offset, sizelimit } = await getPartitionGeometry(partitionPath);
  console.log(`[cache] Setting up ${loopDev}: offset=${offset}, size=${sizelimit}`);
  await $`losetup -o ${offset} --sizelimit ${sizelimit} ${loopDev} ${devicePath}`;
}

async function teardownLoop(loopDev: string): Promise<void> {
  await $`losetup -d ${loopDev}`.nothrow().quiet();
}

async function mountPartition(loopDev: string, mountPoint: string): Promise<void> {
  await $`mkdir -p ${mountPoint}`;
  await $`mount -t ext4 -o rw ${loopDev} ${mountPoint}`;
}

async function unmountSafe(mountPoint: string): Promise<void> {
  try {
    await $`sync`;
    await $`umount ${mountPoint}`;
  } catch {
    /* ignore — may not be mounted */
  }
}

/** Extract and parse backup.json from a backup tar to get homeassistant version. */
async function parseBackupMeta(backupPath: string): Promise<{ homeassistant?: { version?: string } }> {
  const json = await $`tar -xf ${backupPath} ./backup.json -O`.text();
  return JSON.parse(json);
}

/** Write the systemd oneshot service to the overlay partition. */
async function writeBootService(overlayMount: string): Promise<void> {
  const serviceDir = `${overlayMount}/etc/systemd/system`;
  const wantsDir = `${serviceDir}/multi-user.target.wants`;

  await $`mkdir -p ${serviceDir} ${wantsDir}`;
  await Bun.write(`${serviceDir}/${SERVICE_NAME}`, SERVICE_CONTENT);
  // Symlink to enable the service
  await $`ln -sf /etc/systemd/system/${SERVICE_NAME} ${wantsDir}/${SERVICE_NAME}`;

  console.log(`[cache] Wrote ${SERVICE_NAME} to overlay partition`);
}

/**
 * Pre-cache Docker images onto the new disk for faster first boot.
 *
 * 1. Read backup metadata to determine HA Core version
 * 2. Mount data + overlay partitions (via loop devices for page cache safety)
 * 3. Download HA Core image tarball via crane
 * 4. Write self-destructing systemd service to overlay for first-boot docker load
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

  // 2. Find both partitions
  progressCb(5, "Mounting partitions…");
  const dataPartPath = await findDataPartition(devicePath);
  const overlayPartPath = await findOverlayPartition(devicePath);

  // Set up loop devices (page cache aliasing safety — see injector.ts:43)
  await setupLoop(LOOP_DATA, dataPartPath, devicePath);
  await setupLoop(LOOP_OVERLAY, overlayPartPath, devicePath);

  try {
    await mountPartition(LOOP_DATA, DATA_MOUNT);
    await mountPartition(LOOP_OVERLAY, OVERLAY_MOUNT);

    // 3. Download HA Core image via crane
    progressCb(10, `Downloading ${machine}-homeassistant:${coreVersion}…`);
    const precacheDir = `${DATA_MOUNT}/precache`;
    await $`mkdir -p ${precacheDir}`;

    const tarPath = `${precacheDir}/core.tar`;
    console.log(`[cache] Running crane pull → ${tarPath}`);
    const proc = Bun.spawn(
      ["crane", "pull", "--format=tarball", coreImage, tarPath],
      { signal },
    );
    await proc.exited;
    if (proc.exitCode !== 0) throw new Error(`crane pull failed with exit code ${proc.exitCode}`);

    progressCb(80, "Writing boot service…");

    // 4. Write systemd oneshot service to overlay
    await writeBootService(OVERLAY_MOUNT);

    progressCb(95, "Flushing writes…");
    await $`sync`;
  } finally {
    // Always unmount + teardown
    await unmountSafe(OVERLAY_MOUNT);
    await unmountSafe(DATA_MOUNT);
    await teardownLoop(LOOP_OVERLAY);
    await teardownLoop(LOOP_DATA);
  }
}
