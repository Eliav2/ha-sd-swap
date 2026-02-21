import { Card, CardContent } from "@/components/ui/card";

export function EmptyState() {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <p className="text-muted-foreground text-sm">
          No USB devices detected. Plug in a USB device and it will appear here.
        </p>
      </CardContent>
    </Card>
  );
}
