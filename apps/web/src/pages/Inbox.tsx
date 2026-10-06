import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Ban,
  Check,
  Clock,
  Copy,
  FileQuestion,
  Inbox,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Glow } from "@/components/Glow";
import { LinkGone } from "@/components/LinkGone";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { SafariWarning } from "@/components/SafariWarning";
import { FirefoxDevToolsWarning } from "@/components/FirefoxDevToolsWarning";
import { InboxFileRow } from "@/components/InboxFileRow";
import { useInbox } from "@/hooks/useInbox";
import { useServerConfig } from "@/hooks/useServerConfig";
import { NotFoundPage } from "@/pages/NotFound";
import { hashWasmArgon2 } from "@/lib/argon2";
import { copyText } from "@/lib/clipboard";
import { requestLinks, type OpenedUpload } from "@/lib/file-request";
import { showKnownErrorToast, showRewrittenLinkWarning } from "@/lib/toast";
import { wasShareLinkRewritten } from "@/lib/rewritten-link";
import {
  formatBytes,
  formatTimeRemaining,
  isDevToolsOpen,
  isFirefox,
  isSafari,
  SAFARI_BIG_SIZE,
} from "@/lib/utils";

/** What the confirmation dialog asks about. Each of them cannot be undone. */
type Confirm = { kind: "close" } | { kind: "delete" } | { kind: "file"; entry: OpenedUpload };

/** A download waiting for the user to confirm a browser warning first. */
type PendingDownload = { entry: OpenedUpload; reason: "safari" | "devtools" };

function InboxShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto max-w-3xl">
      <Glow />
      <div className="relative space-y-6">
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px] wrap-anywhere"
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

/**
 * The inbox of a file request. The link carries the key, and it stays in the address bar
 * on purpose: unlike a download link this one is meant to be opened again and again.
 */
