import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff, Send, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShareLink } from "@/components/ShareLink";
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
  const [expireSec, setExpireSec] = useState(() => 0);
  const [maxViews, setMaxViews] = useState(() => 0);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);

  // Initialize defaults when config loads
  if (config && expireSec === 0) {
    setExpireSec(config.noteDefaultExpire);
  }
  if (config && maxViews === 0) {
    setMaxViews(config.noteDefaultViews);
  }

  if (!config) return null;

  const contentBytes = new TextEncoder().encode(content).length;
  const sizeExceeded = contentBytes > config.noteMaxSize;
  const isSubmitting = noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const canSubmit = content.length > 0 && !sizeExceeded && !isSubmitting;

  const handleSubmit = () => {
    noteHook.upload({
      content,
      contentType,
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
        {/* Content textarea */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="note-content">{t("note.content")}</Label>
            <span
              className={`text-xs ${sizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
            >
              {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
            </span>
          </div>
          <Textarea
            id="note-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t(placeholderKey)}
            className={`min-h-50 resize-y ${contentType === "code" ? "font-mono text-sm" : ""} ${contentType === "password" ? "font-mono" : ""}`}
            disabled={isSubmitting}
          />
          {sizeExceeded && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
            </p>
          )}
        </div>

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
                    {num === 1 ? t("note.burnAfterReading") : String(num)}
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
