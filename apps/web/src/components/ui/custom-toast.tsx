import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText as copyToClipboard } from "@/lib/clipboard";

export type ToastType = "error" | "warning" | "info" | "success" | "default";

export interface ToastActionButtonsProps {
  /** If provided, shows a Copy button that copies this text. */
  copyText?: string;
  /** If provided, shows a Docs button linking here (opens in new tab). */
  docsUrl?: string;
}

const ACTION = "h-[30px] gap-1.5 rounded-[9px] px-2.5 text-xs [&_svg]:size-3.5";

export function ToastActionButtons({ copyText, docsUrl }: ToastActionButtonsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyToClipboard(copyText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copy not possible
    }
  };

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {copyText !== undefined && (
        <Button type="button" variant="outline" size="sm" className={ACTION} onClick={handleCopy}>
          {copied ? <Check /> : <Copy />}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      )}
      {docsUrl && (
        <Button asChild variant="outline" size="sm" className={ACTION}>
          <a href={docsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t("common.docs")}
          </a>
        </Button>
      )}
    </div>
  );
}
