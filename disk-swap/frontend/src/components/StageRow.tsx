import { ExternalLink } from "lucide-react";
import { formatDuration, intervalToDuration } from "date-fns";
import type { StageState } from "@/types";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function formatSpeed(bytesPerSec: number): string {
  const MB = 1024 * 1024;
  if (bytesPerSec >= MB) return `${(bytesPerSec / MB).toFixed(1)} MB/s`;
  if (bytesPerSec > 0) return `${Math.round(bytesPerSec / 1024)} KB/s`;
  return "0 MB/s";
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return "";
  const duration = intervalToDuration({ start: 0, end: Math.round(seconds) * 1000 });
  const parts = formatDuration(duration, { format: ["hours", "minutes", "seconds"], delimiter: " " });
  return parts ? `~${parts} left` : "";
}

interface StageRowProps {
  stage: StageState;
}

export function StageRow({ stage }: StageRowProps) {
  const eta = stage.status === "in_progress" && stage.eta ? formatEta(stage.eta) : null;

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
        <div className="flex items-center gap-2">
          {eta && (
            <span className="text-muted-foreground text-xs tabular-nums">{eta}</span>
          )}
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
      </div>
      {stage.description && (
        <p className="text-muted-foreground text-xs">
          {stage.description}
          {stage.link && (
            <>
              {" "}
              <a
                href={stage.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {stage.link.text}
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Progress value={stage.progress} className="flex-1">
          <ProgressLabel className="sr-only">{stage.label}</ProgressLabel>
          <ProgressValue />
        </Progress>
        {stage.status === "in_progress" && (
          <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
            {formatSpeed(stage.speed ?? 0)}
          </span>
        )}
      </div>
    </div>
  );
}
