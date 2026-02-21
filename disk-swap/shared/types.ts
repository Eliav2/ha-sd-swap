/** Raw block device from lsblk --json output */
export interface RawBlockDevice {
  name: string;
  size: number | string;
  type: string;
  tran: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
}

/** Filtered, safe USB device returned by GET /api/devices */
export interface Device {
  name: string;
  path: string;
  size: number;
  size_human: string;
  vendor: string;
  model: string;
  tran: string;
  serial: string;
}

/** Response shape for GET /api/devices */
export interface DevicesResponse {
  devices: Device[];
}

/** Response shape for GET /api/system-info */
export interface SystemInfoResponse {
  machine: string;
  board_slug: string;
  os_version: string;
  os_version_latest: string;
  ip_address: string;
  free_space_bytes: number;
  free_space_human: string;
}

/** Supervisor GET /info response data */
export interface SupervisorInfo {
  machine: string;
  arch: string;
  supported: boolean;
  channel: string;
}

/** Supervisor GET /os/info response data */
export interface OsInfo {
  version: string;
  version_latest: string;
  board: string;
}

/** Supervisor GET /host/info response data (subset we use) */
export interface HostInfo {
  hostname: string;
  disk_total: number;
  disk_used: number;
  disk_free: number;
}

/** Supervisor GET /network/info response data (subset we use) */
export interface NetworkInfo {
  interfaces: Array<{
    interface: string;
    ipv4?: { address?: string[] };
  }>;
}
