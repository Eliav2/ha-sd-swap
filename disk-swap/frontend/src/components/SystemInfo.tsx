import type { SystemInfoResponse } from "@/types";
import { Card, CardContent } from "@/components/ui/card";

interface SystemInfoProps {
  info: SystemInfoResponse;
}

export function SystemInfo({ info }: SystemInfoProps) {
  return (
    <Card size="sm">
      <CardContent>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">Machine</dt>
            <dd className="font-medium">{info.machine}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">HA OS</dt>
            <dd className="font-medium">{info.os_version}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Free Space</dt>
            <dd className="font-medium">{info.free_space_human}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
