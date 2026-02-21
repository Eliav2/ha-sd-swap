import type {
  SupervisorInfo,
  OsInfo,
  HostInfo,
  NetworkInfo,
} from "../shared/types.ts";

const SUPERVISOR_URL = "http://supervisor";

/** Machine name → HAOS board slug lookup table */
const MACHINE_TO_SLUG: Record<string, string> = {
  "raspberrypi3": "rpi3",
  "raspberrypi3-64": "rpi3-64",
  "raspberrypi4": "rpi4",
  "raspberrypi4-64": "rpi4-64",
  "raspberrypi5-64": "rpi5-64",
  "generic-x86-64": "generic-x86-64",
  "generic-aarch64": "generic-aarch64",
  "odroid-c2": "odroid-c2",
  "odroid-c4": "odroid-c4",
  "odroid-m1": "odroid-m1",
  "odroid-n2": "odroid-n2",
  "odroid-xu": "odroid-xu",
  "tinker": "tinker",
  "khadas-vim3": "khadas-vim3",
  "green": "green",
  "yellow": "yellow",
};

export function machineToBoardSlug(machine: string): string {
  const slug = MACHINE_TO_SLUG[machine];
  if (!slug) throw new Error(`Unsupported machine type: "${machine}"`);
  return slug;
}

function supervisorHeaders(): Record<string, string> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error(
      "SUPERVISOR_TOKEN not found. This add-on must run inside Home Assistant."
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Generic Supervisor API GET — unwraps the { result, data } envelope */
async function supervisorGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPERVISOR_URL}${path}`, {
    headers: supervisorHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supervisor API ${path} returned ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    result: string;
    data: T;
    message?: string;
  };

  if (json.result !== "ok") {
    throw new Error(
      `Supervisor API ${path} result="${json.result}": ${json.message ?? "unknown error"}`
    );
  }

  return json.data;
}

export async function getInfo(): Promise<SupervisorInfo> {
  return supervisorGet<SupervisorInfo>("/info");
}

export async function getOsInfo(): Promise<OsInfo> {
  return supervisorGet<OsInfo>("/os/info");
}

export async function getHostInfo(): Promise<HostInfo> {
  return supervisorGet<HostInfo>("/host/info");
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  return supervisorGet<NetworkInfo>("/network/info");
}

function formatBytes(bytes: number): string {
  const GB = 1024 ** 3;
  const TB = 1024 ** 4;
  if (bytes >= TB) return `${(bytes / TB).toFixed(1)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  const MB = 1024 ** 2;
  return `${Math.round(bytes / MB)} MB`;
}

function extractIpAddress(network: NetworkInfo): string {
  for (const iface of network.interfaces) {
    if (iface.interface === "lo") continue;
    const addresses = iface.ipv4?.address;
    if (addresses && addresses.length > 0) {
      // Strip CIDR suffix (e.g. "192.168.1.42/24" → "192.168.1.42")
      return addresses[0].split("/")[0];
    }
  }
  return "unknown";
}

/** Aggregate system info from multiple Supervisor endpoints */
export async function getSystemInfo() {
  const [info, osInfo, hostInfo, networkInfo] = await Promise.all([
    getInfo(),
    getOsInfo(),
    getHostInfo(),
    getNetworkInfo(),
  ]);

  return {
    machine: info.machine,
    board_slug: machineToBoardSlug(info.machine),
    os_version: osInfo.version,
    os_version_latest: osInfo.version_latest,
    ip_address: extractIpAddress(networkInfo),
    free_space_bytes: hostInfo.disk_free,
    free_space_human: formatBytes(hostInfo.disk_free),
  };
}
