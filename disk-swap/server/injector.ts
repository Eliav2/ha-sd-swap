import { $ } from "bun";
import { readdir } from "node:fs/promises";

const MOUNT_POINT = "/mnt/newsd";
const BACKUP_DIR = "/backup";

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

/** Ensure the partition has an ext4 filesystem (HA OS creates it on first boot). */
async function ensureExt4(partitionPath: string): Promise<void> {
  const fstype = (
    await $`lsblk -nro FSTYPE ${partitionPath}`.nothrow().quiet().text()
  ).trim();
  if (fstype === "ext4") return;
  console.log(`[inject] No ext4 on ${partitionPath} (got "${fstype}"), creating filesystem...`);
  // Clear stale filesystem signatures that can corrupt the new ext4
  await $`wipefs -a ${partitionPath}`.nothrow().quiet();
  await $`mkfs.ext4 -F -L hassos-data ${partitionPath}`;
  // Flush block device cache so the kernel sees the fresh filesystem
  await $`sync`;
  await $`blockdev --flushbufs ${partitionPath}`.nothrow().quiet();
}

async function mount(partitionPath: string): Promise<void> {
  await $`mkdir -p ${MOUNT_POINT}`;
  await ensureExt4(partitionPath);
  await $`mount -t ext4 -o rw ${partitionPath} ${MOUNT_POINT}`;
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
 * 2. Mount at /mnt/newsd
 * 3. Copy backup .tar into supervisor/backup/
 * 4. Set up .HA_RESTORE for auto-restore on first boot
 * 5. sync + unmount (always, via finally)
 */
export async function injectBackup(
  devicePath: string,
  backupSlug: string,
  progressCb: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
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
    await mount(partitionPath);
    await $`mkdir -p ${destDir}`;

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
      progressCb(Math.round((copied / totalBytes) * 100));
    }

    if (!signal?.aborted) {
      await writer.end();
      await setupAutoRestore(backupSlug);
      await $`sync`;
    }
  } finally {
    await unmount();
  }
}
