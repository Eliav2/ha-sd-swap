import type { DevicesResponse, SystemInfoResponse } from "@/types";

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

export async function startClone(devicePath: string): Promise<void> {
  const res = await fetch("api/start-clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: devicePath }),
  });
  if (!res.ok) throw new Error(`Failed to start clone: ${res.status}`);
}
