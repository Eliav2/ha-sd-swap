import type { Device, StageState } from "@/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StageRow } from "@/components/StageRow";

interface CloneProgressProps {
  device: Device;
  stages: StageState[];
}

export function CloneProgress({ device, stages }: CloneProgressProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cloning...</h1>
        <p className="text-muted-foreground text-sm">
          Writing to {device.vendor} {device.model} ({device.size_human}).
          Do not unplug the device.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>{device.path}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stages.map((stage) => (
            <StageRow key={stage.name} stage={stage} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
