import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import type { UploadPhase } from "@/hooks/useUpload";

interface UploadProgressProps {
  phase: UploadPhase;
  progress: number;
}

export function UploadProgress({ phase, progress }: UploadProgressProps) {
  const { t } = useTranslation();

  const label =
    phase === "zipping"
      ? t("upload.processing")
      : phase === "encrypting"
        ? t("upload.processing")
        : phase === "uploading"
          ? t("upload.uploading")
          : phase === "saving-meta"
            ? t("upload.processing")
            : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto text-sm text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} aria-label={label} />
    </div>
  );
}
