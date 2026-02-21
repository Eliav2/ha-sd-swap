import { Plus, ArrowLeft, ExternalLink } from "lucide-react";
import type { BackupSelection } from "@/types";
import { useBackups } from "@/hooks/use-backups";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackupSelectProps {
  selectedBackup: BackupSelection | null;
  onSelect: (backup: BackupSelection) => void;
  onNext: () => void;
  onBack: () => void;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatSize(sizeMB: number): string {
  if (sizeMB >= 1024) return `${(sizeMB / 1024).toFixed(1)} GB`;
  return `${Math.round(sizeMB)} MB`;
}

export function BackupSelect({ selectedBackup, onSelect, onNext, onBack }: BackupSelectProps) {
  const { data: backups, isLoading, error } = useBackups();

  const isNewSelected = selectedBackup?.type === "new";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Select Backup</h1>
        <p className="text-muted-foreground text-sm">
          Choose an existing backup or create a new one to include in the clone.
        </p>
      </div>

      <div className="space-y-2">
        {/* Create New Backup option */}
        <Card
          size="sm"
          className={cn(
            "cursor-pointer transition-colors",
            isNewSelected
              ? "ring-primary ring-2"
              : "hover:bg-muted/50",
          )}
          onClick={() => onSelect({ type: "new" })}
        >
          <CardContent>
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span className="font-medium">Create New Backup</span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Creates a full backup of your HA configuration, apps, and database.
            </p>
          </CardContent>
        </Card>

        {/* Existing backups */}
        {isLoading && (
          <p className="text-muted-foreground text-sm">Loading backups...</p>
        )}

        {error && (
          <p className="text-destructive text-sm">
            Failed to load backups: {String(error)}
          </p>
        )}

        {backups && backups.length > 0 && backups.map((backup) => {
          const isSelected =
            selectedBackup?.type === "existing" && selectedBackup.slug === backup.slug;
          return (
            <Card
              key={backup.slug}
              size="sm"
              className={cn(
                "cursor-pointer transition-colors",
                isSelected
                  ? "ring-primary ring-2"
                  : "hover:bg-muted/50",
              )}
              onClick={() => onSelect({ type: "existing", slug: backup.slug, name: backup.name })}
            >
              <CardContent>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{backup.name}</span>
                    <Badge variant="secondary">{backup.type}</Badge>
                    <Badge variant="outline">{formatSize(backup.size)}</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(backup.date)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {backups && backups.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No existing backups found. Select "Create New Backup" above.
          </p>
        )}
      </div>

      <a
        href="/config/backup/backups"
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
      >
        Manage backups in Settings
        <ExternalLink className="h-3 w-3" />
      </a>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1"
          disabled={!selectedBackup}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
