import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "error" | "warning" | "info" | "success" | "default";

export interface CustomToastProps {
  onDismiss: () => void;
  type?: ToastType;
  message: string;
  description?: string;
  /** If provided, shows a Copy button that copies this text. Pass the message to copy the title. */
  copyText?: string;
  /** If provided, shows a Docs button linking here (opens in new tab). */
  docsUrl?: string;
}

const TYPE_CONFIG: Record<
  ToastType,
  { icon: typeof AlertCircle | null; iconClass: string }
> = {
  error: { icon: AlertCircle, iconClass: "text-destructive" },
  warning: { icon: AlertTriangle, iconClass: "text-amber-500" },
  info: { icon: Info, iconClass: "text-blue-500" },
  success: { icon: CheckCircle2, iconClass: "text-success" },
  default: { icon: null, iconClass: "" },
};

export function CustomToast({
  onDismiss,
  type = "default",
  message,
  description,
  copyText,
  docsUrl,
}: CustomToastProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  const config = TYPE_CONFIG[type];
  const IconComponent = config.icon;
  const hasActions = copyText !== undefined || !!docsUrl;

  const handleCopy = async () => {
    const text = copyText ?? message;
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

  if (dismissed) return null;

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
      <div className="flex items-start gap-3">
        {IconComponent && (
          <div className={cn("mt-0.5 shrink-0", config.iconClass)}>
            <IconComponent className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-card-foreground">
            {message}
          </p>
          {description && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleDismiss}
          className="ml-1 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hasActions && (
        <div className={cn("flex gap-1.5", IconComponent ? "ml-7" : "")}>
          {copyText !== undefined && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
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
      )}
    </div>
  );
}
