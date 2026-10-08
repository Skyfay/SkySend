import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FirefoxDevToolsWarningProps {
  onRetry: () => void;
  onForce: () => void;
  onDismiss: () => void;
}

export function FirefoxDevToolsWarning({ onRetry, onForce, onDismiss }: FirefoxDevToolsWarningProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning-soft p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="font-semibold text-warning">
            {t("download.firefoxDevToolsWarning")}
          </p>
          <p className="text-sm leading-relaxed text-foreground/80">
            {t("download.firefoxDevToolsWarningDesc")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button className="w-full" onClick={onRetry}>
          <RefreshCw />
          {t("download.firefoxDevToolsRetry")}
        </Button>

        <Button variant="outline" className="w-full" onClick={onForce}>
          <Download />
          {t("download.firefoxDevToolsContinue")}
        </Button>

        <Button variant="ghost" className="w-full" onClick={onDismiss}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
