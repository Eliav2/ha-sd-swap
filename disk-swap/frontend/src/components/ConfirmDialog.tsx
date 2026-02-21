import type { Device } from "@/types";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  device: Device;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ device, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Erase & Clone</AlertDialogTitle>
          <AlertDialogDescription>
            This will <strong>permanently erase</strong> all data on{" "}
            <strong>
              {device.vendor} {device.model}
            </strong>{" "}
            ({device.size_human}) and clone your Home Assistant OS to it.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Erase & Clone
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
