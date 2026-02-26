import { Store } from "@tanstack/react-store";
import type { BackupSelection, Device, ImageCacheStatus, Job, Screen, StageState, SystemInfoResponse } from "@/types";
import { clearCurrentJob } from "@/lib/api";

export interface AppState {
  screen: Screen;
  selectedDevice: Device | null;
  selectedBackup: BackupSelection | null;
  backupName: string | null;
  skipFlash: boolean;
  stages: StageState[];
}

const defaultStages: StageState[] = [
  { name: "backup", label: "Backup", description: "", status: "pending", progress: 0 },
  { name: "download", label: "Download HA OS image", description: "", status: "pending", progress: 0 },
  { name: "flash", label: "Flash to device", description: "", status: "pending", progress: 0 },
  { name: "inject", label: "Inject backup", description: "", status: "pending", progress: 0 },
];

export const appStore = new Store<AppState>({
  screen: "device_select",
  selectedDevice: null,
  selectedBackup: null,
  backupName: null,
  skipFlash: false,
  stages: defaultStages,
});

/** Build stages with dynamic descriptions based on user selections and system info. */
function buildStages(
  backup: BackupSelection,
  systemInfo?: SystemInfoResponse | null,
  imageCache?: ImageCacheStatus | null,
  skipFlash?: boolean,
): StageState[] {
  const version = systemInfo?.os_version ?? "latest";
  const board = systemInfo?.board_slug ?? "your device";
  const releaseUrl = `https://github.com/home-assistant/operating-system/releases/tag/${version}`;
  const isCached = imageCache?.cached === true;

  const downloadDesc = skipFlash
    ? "Skipped — device already has HA OS."
    : isCached
      ? `Using cached HA OS ${version} image for ${board}.`
      : `Downloads HA OS ${version} for ${board}.`;

  const downloadLabel = skipFlash
    ? "Download HA OS image (skipped)"
    : isCached
      ? "Download HA OS image (cached)"
      : "Download HA OS image";

  return [
    {
      name: "backup",
      label: "Backup",
      description: backup.type === "new"
        ? "Creates a full backup of your HA configuration, apps, and database."
        : `Using existing backup "${backup.name}".`,
      status: "pending",
      progress: 0,
    },
    {
      name: "download",
      label: downloadLabel,
      description: downloadDesc,
      link: skipFlash ? undefined : { text: "View release", url: releaseUrl },
      status: "pending",
      progress: 0,
    },
    {
      name: "flash",
      label: skipFlash ? "Flash to device (skipped)" : "Flash to device",
      description: skipFlash
        ? "Skipped — device already has HA OS."
        : "Writes the OS image to the target USB device.",
      status: "pending",
      progress: 0,
    },
    {
      name: "inject",
      label: "Inject backup",
      description: "Copies backup to the new device for automatic restore on first boot.",
      status: "pending",
      progress: 0,
    },
  ];
}

export const actions = {
  selectDevice(device: Device) {
    appStore.setState((s) => ({ ...s, selectedDevice: device }));
  },

  next() {
    appStore.setState((s) => ({ ...s, screen: "confirm" as const }));
  },

  /** After the erase warning, go to backup selection. */
  confirmErase() {
    appStore.setState((s) => ({
      ...s,
      screen: "backup_select" as const,
      skipFlash: s.selectedDevice?.has_ha_os ?? false,
    }));
  },

  selectBackup(backup: BackupSelection) {
    appStore.setState((s) => ({ ...s, selectedBackup: backup }));
  },

  setSkipFlash(skip: boolean) {
    appStore.setState((s) => ({ ...s, skipFlash: skip }));
  },

  /** Start the pipeline after backup is selected. */
  startClone(systemInfo?: SystemInfoResponse | null, imageCache?: ImageCacheStatus | null) {
    appStore.setState((s) => {
      const backup = s.selectedBackup ?? { type: "new" as const };
      return {
        ...s,
        screen: "progress" as const,
        stages: buildStages(backup, systemInfo, imageCache, s.skipFlash),
      };
    });
  },

  cancel() {
    appStore.setState((s) => ({
      ...s,
      screen: "device_select" as const,
      selectedDevice: null,
      selectedBackup: null,
      backupName: null,
      skipFlash: false,
    }));
  },

  /** Go back from backup_select to confirm (device selection). */
  backToDeviceSelect() {
    appStore.setState((s) => ({
      ...s,
      screen: "device_select" as const,
      selectedBackup: null,
      skipFlash: false,
    }));
  },

  updateStage(stageName: string, status: StageState["status"], progress: number, speed?: number, eta?: number, description?: string) {
    appStore.setState((s) => ({
      ...s,
      stages: s.stages.map((st) =>
        st.name === stageName ? { ...st, status, progress, speed, eta, ...(description != null && { description }) } : st
      ),
    }));
  },

  complete(backupName?: string | null) {
    appStore.setState((s) => ({
      ...s,
      screen: "complete" as const,
      backupName: backupName ?? s.backupName,
    }));
  },

  resumeJob(job: Job, systemInfo?: SystemInfoResponse | null, imageCache?: ImageCacheStatus | null) {
    const screen: Screen =
      job.status === "completed" ? "complete" : "progress";

    const base = buildStages({ type: "new" }, systemInfo, imageCache);
    const stages: StageState[] = base.map((init) => {
      const jobStage = job.stages[init.name];
      return {
        ...init,
        status: jobStage?.status ?? "pending",
        progress: jobStage?.progress ?? 0,
        ...(jobStage?.description && { description: jobStage.description }),
      };
    });

    appStore.setState(() => ({
      screen,
      selectedDevice: job.device,
      selectedBackup: null,
      backupName: job.backupName,
      skipFlash: false,
      stages,
    }));
  },

  reset() {
    clearCurrentJob().catch(() => {});
    appStore.setState(() => ({
      screen: "device_select" as const,
      selectedDevice: null,
      selectedBackup: null,
      backupName: null,
      skipFlash: false,
      stages: defaultStages.map((st) => ({ ...st })),
    }));
  },
};
