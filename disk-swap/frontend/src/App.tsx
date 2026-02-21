import { useStore } from "@tanstack/react-store";
import { appStore, actions } from "@/store";
import { useMockProgress } from "@/hooks/use-mock-progress";
import { DeviceList } from "@/components/DeviceList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CloneProgress } from "@/components/CloneProgress";
import { SwapComplete } from "@/components/SwapComplete";

export default function App() {
  const screen = useStore(appStore, (s) => s.screen);
  const selectedDevice = useStore(appStore, (s) => s.selectedDevice);
  const stages = useStore(appStore, (s) => s.stages);

  useMockProgress(screen === "progress");

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
          onConfirm={actions.confirm}
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
