import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

interface SafariWarningProps {
  fileSize: number;
  onContinue: () => void;
  onDismiss: () => void;
}

export function SafariWarning({ fileSize, onContinue, onDismiss }: SafariWarningProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 dark:border-orange-700 dark:bg-orange-950/30">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
        <div className="space-y-1">
          <p className="font-medium text-orange-800 dark:text-orange-300">
            {t("download.safariWarning")}
          </p>
          <p className="text-sm text-orange-700 dark:text-orange-400">
            {t("download.safariWarningDesc")} ({formatBytes(fileSize)})
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="outline" className="w-full" onClick={copyLink}>
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              {t("download.safariLinkCopied")}
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              {t("download.safariCopyLink")}
            </>
          )}
        </Button>

        <Button variant="secondary" className="w-full" onClick={onContinue}>
          <Download className="mr-2 h-4 w-4" />
          {t("download.safariContinue")}
        </Button>

        <Button variant="ghost" className="w-full" onClick={onDismiss}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
