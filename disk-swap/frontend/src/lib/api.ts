import type { BackupsResponse, DevicesResponse, ImageCacheStatus, Job, SystemInfoResponse } from "@/types";

/** All paths are relative (no leading /) for HA ingress compatibility. */

export async function fetchDevices(): Promise<DevicesResponse> {
  const res = await fetch("api/devices");
  if (!res.ok) throw new Error(`Failed to fetch devices: ${res.status}`);
  return res.json();
}

export async function fetchSystemInfo(): Promise<SystemInfoResponse> {
  const res = await fetch("api/system-info");
  if (!res.ok) throw new Error(`Failed to fetch system info: ${res.status}`);
  return res.json();
}

export async function fetchBackups(): Promise<BackupsResponse> {
  const res = await fetch("api/backups");
  if (!res.ok) throw new Error(`Failed to fetch backups: ${res.status}`);
  return res.json();
}

export async function startClone(devicePath: string, backupSlug?: string, skipFlash?: boolean): Promise<void> {
  const res = await fetch("api/start-clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: devicePath, backup_slug: backupSlug, skip_flash: skipFlash }),
  });
  if (!res.ok) throw new Error(`Failed to start clone: ${res.status}`);
}

export async function cancelClone(): Promise<void> {
  const res = await fetch("api/cancel-clone", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to cancel clone: ${res.status}`);
}

export async function fetchImageCache(): Promise<ImageCacheStatus> {
  const res = await fetch("api/image-cache");
  if (!res.ok) throw new Error(`Failed to fetch image cache: ${res.status}`);
  return res.json();
}

export async function discardImageCache(): Promise<void> {
  const res = await fetch("api/image-cache", { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to discard image cache: ${res.status}`);
}

export async function fetchCurrentJob(): Promise<Job | null> {
  const res = await fetch("api/jobs/current");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch job: ${res.status}`);
  return res.json();
}
