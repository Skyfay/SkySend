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
      <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 dark:border-orange-700 dark:bg-orange-950/30">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
        <div className="space-y-1">
          <p className="font-medium text-orange-800 dark:text-orange-300">
            {t("download.firefoxDevToolsWarning")}
          </p>
          <p className="text-sm text-orange-700 dark:text-orange-400">
            {t("download.firefoxDevToolsWarningDesc")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="outline" className="w-full" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("download.firefoxDevToolsRetry")}
        </Button>

        <Button variant="secondary" className="w-full" onClick={onForce}>
          <Download className="mr-2 h-4 w-4" />
          {t("download.firefoxDevToolsContinue")}
        </Button>

        <Button variant="ghost" className="w-full" onClick={onDismiss}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
