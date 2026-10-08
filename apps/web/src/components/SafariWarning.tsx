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
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning-soft p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="font-semibold text-warning">
            {t("download.safariWarning")}
          </p>
          <p className="text-sm leading-relaxed text-foreground/80">
            {t("download.safariWarningDesc")} ({formatBytes(fileSize)})
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button className="w-full" onClick={copyLink}>
          {copied ? (
            <>
              <Check />
              {t("download.safariLinkCopied")}
            </>
          ) : (
            <>
              <Copy />
              {t("download.safariCopyLink")}
            </>
          )}
        </Button>

        <Button variant="outline" className="w-full" onClick={onContinue}>
          <Download />
          {t("download.safariContinue")}
        </Button>

        <Button variant="ghost" className="w-full" onClick={onDismiss}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
