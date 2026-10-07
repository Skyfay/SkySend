import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  File as FileIcon,
  FileQuestion,
  Flag,
  Lock,
  MessageSquareQuote,
  NotebookPen,
  Server,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequestNoteForm } from "@/components/RequestNoteForm";
import { Glow } from "@/components/Glow";
import { LinkGone } from "@/components/LinkGone";
import { UploadZone } from "@/components/UploadZone";
import { UploadProgress } from "@/components/UploadProgress";
import { useRequestUpload } from "@/hooks/useRequestUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { showKnownErrorToast, showRewrittenLinkWarning } from "@/lib/toast";
import { NotFoundPage } from "@/pages/NotFound";
import { wasShareLinkRewritten } from "@/lib/rewritten-link";
import { toDrafts, type DraftBlock } from "@/lib/note-editor";
import { formatBytes, formatTimeRemaining } from "@/lib/utils";

/**
 * What a sender sees: who runs the instance, what the requester wrote, and an upload zone,
 * a note to fill in, or both. Everything is encrypted to the requester's key in this
 * browser, and the sender gets no link back, because only the requester is meant to open
 * what arrives.
 */
export function RequestUploadPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const [fragment] = useState(() => window.location.hash.slice(1));
  const { config } = useServerConfig();
  const sender = useRequestUpload(id, fragment);
  const [files, setFiles] = useState<File[]>([]);
  // The note lives here, not in its form, so a send that fails or is cancelled keeps what
  // was typed, and so does switching between the file and the note tab. Null until edited.
  const [noteDrafts, setNoteDrafts] = useState<DraftBlock[] | null>(null);

  useEffect(() => {
    if (wasShareLinkRewritten()) showRewrittenLinkWarning("upload");
  }, []);

  useEffect(() => {
    const raw = sender.uploadError;
    if (!raw) return;
    // Codes from the worker become a sentence, anything else goes to the known patterns.
    showKnownErrorToast(
      raw === "fileNotReadable"
        ? t("upload.fileNotReadable")
        : t(`requestUpload.error.${raw}`, { defaultValue: raw }),
    );
  }, [sender.uploadError, t]);

  if (config && !config.fileRequestsEnabled) return <NotFoundPage />;
  if (!id || !fragment || sender.phase === "invalid") {
    return (
      <LinkGone
        icon={FileQuestion}
        title={t("requestUpload.invalid")}
        text={t("requestUpload.invalidText")}
      />
    );
  }
  if (sender.phase === "broken") {
    return (
      <LinkGone
        icon={AlertCircle}
        title={t("requestUpload.broken")}
        text={t("requestUpload.brokenText")}
      />
    );
  }
  if (sender.phase === "gone") {
    return (
      <LinkGone
        icon={FileQuestion}
        title={t("requestUpload.gone")}
        text={t("requestUpload.goneText")}
      />
    );
  }
  if (sender.phase === "error") {
    return (
      <LinkGone icon={AlertCircle} title={t("common.error")} text={t("requestUpload.errorText")} />
    );
  }
  if (sender.phase === "loading" || !sender.status || !sender.brief) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <Skeleton className="mx-auto h-10 w-3/4 rounded-xl" />
        <Skeleton className="h-72 w-full rounded-[28px]" />
      </div>
    );
  }

  const { status, brief } = sender;
  // A delivered upload stays delivered, even when the request closed meanwhile.
  const delivered = sender.phase === "delivered";
  const room = status.open && status.uploadsLeft > 0 && status.maxUploadSize > 0;
  if (!delivered && !status.open) {
    return (
      <LinkGone
        icon={Clock}
        title={t("requestUpload.closed")}
        text={t("requestUpload.closedText")}
      />
    );
  }
  if (!delivered && !room) {
    return (
      <LinkGone icon={Ban} title={t("requestUpload.full")} text={t("requestUpload.fullText")} />
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const tooLarge = totalSize > status.maxUploadSize;
  const tooMany = files.length > status.maxFilesPerUpload;
  const canSend = files.length > 0 && !tooLarge && !tooMany && sender.phase === "ready";

  let body;
  if (delivered) {
    body = (
      <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <div className="space-y-1.5">
          <p className="text-lg font-semibold tracking-tight">{t("requestUpload.delivered")}</p>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("requestUpload.deliveredText")}
          </p>
        </div>
        {room && (
          <Button
            variant="outline"
            onClick={() => {
              setFiles([]);
              setNoteDrafts(null);
              void sender.again();
            }}
          >
            <Upload />
            {t("requestUpload.sendMore")}
          </Button>
        )}
      </div>
    );
  } else if (sender.phase === "uploading") {
    body = (
      <div className="space-y-5 p-1 sm:p-2">
        <UploadProgress
          phase={sender.uploadPhase}
          progress={sender.progress}
          speed={sender.speed}
        />
        <Button onClick={sender.cancel} variant="outline" className="w-full">
          <X />
          {t("upload.cancel")}
        </Button>
      </div>
    );
  } else {
    const filesBody = (
      <div className="space-y-4">
        <UploadZone
          files={files}
          onFilesChange={setFiles}
          maxFiles={status.maxFilesPerUpload}
          maxSize={status.maxUploadSize}
        />
        {tooLarge && (
          <p className="px-2 text-sm text-destructive-text" role="alert">
            {t("requestUpload.tooLarge", { size: formatBytes(status.maxUploadSize) })}
          </p>
        )}
        {tooMany && (
          <p className="px-2 text-sm text-destructive-text" role="alert">
            {t("upload.tooManyFiles", { count: status.maxFilesPerUpload })}
          </p>
        )}
        <div className="flex flex-col gap-3 rounded-2xl bg-well p-3 sm:flex-row sm:items-center sm:pl-5">
          <p className="flex-1 text-[13px] leading-snug text-muted-foreground">
            {t("requestUpload.limits", {
              size: formatBytes(status.maxUploadSize),
              count: status.uploadsLeft,
              time: formatTimeRemaining(status.closesAt),
            })}
          </p>
          <Button
            size="lg"
            disabled={!canSend}
            onClick={() => void sender.send({ files })}
            className="w-full sm:w-auto"
          >
            <Lock />
            {t("requestUpload.send")}
          </Button>
        </div>
      </div>
    );
    const firstDrafts = () => (brief.template ? toDrafts(brief.template) : []);
    const noteBody = (
      <RequestNoteForm
        template={brief.template !== null}
        drafts={noteDrafts ?? firstDrafts()}
        onChange={(update) => setNoteDrafts((current) => update(current ?? firstDrafts()))}
        maxSize={config?.noteMaxSize ?? 0}
        maxUploadSize={status.maxUploadSize}
        limits={t("requestUpload.limitsNote", {
          count: status.uploadsLeft,
          time: formatTimeRemaining(status.closesAt),
        })}
        disabled={sender.phase !== "ready"}
        onSend={(note) => void sender.send({ note })}
      />
    );
    const asksFiles = brief.asks.includes("files");
    const asksNote = brief.asks.includes("note");
    body =
      asksFiles && asksNote ? (
        <Tabs defaultValue="file" className="space-y-4">
          <TabsList variant="cards" aria-label={t("share.what")}>
            <TabsTrigger value="file">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <FileIcon />
                {t("tab.file")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("requestUpload.fileTabHint", { size: formatBytes(status.maxUploadSize) })}
              </span>
            </TabsTrigger>
            <TabsTrigger value="note">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <NotebookPen />
                {t("tab.note")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("requestUpload.noteTabHint")}
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file">{filesBody}</TabsContent>
          <TabsContent value="note">{noteBody}</TabsContent>
        </Tabs>
      ) : asksNote ? (
        noteBody
      ) : (
        filesBody
      );
  }

  return (
    <div className="relative mx-auto max-w-xl">
      <Glow />
      <div className="relative space-y-6">
        <header className="text-center">
          <h1
            data-slot="hero-title"
            className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
          >
            <Trans
              i18nKey="requestUpload.title"
              components={{ a: <span data-slot="accent" className="text-primary-text" /> }}
            />
          </h1>
          <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {t("requestUpload.intro")}
          </p>
        </header>

        {brief.title && (
          <figure className="overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-chip">
            <figcaption className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MessageSquareQuote className="h-3.5 w-3.5" />
              {t("requestUpload.titleFrom")}
            </figcaption>
            <blockquote className="whitespace-pre-wrap text-[15px] font-medium wrap-anywhere">
              {brief.title}
            </blockquote>
          </figure>
        )}

        <Card data-emphasis="main" className="p-3 sm:p-5">
          {body}
        </Card>

        <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <p className="inline-flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" />
            <Trans
              i18nKey="requestUpload.host"
              values={{ host: window.location.host }}
              components={{ b: <strong className="font-semibold text-foreground" /> }}
            />
          </p>
          {config?.customReportUrl && (
            <a
              href={config.customReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Flag className="h-3.5 w-3.5" />
              {t("requestUpload.report")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
