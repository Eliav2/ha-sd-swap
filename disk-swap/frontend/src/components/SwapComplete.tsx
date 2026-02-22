import type { Device } from "@/types";
import { useSystemInfo } from "@/hooks/use-system-info";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SwapCompleteProps {
  device: Device;
  backupName: string | null;
  onReset: () => void;
}

export function SwapComplete({ device, backupName, onReset }: SwapCompleteProps) {
  const { data: systemInfo } = useSystemInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clone Complete</h1>
        <p className="text-muted-foreground text-sm">
          HA OS has been cloned to {device.vendor} {device.model}.
        </p>
      </div>

      {/* Section 1: Boot from cloned device */}
      <Card>
        <CardHeader>
          <CardTitle>Boot from cloned device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-inside list-decimal space-y-2">
            <li>Shut down your Home Assistant device.</li>
            <li>Remove the current boot media (SD card).</li>
            <li>
              Insert the cloned USB device (
              <strong>
                {device.vendor} {device.model}
              </strong>
              ).
            </li>
            <li>Power on and wait for HA to boot (~5 minutes).</li>
            <li>
              Log in with your existing credentials
              {systemInfo?.ip_address && (
                <>
                  {" "}at{" "}
                  <strong>http://{systemInfo.ip_address}:8123</strong>
                </>
              )}
              .
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            Your configuration, automations, and history are automatically restored on first boot.
          </p>
        </CardContent>
      </Card>

      {/* Section 2: Restore apps */}
      <Card>
        <CardHeader>
          <CardTitle>Restore apps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Apps are not auto-restored and need one extra step.
          </p>
          <ol className="list-inside list-decimal space-y-2">
            <li>
              Go to <strong>Settings</strong> &rarr; <strong>System</strong> &rarr;{" "}
              <strong>Backups</strong>.
            </li>
            <li>
              Select the backup
              {backupName ? (
                <> named <strong>"{backupName}"</strong></>
              ) : null}
              .
            </li>
            <li>Choose <strong>Restore</strong> and select the apps you want.</li>
            <li>Wait for apps to download and install.</li>
          </ol>
          <p className="text-muted-foreground text-xs">
            After restoring apps, your Home Assistant will be fully identical to the original.
          </p>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={onReset}>
        Start New Clone
      </Button>
    </div>
  );
}
