import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Copy, FolderOpen, Inbox, KeyRound, Plus, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { SplitLink } from "@/components/SplitLink";
import { copyText } from "@/lib/clipboard";

/** A link with its key shown apart and a copy button. */
function LinkBox({ link, label }: { link: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-well p-2 sm:flex-row sm:items-center sm:pl-4">
      <SplitLink link={link} label={label} />
      <Button type="button" onClick={copy} className="sm:flex-none">
        {copied ? <Check /> : <Copy />}
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}

interface RequestLinksCardProps {
  uploadLink: string;
  inboxLink: string;
  hasPassword: boolean;
  onNewRequest: () => void;
}

/**
 * The two links of a new request, kept clearly apart: the upload link goes to the sender,
 * the inbox link stays with the requester and opens everything that arrives.
 */
export function RequestLinksCard({
  uploadLink,
  inboxLink,
  hasPassword,
  onNewRequest,
}: RequestLinksCardProps) {
  const { t } = useTranslation();
  const [qrOpen, setQrOpen] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const inboxPath = inboxLink.slice(window.location.origin.length);

  return (
    <div className="space-y-6 p-3 sm:p-5">
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
          <Check className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{t("request.created")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("request.createdText")}</p>
        </div>
      </div>

      <section className="space-y-2.5">
        <div>
          <h3 className="text-sm font-semibold">{t("request.uploadLink")}</h3>
          <p className="text-xs text-muted-foreground">{t("request.uploadLinkHint")}</p>
        </div>
        <LinkBox link={uploadLink} label={t("request.uploadLink")} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setQrOpen((v) => !v)}
            aria-expanded={qrOpen}
          >
            <QrCode />
            {t("share.qrCode")}
          </Button>
          {canShare && (
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.share({ title: t("common.appName"), url: uploadLink })}
            >
              <Share2 />
              {t("common.share")}
            </Button>
          )}
        </div>
        {qrOpen && (
          <div className="flex justify-center">
            <div className="rounded-2xl bg-white p-3 shadow-chip">
              <QRCodeSVG value={uploadLink} size={192} level="L" />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-warning" />
            {t("request.inboxLink")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {hasPassword ? t("request.inboxLinkPassword") : t("request.inboxLinkHint")}
          </p>
        </div>
        <div
          role="note"
          className="rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-warning"
        >
          {t("request.inboxLinkWarning")}
        </div>
        <LinkBox link={inboxLink} label={t("request.inboxLink")} />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to={inboxPath}>
            <Inbox />
            {t("request.openInbox")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/uploads?tab=requests">
            <FolderOpen />
            {t("request.toList")}
          </Link>
        </Button>
        <Button type="button" variant="ghost" onClick={onNewRequest}>
          <Plus />
          {t("request.newRequest")}
        </Button>
      </div>
    </div>
  );
}
