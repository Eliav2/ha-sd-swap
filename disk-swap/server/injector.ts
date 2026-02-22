import { $ } from "bun";

const MOUNT_POINT = "/mnt/newsd";

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
  await $`mkfs.ext4 -L hassos-data ${partitionPath}`;
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
 * Inject a backup .tar into the freshly flashed device's data partition.
 * 1. Find hassos-data partition
 * 2. Mount at /mnt/newsd
 * 3. Copy /backup/{slug}.tar into supervisor/backup/
 * 4. sync + unmount (always, via finally)
 */
export async function injectBackup(
  devicePath: string,
  backupSlug: string,
  progressCb: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const sourcePath = `/backup/${backupSlug}.tar`;
  const destDir = `${MOUNT_POINT}/supervisor/backup`;
  const destPath = `${destDir}/${backupSlug}.tar`;

  const sourceFile = Bun.file(sourcePath);
  if (!(await sourceFile.exists())) {
    throw new Error(`Backup file not found: ${sourcePath}`);
  }
  const totalBytes = sourceFile.size;

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
      await $`sync`;
    }
  } finally {
    await unmount();
  }
}
