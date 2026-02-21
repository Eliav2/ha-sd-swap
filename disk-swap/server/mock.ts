import type { Device } from "../shared/types.ts";

/** Mock USB devices for local development */
export async function listUsbDevices(): Promise<Device[]> {
  return [
    {
      name: "sda",
      path: "/dev/sda",
      size: 32_000_000_000,
      size_human: "30 GB",
      vendor: "SanDisk",
      model: "Ultra Fit",
      tran: "usb",
      serial: "FAKE001",
    },
    {
      name: "sdb",
      path: "/dev/sdb",
      size: 64_000_000_000,
      size_human: "60 GB",
      vendor: "Samsung",
      model: "EVO Select",
      tran: "usb",
      serial: "FAKE002",
    },
  ];
}

/** Mock system info for local development */
export async function getSystemInfo() {
  return {
    machine: "raspberrypi4-64",
    board_slug: "rpi4-64",
    os_version: "17.1",
    os_version_latest: "17.1",
    ip_address: "192.168.1.100",
    free_space_bytes: 24_696_061_952,
    free_space_human: "23.0 GB",
  };
}
