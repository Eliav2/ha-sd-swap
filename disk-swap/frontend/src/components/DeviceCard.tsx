import type { Device } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DeviceCardProps {
  device: Device;
  onSelect: () => void;
}

export function DeviceCard({ device, onSelect }: DeviceCardProps) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between">
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
        <Button size="sm" onClick={onSelect}>
          Clone
        </Button>
      </CardContent>
    </Card>
  );
}
