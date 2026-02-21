import type { StageState } from "@/types";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StageRowProps {
  stage: StageState;
}

export function StageRow({ stage }: StageRowProps) {
  const statusBadge = {
    pending: { variant: "secondary" as const, label: "Pending" },
    in_progress: { variant: "default" as const, label: "Running" },
    completed: { variant: "outline" as const, label: "Done" },
    failed: { variant: "destructive" as const, label: "Failed" },
  }[stage.status];

  return (
    <div className={cn("space-y-1.5", stage.status === "pending" && "opacity-50")}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{stage.label}</span>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>
      <Progress value={stage.progress}>
        <ProgressLabel className="sr-only">{stage.label}</ProgressLabel>
        <ProgressValue />
      </Progress>
    </div>
  );
}