export function InboxPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const [fragment] = useState(() => window.location.hash.slice(1));
  const inbox = useInbox(id, fragment, hashWasmArgon2);
  const { config } = useServerConfig();
  const [pending, setPending] = useState<PendingDownload | null>(null);
  // The last asked question stays while the dialog closes, so its text does not flip.
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (wasShareLinkRewritten()) showRewrittenLinkWarning("inbox");
  }, []);

  if (config && !config.fileRequestsEnabled) return <NotFoundPage />;
  if (!id || !fragment || inbox.phase === "invalid") {
    return <LinkGone icon={FileQuestion} title={t("inbox.invalid")} />;
  }
  if (inbox.phase === "gone")
    return <LinkGone icon={Clock} title={t("inbox.gone")} text={t("inbox.goneText")} />;
  if (inbox.phase === "deleted")
    return <LinkGone icon={Trash2} title={t("inbox.deleted")} text={t("inbox.deletedText")} />;
  if (inbox.phase === "error")
    return <LinkGone icon={Ban} title={inbox.error ?? t("common.error")} />;
  if (inbox.phase === "locked")
    return <LinkGone icon={Clock} title={t("download.tooManyAttempts")} />;

  if (inbox.phase === "needs-password" || inbox.phase === "unlocking") {
    return (
      <InboxShell title={t("inbox.title")}>
        <Card data-emphasis="main" className="p-4 sm:p-6">
          <PasswordPrompt
            title={t("inbox.passwordRequired")}
            onSubmit={inbox.unlock}
            loading={inbox.phase === "unlocking"}
            error={inbox.passwordError}
          />
        </Card>
      </InboxShell>
    );
  }

  if (inbox.phase === "loading" || !inbox.inbox || !inbox.opened) {
    return (
      <InboxShell title={t("inbox.title")}>
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-48 w-full rounded-[28px]" />
        </div>
      </InboxShell>
    );
  }

  const { inbox: status, opened } = inbox;
  const { uploadLink } = requestLinks({
    id,
    uploadFragment: opened.uploadFragment,
    inboxFragment: fragment,
  });
  const ask = (next: Confirm) => {
    setConfirm(next);
    setDialogOpen(true);
  };
  const questions = {
    close: {
      title: t("inbox.closeTitle"),
      text: t("inbox.closeText"),
      action: t("inbox.close"),
      destructive: false,
      run: () => run(inbox.close, t("inbox.closedToast")),
    },
    delete: {
      title: t("inbox.deleteTitle"),
      text: t("inbox.deleteText"),
      action: t("common.delete"),
      destructive: true,
      run: () => run(inbox.deleteAll, t("requests.deleted")),
    },
    file: {
      title: t("inbox.deleteFileTitle"),
      text: t("inbox.deleteFileText"),
      action: t("common.delete"),
      destructive: true,
      run: () =>
        confirm?.kind === "file"
          ? run(() => inbox.deleteFile(confirm.entry.upload.id), t("inbox.fileDeleted"))
          : Promise.resolve(),
    },
  };
  const question = confirm ? questions[confirm.kind] : null;

  const startDownload = async (entry: OpenedUpload) => {
    setPending(null);
    try {
      await inbox.download(entry);
    } catch (err) {
      showKnownErrorToast(err instanceof Error ? err.message : t("inbox.downloadFailed"));
      void inbox.refresh();
    }
  };

  const requestDownload = (entry: OpenedUpload) => {
    if (isFirefox() && isDevToolsOpen()) return setPending({ entry, reason: "devtools" });
    if (isSafari() && entry.upload.size > SAFARI_BIG_SIZE)
      return setPending({ entry, reason: "safari" });
    void startDownload(entry);
  };

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch {
      toast.error(t("inbox.actionFailed"));
    } finally {
      setBusy(false);
      setDialogOpen(false);
    }
  };

  const copyUploadLink = async () => {
    await copyText(uploadLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <InboxShell title={opened.title ?? t("inbox.title")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[15px] text-muted-foreground">
          {t("inbox.usage", {
            used: status.usedUploads,
            max: status.maxUploads,
            size: formatBytes(status.usedBytes),
            maxSize: formatBytes(status.maxSize),
          })}
          {" · "}
          {status.open
            ? t("inbox.closesIn", { time: formatTimeRemaining(status.closesAt) })
            : t("inbox.closed")}
        </p>
        <div className="flex flex-wrap gap-2">
          {status.open && (
            <Button variant="outline" size="sm" onClick={copyUploadLink}>
              {copied ? <Check /> : <Copy />}
              {copied ? t("common.copied") : t("requests.copyUploadLink")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void inbox.refresh()}
            aria-label={t("inbox.refresh")}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      {pending?.reason === "safari" && (
        <SafariWarning
          fileSize={pending.entry.upload.size}
          onContinue={() => void startDownload(pending.entry)}
          onDismiss={() => setPending(null)}
        />
      )}
      {pending?.reason === "devtools" && (
        <FirefoxDevToolsWarning
          onRetry={() => requestDownload(pending.entry)}
          onForce={() => void startDownload(pending.entry)}
          onDismiss={() => setPending(null)}
        />
      )}

      {opened.uploads.length === 0 ? (
        <Card
          data-emphasis="main"
          className="flex flex-col items-center gap-3 px-6 py-14 text-center"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
            <Inbox className="h-6 w-6" />
          </span>
          <p className="text-lg font-semibold tracking-tight">{t("inbox.empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {status.open ? t("inbox.emptyOpen") : t("inbox.emptyClosed")}
          </p>
        </Card>
      ) : (
        <Card data-emphasis="main" className="overflow-hidden">
          <ul className="divide-y divide-border" role="list">
            {opened.uploads.map((entry) => (
              <InboxFileRow
                key={entry.upload.id}
                entry={entry}
                progress={inbox.downloads[entry.upload.id]}
                onDownload={() => requestDownload(entry)}
                onCancel={() => inbox.cancelDownload(entry.upload.id)}
                onDelete={() => ask({ kind: "file", entry })}
              />
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">{t("inbox.retentionHint")}</p>

      <div className="flex flex-wrap gap-2 border-t border-border pt-5">
        {status.open && (
          <Button variant="outline" onClick={() => ask({ kind: "close" })}>
            <Ban />
            {t("inbox.close")}
          </Button>
        )}
        <Button
          variant="outline"
          className="text-destructive-text"
          onClick={() => ask({ kind: "delete" })}
        >
          <Trash2 />
          {t("inbox.delete")}
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{question?.title}</DialogTitle>
            <DialogDescription>{question?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={question?.destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void question?.run()}
            >
              {busy && <Loader2 className="animate-spin" />}
              {question?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InboxShell>
  );
}
