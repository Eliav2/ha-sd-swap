import { $ } from "bun";
import { readdir } from "node:fs/promises";

const MOUNT_POINT = "/mnt/newsd";
const BACKUP_DIR = "/backup";
const LOOP_DEV = "/dev/loop0";

/** Find the hassos-data partition on the target device. */
export async function findDataPartition(devicePath: string): Promise<string> {
  const output = await $`lsblk -nro NAME,PARTLABEL ${devicePath}`.text();

  for (const line of output.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === "hassos-data") {
      return `/dev/${parts[0]}`;
    }
  }

  throw new Error(
    `Could not find hassos-data partition on ${devicePath}. ` +
      `Flash may have failed or partition layout is unexpected.`,
  );
}

/**
 * Get the byte offset and size of a partition for use with losetup.
 * Returns { offset, sizelimit } in bytes.
 */
async function getPartitionGeometry(partitionPath: string): Promise<{ offset: number; sizelimit: number }> {
  const start = parseInt(
    (await $`lsblk -nrbo START ${partitionPath}`.text()).trim(),
  );
  const size = parseInt(
    (await $`lsblk -nrbo SIZE ${partitionPath}`.text()).trim(),
  );
  if (isNaN(start) || isNaN(size)) {
    throw new Error(`Could not determine geometry for ${partitionPath}`);
  }
  // START is in 512-byte sectors; SIZE with -b is already in bytes
  return { offset: start * 512, sizelimit: size };
}

/**
 * Set up a loop device for the partition.
 * This avoids page cache aliasing between the whole-disk device (written by dd
 * during flash) and the partition device — the loop device has its own page
 * cache, so mkfs.ext4 writes are not shadowed by stale cached blocks.
 */
async function setupLoop(partitionPath: string, devicePath: string): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
  const { offset, sizelimit } = await getPartitionGeometry(partitionPath);
  console.log(`[inject] Setting up loop device: offset=${offset}, size=${sizelimit}`);
  await $`losetup -o ${offset} --sizelimit ${sizelimit} ${LOOP_DEV} ${devicePath}`;
}

async function teardownLoop(): Promise<void> {
  await $`losetup -d ${LOOP_DEV}`.nothrow().quiet();
}

/** Create a fresh ext4 filesystem on the loop device. */
async function createExt4(): Promise<void> {
  console.log(`[inject] Creating ext4 filesystem on ${LOOP_DEV}...`);
  await $`wipefs -a ${LOOP_DEV}`.nothrow().quiet();
  await $`mkfs.ext4 -F -L hassos-data ${LOOP_DEV}`;
  await $`sync`;
}

async function mount(): Promise<void> {
  await $`mkdir -p ${MOUNT_POINT}`;
  try {
    await $`mount -t ext4 -o rw ${LOOP_DEV} ${MOUNT_POINT}`;
  } catch {
    console.log("[inject] Mount failed, recreating ext4...");
    await createExt4();
    await $`mount -t ext4 -o rw ${LOOP_DEV} ${MOUNT_POINT}`;
  }
}

async function unmount(): Promise<void> {
  try {
    await $`sync`;
    await $`umount ${MOUNT_POINT}`;
  } catch {
    /* ignore — may not be mounted */
  }
}

/**
 * Find the backup .tar file for a given slug.
 * HA stores backups as {slug}.tar, but automatic backups may use name-based filenames.
 * Falls back to searching all tars in /backup/ by reading their backup.json.
 */
async function findBackupFile(slug: string): Promise<string> {
  // Fast path: check {slug}.tar directly
  const directPath = `${BACKUP_DIR}/${slug}.tar`;
  if (await Bun.file(directPath).exists()) return directPath;

  // Slow path: search all tars for matching slug in backup.json
  console.log(`[inject] ${slug}.tar not found, searching backup files...`);
  const files = await readdir(BACKUP_DIR);
  for (const file of files) {
    if (!file.endsWith(".tar")) continue;
    const filePath = `${BACKUP_DIR}/${file}`;
    try {
      const json = await $`tar -xf ${filePath} backup.json -O`.text();
      const meta = JSON.parse(json);
      if (meta.slug === slug) {
        console.log(`[inject] Found backup ${slug} in ${file}`);
        return filePath;
      }
    } catch { /* not a valid backup tar */ }
  }

  throw new Error(`Backup file not found for slug: ${slug}`);
}

