import { useState } from "react";
import type { Device, StageState } from "@/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StageRow } from "@/components/StageRow";
import { cancelClone } from "@/lib/api";
import { actions } from "@/store";

interface CloneProgressProps {
  device: Device;
  stages: StageState[];
}

export function CloneProgress({ device, stages }: CloneProgressProps) {
  const [cancelling, setCancelling] = useState(false);

  const activeStage = stages.find((s) => s.status === "in_progress");
  const isWriting = activeStage?.name === "flash" || activeStage?.name === "inject";
  const hasFailed = stages.some((s) => s.status === "failed");
  const isFinished = stages.every(
    (s) => s.status === "completed" || s.status === "failed",
  );

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelClone();
      actions.reset();
    } catch {
      setCancelling(false);
    }
  }

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

      {!isFinished && (
        <>
          <Button
            variant="outline"
            className="w-full"
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling
              ? "Cancelling..."
              : isWriting
                ? "Cancel (will interrupt write)"
                : "Cancel"}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            You can safely navigate away — cloning continues in the background.
          </p>
        </>
      )}

      {hasFailed && (
        <Button
          variant="outline"
          className="w-full"
          onClick={actions.reset}
        >
          Start Over
        </Button>
      )}
    </div>
  );
}
