import type { Device } from "@/types";
import { useDevices } from "@/hooks/use-devices";
import { useSystemInfo } from "@/hooks/use-system-info";
import { DeviceCard } from "@/components/DeviceCard";
import { SystemInfo } from "@/components/SystemInfo";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

interface DeviceListProps {
  selectedDevice: Device | null;
  onSelect: (device: Device) => void;
  onNext: () => void;
}

export function DeviceList({ selectedDevice, onSelect, onNext }: DeviceListProps) {
  const { data: devices, isLoading, error } = useDevices();
  const { data: systemInfo } = useSystemInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Disk Swap</h1>
        <p className="text-muted-foreground text-sm">
          Clone your Home Assistant OS to a USB device.
        </p>
      </div>

      {systemInfo && <SystemInfo info={systemInfo} />}

      <div>
        <h2 className="mb-3 text-sm font-medium">Select a USB device</h2>

        {isLoading && (
          <p className="text-muted-foreground text-sm">Scanning for devices...</p>
        )}

        {error && (
          <p className="text-destructive text-sm">
            Failed to load devices: {String(error)}
          </p>
        )}

        {!isLoading && !error && devices?.length === 0 && <EmptyState />}

        {devices && devices.length > 0 && (
          <div className="space-y-2">
            {devices.map((device) => (
              <DeviceCard
                key={device.serial}
                device={device}
                selected={selectedDevice?.serial === device.serial}
                onSelect={() => onSelect(device)}
              />
            ))}
          </div>
        )}
      </div>

      <Button
        className="w-full"
        disabled={!selectedDevice}
        onClick={onNext}
      >
        Next
      </Button>
    </div>
  );
}