/**
 * Set up .HA_RESTORE so HA Core auto-restores config + database on first boot.
 * Must be called while hassos-data is still mounted at MOUNT_POINT.
 */
async function setupAutoRestore(backupSlug: string): Promise<void> {
  const coreBackupDir = `${MOUNT_POINT}/homeassistant/backups`;
  const supervisorTar = `${MOUNT_POINT}/supervisor/backup/${backupSlug}.tar`;
  const coreTar = `${coreBackupDir}/${backupSlug}.tar`;
  const restoreFile = `${MOUNT_POINT}/homeassistant/.HA_RESTORE`;

  console.log("[inject] Setting up auto-restore for first boot...");

  // Create HA Core backup directory
  await $`mkdir -p ${coreBackupDir}`;

  // Hard-link backup tar for HA Core access (same partition, no extra disk space)
  try {
    await $`ln ${supervisorTar} ${coreTar}`;
    console.log("[inject] Hard-linked backup tar to homeassistant/backups/");
  } catch {
    // Fallback to copy if hard-link fails
    console.log("[inject] Hard-link failed, copying backup tar...");
    await $`cp ${supervisorTar} ${coreTar}`;
  }

  // Write .HA_RESTORE instruction file
  // Path inside HA Core container: /config/backups/{slug}.tar
  const restoreConfig = JSON.stringify({
    path: `/config/backups/${backupSlug}.tar`,
    password: null,
    remove_after_restore: false,
    restore_database: true,
    restore_homeassistant: true,
  }, null, 2);

  await Bun.write(restoreFile, restoreConfig);
  console.log("[inject] Wrote .HA_RESTORE file for auto-restore on first boot.");
}

/**
 * Inject a backup .tar into the freshly flashed device's data partition.
 * 1. Find hassos-data partition
 * 2. Set up loop device (avoids page cache aliasing after dd flash)
 * 3. Mount at /mnt/newsd
 * 4. Copy backup .tar into supervisor/backup/
 * 5. Set up .HA_RESTORE for auto-restore on first boot
 * 6. sync + unmount + teardown loop (always, via finally)
 */
export async function injectBackup(
  devicePath: string,
  backupSlug: string,
  progressCb: (percent: number, description?: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  progressCb(0, "Finding data partition\u2026");
  const sourcePath = await findBackupFile(backupSlug);
  const destDir = `${MOUNT_POINT}/supervisor/backup`;
  const destPath = `${destDir}/${backupSlug}.tar`;

  const sourceFile = Bun.file(sourcePath);
  const totalBytes = sourceFile.size;

  // Refresh kernel's partition table view (important when flash was skipped)
  await $`partprobe ${devicePath}`.nothrow().quiet();
  await $`udevadm settle --timeout=5`.nothrow().quiet();

  const partitionPath = await findDataPartition(devicePath);

  try {
    progressCb(1, "Preparing disk\u2026");
    await setupLoop(partitionPath, devicePath);

    progressCb(2, "Mounting filesystem\u2026");
    await mount();
    await $`mkdir -p ${destDir}`;

    progressCb(3, "Copying backup\u2026");
    const reader = sourceFile.stream().getReader();
    const writer = Bun.file(destPath).writer();
    let copied = 0;

    while (true) {
      if (signal?.aborted) {
        await writer.end();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      copied += value.byteLength;
      // File copy maps to 3–90%
      const copyPercent = 3 + Math.round((copied / totalBytes) * 87);
      progressCb(copyPercent, "Copying backup\u2026");
    }

    if (!signal?.aborted) {
      await writer.end();

      progressCb(91, "Configuring auto-restore\u2026");
      await setupAutoRestore(backupSlug);

      progressCb(95, "Flushing writes to disk\u2026");
      await $`sync`;
    }
  } finally {
    progressCb(98, "Unmounting\u2026");
    await unmount();
    await teardownLoop();
  }
}
