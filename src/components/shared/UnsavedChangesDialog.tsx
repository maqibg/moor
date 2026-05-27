import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/hooks/useI18n";

interface UnsavedChangesDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  actionLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UnsavedChangesDialog({
  open,
  title = "Discard unsaved changes?",
  description = "You have unsaved changes. They will be lost if you continue.",
  actionLabel = "Discard changes",
  onCancel,
  onConfirm,
}: UnsavedChangesDialogProps) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(title)}</AlertDialogTitle>
          <AlertDialogDescription>{t(description)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-error-warm text-surface-200 hover:bg-error-warm/90"
            onClick={onConfirm}
          >
            {t(actionLabel)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
