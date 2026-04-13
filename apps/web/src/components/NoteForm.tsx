import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff, Send, Loader2, Type, Heading, Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShareLink } from "@/components/ShareLink";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { formatDuration, formatBytes } from "@/lib/utils";
import type { NoteContentType } from "@skysend/crypto";

interface NoteFormProps {
  contentType: NoteContentType;
}

export function NoteForm({ contentType }: NoteFormProps) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  const [content, setContent] = useState("");
  const [markdownMode, setMarkdownMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expireSec, setExpireSec] = useState<number | null>(() => null);
  const [maxViews, setMaxViews] = useState<number | null>(() => null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);

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
    setPasswordEnabled(false);
  };

  // Show share link when done
  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  const placeholderKey = `note.placeholder.${contentType}` as const;

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* Markdown mode toggle for text tab */}
        {contentType === "text" && (
          <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => { setMarkdownMode(false); setShowPreview(false); }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                !markdownMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Type className="h-4 w-4" />
              {t("note.plainText")}
            </button>
            <button
              type="button"
              onClick={() => setMarkdownMode(true)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                markdownMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Heading className="h-4 w-4" />
              Markdown
            </button>
          </div>
        )}
        {/* Content textarea */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="note-content">{t("note.content")}</Label>
            <div className="flex items-center gap-3">
              {markdownMode && (
                <div className="flex gap-1 rounded-md border border-border bg-muted/50 p-0.5">
                  <button
                    type="button"
                    onClick={() => setShowPreview(false)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      !showPreview
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("note.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      showPreview
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("note.preview")}
                  </button>
                </div>
              )}
              <span
                className={`text-xs ${sizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
              >
                {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                title={t("note.expand")}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          {markdownMode && showPreview ? (
            <div className="min-h-50 rounded-md border border-border bg-muted/30 p-4 prose prose-sm dark:prose-invert max-w-none overflow-auto">
              {content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground italic">{t("note.previewEmpty")}</p>
              )}
            </div>
          ) : (
            <Textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={markdownMode ? t("note.placeholder.markdown") : t(placeholderKey)}
              className={`min-h-50 resize-y ${contentType === "code" ? "font-mono text-sm" : ""} ${contentType === "password" ? "font-mono" : ""}`}
              disabled={isSubmitting}
            />
          )}
          {sizeExceeded && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
            </p>
          )}
          {contentType === "password" && (
            <PasswordGenerator
              onGenerate={setContent}
              disabled={isSubmitting}
            />
          )}
        </div>

        {/* Expanded editor dialog */}
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[90vh] max-w-4xl flex-col p-0">
            <DialogHeader className="flex-row items-center justify-between space-y-0 border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                {t("note.content")}
                {markdownMode && (
                  <span className="text-sm font-normal text-muted-foreground">- Markdown</span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-3 pr-8">
                {markdownMode && (
                  <div className="flex gap-1 rounded-md border border-border bg-muted/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setShowPreview(false)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        !showPreview
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("note.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPreview(true)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        showPreview
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("note.preview")}
                    </button>
                  </div>
                )}
                <span
                  className={`text-xs ${sizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
                >
                  {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
                </span>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-hidden p-6 pt-0">
              {markdownMode && showPreview ? (
                <div className="h-full overflow-auto rounded-md border border-border bg-muted/30 p-4 prose prose-sm dark:prose-invert max-w-none">
                  {content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground italic">{t("note.previewEmpty")}</p>
                  )}
                </div>
              ) : (
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={markdownMode ? t("note.placeholder.markdown") : t(placeholderKey)}
                  className={`h-full resize-none ${contentType === "code" ? "font-mono text-sm" : ""} ${contentType === "password" ? "font-mono" : ""}`}
                  disabled={isSubmitting}
                  autoFocus
                />
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Expiry + Max Views */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="note-expiry">{t("note.expiry")}</Label>
            <Select
              value={String(expireSec)}
              onValueChange={(v) => setExpireSec(parseInt(v, 10))}
              disabled={isSubmitting}
            >
              <SelectTrigger id="note-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.noteExpireOptions.map((sec) => (
                  <SelectItem key={sec} value={String(sec)}>
                    {formatDuration(sec)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-views">{t("note.maxViews")}</Label>
            <Select
              value={String(maxViews)}
              onValueChange={(v) => setMaxViews(parseInt(v, 10))}
              disabled={isSubmitting}
            >
              <SelectTrigger id="note-views">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.noteViewOptions.map((num) => (
                  <SelectItem key={num} value={String(num)}>
                    {num === 0
                      ? t("note.unlimited")
                      : num === 1
                        ? t("note.burnAfterReading")
                        : String(num)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Password */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="note-password-toggle"
              className="flex items-center gap-2"
            >
              <Lock className="h-4 w-4" />
              {t("upload.password")}
            </Label>
            <Switch
              id="note-password-toggle"
              checked={passwordEnabled}
              onCheckedChange={setPasswordEnabled}
              disabled={isSubmitting}
            />
          </div>
          {passwordEnabled && (
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("upload.passwordPlaceholder")}
                autoComplete="off"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {noteHook.phase === "error" && noteHook.error && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {noteHook.error}
          </p>
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full"
          size="lg"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Send className="mr-2 h-5 w-5" />
          )}
          {isSubmitting ? t("note.creating") : t("note.create")}
        </Button>
      </CardContent>
    </Card>
  );
}
