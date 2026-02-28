import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatDuration, intervalToDuration } from "date-fns";
import type { StageState } from "@/types";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function useAnimatedDots(active: boolean) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (!active) { setCount(1); return; }
    const id = setInterval(() => setCount((c) => (c % 3) + 1), 500);
    return () => clearInterval(id);
  }, [active]);
  return ".".repeat(count);
}

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
  logsUrl?: string;
}

export function StageRow({ stage, logsUrl }: StageRowProps) {
  const eta = stage.status === "in_progress" && stage.eta ? formatEta(stage.eta) : null;
  const hasEllipsis = stage.description?.endsWith("\u2026");
  const dots = useAnimatedDots(stage.status === "in_progress" && !!hasEllipsis);
  const description = hasEllipsis ? stage.description!.slice(0, -1) + dots : stage.description;

  const statusBadge = {
    pending: { variant: "secondary" as const, label: "Pending" },
    in_progress: { variant: "default" as const, label: "Running" },
    completed: { variant: "outline" as const, label: "Done" },
    failed: { variant: "destructive" as const, label: "Failed" },
  }[stage.status];

  return (
    <div className={cn("space-y-1.5", stage.status === "pending" && "opacity-50")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{stage.label}</span>
          {stage.experimental && (
            <Badge variant="outline" className="border-amber-400 text-amber-600 text-[10px] px-1.5 py-0">
              Experimental
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {eta && (
            <span className="text-muted-foreground text-xs tabular-nums">{eta}</span>
          )}
          {stage.status === "failed" && logsUrl ? (
            <a href={logsUrl} target="_top">
              <Badge variant={statusBadge.variant} className="cursor-pointer hover:opacity-80">
                {statusBadge.label} — view logs ↗
              </Badge>
            </a>
          ) : (
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          )}
        </div>
      </div>
      {description && (
        <p className="text-muted-foreground text-xs">
          {description}
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
        {stage.status === "in_progress" && !!stage.speed && (
          <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
            {formatSpeed(stage.speed)}
          </span>
        )}
      </div>
    </div>
  );
}
