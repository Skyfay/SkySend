import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { showKnownErrorToast } from "@/lib/toast";
import { Send, Type, Heading, Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/lib/markdownComponents";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { ShareFooter } from "@/components/ShareFooter";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { cn, formatBytes } from "@/lib/utils";
import type { NoteContentType } from "@skysend/crypto";

interface NoteFormProps {
  contentType: NoteContentType;
  forcePassword?: boolean;
}

export function NoteForm({ contentType, forcePassword = false }: NoteFormProps) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.error) {
      showKnownErrorToast(noteHook.error);
    }
  }, [noteHook.phase, noteHook.error]);

  const [content, setContent] = useState("");
  const [markdownMode, setMarkdownMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expireSec, setExpireSec] = useState<number | null>(() => null);
  const [maxViews, setMaxViews] = useState<number | null>(() => null);
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(forcePassword);

  // Initialize defaults when config loads
  if (config && expireSec === null) {
    setExpireSec(config.noteDefaultExpire);
  }
  if (config && maxViews === null) {
    setMaxViews(config.noteDefaultViews);
  }

  if (!config || expireSec === null || maxViews === null) return null;

  const contentBytes = new TextEncoder().encode(content).length;
  const sizeExceeded = contentBytes > config.noteMaxSize;
  const isSubmitting = noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const canSubmit = content.length > 0 && !sizeExceeded && !isSubmitting;

  const effectiveContentType = contentType === "text" && markdownMode ? "markdown" as const : contentType;

  const handleSubmit = () => {
    noteHook.upload({
      content,
      contentType: effectiveContentType,
      maxViews,
      expireSec,
      password: passwordEnabled ? password : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setContent("");
    setPassword("");
    setPasswordEnabled(forcePassword);
  };

  // Show share link when done
  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  const placeholderKey = `note.placeholder.${contentType}` as const;

  const textareaClass = cn(
    "min-h-48 resize-y rounded-xl border-0 bg-transparent px-3 shadow-none focus-visible:ring-0",
    (contentType === "code" || contentType === "password" || markdownMode) && "font-mono text-sm",
  );
  const preview = (className: string) => (
    <div className={cn("prose prose-sm max-w-none overflow-auto rounded-xl bg-card p-4 dark:prose-invert", className)}>
      {content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
      ) : (
        <p className="italic text-muted-foreground">{t("note.previewEmpty")}</p>
      )}
    </div>
  );
  const previewToggle = markdownMode && (
    <ToggleGroup
      variant="segmented"
      type="single"
      value={showPreview ? "preview" : "edit"}
      onValueChange={(v) => v && setShowPreview(v === "preview")}
      aria-label={t("share.editorMode")}
    >
      <ToggleGroupItem value="edit">{t("note.edit")}</ToggleGroupItem>
      <ToggleGroupItem value="preview">{t("note.preview")}</ToggleGroupItem>
    </ToggleGroup>
  );
  const sizeLabel = (
    <span className={cn("text-xs tabular-nums", sizeExceeded ? "text-destructive-text" : "text-muted-foreground")}>
      {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
    </span>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] border border-border bg-well transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft">
        <div className="flex flex-wrap items-center gap-2 border-b border-border py-2 pl-4 pr-2">
          <Label htmlFor="note-content" className="mr-auto text-[13px]">{t("note.content")}</Label>
          {/* Markdown mode toggle for text tab */}
          {contentType === "text" && (
            <ToggleGroup
              variant="segmented"
              type="single"
              value={markdownMode ? "markdown" : "plain"}
              onValueChange={(v) => {
                if (!v) return;
                setMarkdownMode(v === "markdown");
                if (v === "plain") setShowPreview(false);
              }}
              aria-label={t("share.format")}
            >
              <ToggleGroupItem value="plain">
                <Type />
                {t("note.plainText")}
              </ToggleGroupItem>
              <ToggleGroupItem value="markdown">
                <Heading />
                {t("tab.markdown")}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {previewToggle}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label={t("note.expand")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("note.expand")}</TooltipContent>
          </Tooltip>
        </div>
        <div className="p-1.5">
          {markdownMode && showPreview ? (
            preview("min-h-48")
          ) : (
            <Textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={markdownMode ? t("note.placeholder.markdown") : t(placeholderKey)}
              className={textareaClass}
              disabled={isSubmitting}
            />
          )}
        </div>
        <div className="flex justify-end border-t border-border px-4 py-2">{sizeLabel}</div>
      </div>

      {sizeExceeded && (
        <p className="px-2 text-sm text-destructive-text" role="alert">
          {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
        </p>
      )}
      {contentType === "password" && (
        <PasswordGenerator onGenerate={setContent} disabled={isSubmitting} />
      )}

      {/* Expanded editor dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b px-6 py-4 pr-14">
            <DialogTitle className="mr-auto flex items-center gap-2">
              {t("note.content")}
              {markdownMode && (
                <span className="text-sm font-normal text-muted-foreground">· {t("tab.markdown")}</span>
              )}
            </DialogTitle>
            {previewToggle}
            {sizeLabel}
          </DialogHeader>
          <div className="flex-1 overflow-hidden p-4">
            {markdownMode && showPreview ? (
              preview("h-full")
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={markdownMode ? t("note.placeholder.markdown") : t(placeholderKey)}
                className={cn(textareaClass, "h-full resize-none bg-well")}
                disabled={isSubmitting}
                autoFocus
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="px-2 sm:px-3">
        <ShareOptions
          kind="note"
          expireOptions={config.noteExpireOptions}
          expireSec={expireSec}
          onExpireChange={setExpireSec}
          limitOptions={config.noteViewOptions}
          limit={maxViews}
          onLimitChange={setMaxViews}
          passwordEnabled={passwordEnabled}
          onPasswordEnabledChange={setPasswordEnabled}
          password={password}
          onPasswordChange={setPassword}
          forcePassword={forcePassword}
          disabled={isSubmitting}
        />
      </div>

      {/* Errors are shown via toast (see useEffect above) */}
      <ShareFooter
        kind="note"
        expireSec={expireSec}
        limit={maxViews}
        label={t("share.encryptShare")}
        busyLabel={t("note.creating")}
        icon={<Send />}
        busy={isSubmitting}
        disabled={!canSubmit}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
