import { useEffect } from "react";
import { useStore } from "@tanstack/react-store";
import { appStore, actions } from "@/store";
import { useCloneProgress } from "@/hooks/use-clone-progress";
import { useSystemInfo } from "@/hooks/use-system-info";
import { useImageCache } from "@/hooks/use-image-cache";
import { fetchCurrentJob, startClone } from "@/lib/api";
import { DeviceList } from "@/components/DeviceList";
import { BackupSelect } from "@/components/BackupSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CloneProgress } from "@/components/CloneProgress";
import { SwapComplete } from "@/components/SwapComplete";

export default function App() {
  const screen = useStore(appStore, (s) => s.screen);
  const selectedDevice = useStore(appStore, (s) => s.selectedDevice);
  const selectedBackup = useStore(appStore, (s) => s.selectedBackup);
  const backupName = useStore(appStore, (s) => s.backupName);
  const skipFlash = useStore(appStore, (s) => s.skipFlash);
  const stages = useStore(appStore, (s) => s.stages);
  const { data: systemInfo } = useSystemInfo();
  const { data: imageCache } = useImageCache();

  // On mount, check for an active/completed/failed job and resume if found
  useEffect(() => {
    fetchCurrentJob().then((job) => {
      if (job) actions.resumeJob(job, systemInfo, imageCache);
    }).catch(() => {});
  }, [systemInfo, imageCache]);

  useCloneProgress(screen === "progress");

  async function handleStart() {
    if (!selectedDevice) return;
    actions.startClone(systemInfo, imageCache);
    const backupSlug =
      selectedBackup?.type === "existing" ? selectedBackup.slug : undefined;
    try {
      await startClone(selectedDevice.path, backupSlug, skipFlash);
    } catch {
      // WebSocket will report actual stage errors
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {screen === "device_select" && (
        <DeviceList
          selectedDevice={selectedDevice}
          onSelect={actions.selectDevice}
          onNext={actions.next}
        />
      )}

      {screen === "confirm" && selectedDevice && (
        <ConfirmDialog
          device={selectedDevice}
          onConfirm={actions.confirmErase}
          onCancel={actions.cancel}
        />
      )}

      {screen === "backup_select" && selectedDevice && (
        <BackupSelect
          device={selectedDevice}
          selectedBackup={selectedBackup}
          skipFlash={skipFlash}
          onSelect={actions.selectBackup}
          onSetSkipFlash={actions.setSkipFlash}
          onNext={handleStart}
          onBack={actions.backToDeviceSelect}
        />
      )}

      {screen === "progress" && selectedDevice && (
        <CloneProgress device={selectedDevice} stages={stages} />
      )}

      {screen === "complete" && selectedDevice && (
        <SwapComplete
          device={selectedDevice}
          backupName={backupName}
          onReset={actions.reset}
        />
      )}
    </div>
  );
}
