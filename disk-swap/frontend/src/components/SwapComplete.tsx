import type { Device } from "@/types";
import { useSystemInfo } from "@/hooks/use-system-info";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface SwapCompleteProps {
  device: Device;
  onReset: () => void;
}

export function SwapComplete({ device, onReset }: SwapCompleteProps) {
  const { data: systemInfo } = useSystemInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clone Complete</h1>
        <p className="text-muted-foreground text-sm">
          HA OS has been cloned to {device.vendor} {device.model}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next Steps</CardTitle>
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
            <li>Power on and wait for HA to boot.</li>
          </ol>

          {systemInfo?.ip_address && (
            <>
              <Separator />
              <p className="text-muted-foreground">
                After booting, access Home Assistant at{" "}
                <strong>http://{systemInfo.ip_address}:8123</strong>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={onReset}>
        Start New Clone
      </Button>
    </div>
  );
}
