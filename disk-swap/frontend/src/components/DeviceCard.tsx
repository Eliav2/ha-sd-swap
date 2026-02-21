import type { Device } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DeviceCardProps {
  device: Device;
  selected: boolean;
  onSelect: () => void;
}

export function DeviceCard({ device, selected, onSelect }: DeviceCardProps) {
  return (
    <Card
      size="sm"
      className={cn(
        "cursor-pointer transition-colors",
        selected
          ? "ring-primary ring-2"
          : "hover:bg-muted/50"
      )}
      onClick={onSelect}
    >
      <CardContent>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {device.vendor} {device.model}
            </span>
            <Badge variant="secondary">{device.size_human}</Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            {device.path} &middot; {device.serial}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
