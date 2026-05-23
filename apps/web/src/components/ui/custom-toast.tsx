import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ExternalLink } from "lucide-react";

export type ToastType = "error" | "warning" | "info" | "success" | "default";

export interface ToastActionButtonsProps {
  /** If provided, shows a Copy button that copies this text. */
  copyText?: string;
  /** If provided, shows a Docs button linking here (opens in new tab). */
  docsUrl?: string;
}

export function ToastActionButtons({ copyText, docsUrl }: ToastActionButtonsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = copyText ?? "";
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copy not possible
    }
  };

  return (
    <div className="mt-1.5 flex gap-1.5">
      {copyText !== undefined && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      )}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {t("common.docs")}
        </a>
      )}
    </div>
  );
}
