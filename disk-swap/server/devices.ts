import { $ } from "bun";
import type { RawBlockDevice, Device } from "../shared/types.ts";

/**
 * Determine the boot disk name (e.g. "mmcblk0" or "sda").
 * Uses findmnt to find the root mount source, then lsblk to get the parent disk.
 */
export async function getBootDisk(): Promise<string> {
  const rootSource = (
    await $`findmnt --noheadings --output SOURCE --target /`.text()
  ).trim();

  const pkname = (
    await $`lsblk --noheadings --output PKNAME ${rootSource}`.text()
  ).trim();

  const diskName = pkname || rootSource;
  return diskName.replace("/dev/", "");
}

/**
 * Safety filter: determine if a block device is a valid flash target.
 * - Must NOT be the boot disk
 * - Must be USB-connected
 * - Must be between 8 GB and 2 TB
 */
export function isSafeTarget(
  dev: RawBlockDevice,
  bootDisk: string
): boolean {
  if (dev.name === bootDisk) return false;
  if (dev.tran !== "usb") return false;

  const size = typeof dev.size === "string" ? parseInt(dev.size, 10) : dev.size;
  const MIN_SIZE = 8 * 1024 ** 3; // 8 GB
  const MAX_SIZE = 2 * 1024 ** 4; // 2 TB

  if (size < MIN_SIZE || size > MAX_SIZE) return false;

  return true;
}

function formatSize(bytes: number): string {
  const GB = 1024 ** 3;
  const TB = 1024 ** 4;
  if (bytes >= TB) return `${(bytes / TB).toFixed(1)} TB`;
  return `${Math.round(bytes / GB)} GB`;
}

/**
 * List all USB block devices that are safe flash targets.
 */
export async function listUsbDevices(): Promise<Device[]> {
  const bootDisk = await getBootDisk();

  const lsblkOutput =
    await $`lsblk --json -b -o NAME,SIZE,TYPE,TRAN,VENDOR,MODEL,SERIAL --nodeps`.json();

  const rawDevices: RawBlockDevice[] = lsblkOutput.blockdevices ?? [];

  return rawDevices
    .filter((dev) => dev.type === "disk" && isSafeTarget(dev, bootDisk))
    .map((dev) => {
      const size =
        typeof dev.size === "string" ? parseInt(dev.size, 10) : dev.size;
      return {
        name: dev.name,
        path: `/dev/${dev.name}`,
        size,
        size_human: formatSize(size),
        vendor: (dev.vendor ?? "").trim(),
        model: (dev.model ?? "").trim(),
        tran: dev.tran ?? "unknown",
        serial: (dev.serial ?? "").trim(),
      };
    });
}
