import { useStore } from "@tanstack/react-store";
import { appStore, actions } from "@/store";
import { useCloneProgress } from "@/hooks/use-clone-progress";
import { startClone } from "@/lib/api";
import { DeviceList } from "@/components/DeviceList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CloneProgress } from "@/components/CloneProgress";
import { SwapComplete } from "@/components/SwapComplete";

export default function App() {
  const screen = useStore(appStore, (s) => s.screen);
  const selectedDevice = useStore(appStore, (s) => s.selectedDevice);
  const stages = useStore(appStore, (s) => s.stages);

  useCloneProgress(screen === "progress");

  async function handleConfirm() {
    if (!selectedDevice) return;
    actions.confirm();
    try {
      await startClone(selectedDevice.path);
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
          onConfirm={handleConfirm}
          onCancel={actions.cancel}
        />
      )}

      {screen === "progress" && selectedDevice && (
        <CloneProgress device={selectedDevice} stages={stages} />
      )}

      {screen === "complete" && selectedDevice && (
        <SwapComplete
          device={selectedDevice}
          onReset={actions.reset}
        />
      )}
    </div>
  );
}
