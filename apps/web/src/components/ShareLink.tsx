import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Lock, Plus, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

interface ShareLinkProps {
  link: string;
  averageSpeed?: string | null;
  onNewUpload: () => void;
  children?: ReactNode;
}

/**
 * The finished share: the link with its key shown apart from the rest, copy, share and
 * QR code. data-share-done lets the share form hide its tabs while this is shown.
 */
export function ShareLink({ link, averageSpeed, onNewUpload, children }: ShareLinkProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLarge, setQrLarge] = useState(false);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  // The key is the fragment. Showing it apart makes visible what never reaches the server.
  const hashIndex = link.indexOf("#");
  const base = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
  const key = hashIndex >= 0 ? link.slice(hashIndex) : "";

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-share-done className="space-y-5 p-3 sm:p-5">
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
          <Check className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{t("upload.uploadComplete")}</h2>
          <p className="text-[13px] text-muted-foreground">
            {t("upload.shareLink")}
            {averageSpeed && <span> · Ø {averageSpeed}</span>}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-well p-2 sm:flex-row sm:items-center sm:pl-4">
        {/* One click selects the whole link. It wraps instead of truncating, so the key
            at its end always stays visible. */}
        <p
          aria-label={t("upload.shareLink")}
          className="min-w-0 flex-1 select-all break-all px-2 py-1.5 font-mono text-[13px] leading-relaxed sm:px-0"
        >
          <span className="text-muted-foreground">{base}</span>
          <span className="font-semibold text-primary-text">{key}</span>
        </p>
        <div className="flex gap-2">
          <Button onClick={copyToClipboard} className="flex-1 sm:flex-none">
            {copied ? <Check /> : <Copy />}
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
          {canShare && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigator.share({ title: t("common.appName"), url: link })}
              aria-label={t("common.share")}
            >
              <Share2 />
            </Button>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("upload.shareLinkHint")}
      </p>

      {qrOpen && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setQrLarge((v) => !v)}
            aria-label={t("share.qrResize")}
            className="cursor-pointer rounded-2xl bg-white p-3 shadow-chip transition-transform hover:scale-[1.02]"
          >
            <QRCodeSVG value={link} size={qrLarge ? 256 : 152} level="L" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setQrOpen((v) => !v)} aria-expanded={qrOpen}>
          <QrCode />
          {t("share.qrCode")}
        </Button>
        <Button variant="ghost" onClick={onNewUpload}>
          <Plus />
          {t("upload.newUpload")}
        </Button>
      </div>
      {children}
    </div>
  );
}
