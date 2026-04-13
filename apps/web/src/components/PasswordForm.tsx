import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Lock,
  Eye,
  EyeOff,
  Send,
  Loader2,
  Plus,
  Wand2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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

export function PasswordForm() {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  const [passwords, setPasswords] = useState<string[]>([""]);
  const [showValues, setShowValues] = useState<boolean[]>([false]);
  const [generatorIndex, setGeneratorIndex] = useState<number | null>(null);

  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [notePassword, setNotePassword] = useState("");
  const [showNotePassword, setShowNotePassword] = useState(false);
  const [notePasswordEnabled, setNotePasswordEnabled] = useState(false);

  useEffect(() => {
    if (config && expireSec === null) setExpireSec(config.noteDefaultExpire);
    if (config && maxViews === null) setMaxViews(config.noteDefaultViews);
  }, [config, expireSec, maxViews]);

  if (!config || expireSec === null || maxViews === null) return null;

  const content = passwords.filter((p) => p.length > 0).join("\n\n");
  const contentBytes = new TextEncoder().encode(content).length;
  const sizeExceeded = contentBytes > config.noteMaxSize;
  const isSubmitting =
    noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const canSubmit =
    passwords.some((p) => p.length > 0) && !sizeExceeded && !isSubmitting;

  const updatePassword = (index: number, value: string) => {
    setPasswords((prev) => prev.map((p, i) => (i === index ? value : p)));
  };

  const addField = () => {
    setPasswords((prev) => [...prev, ""]);
    setShowValues((prev) => [...prev, false]);
  };

  const removeField = (index: number) => {
    if (passwords.length <= 1) return;
    setPasswords((prev) => prev.filter((_, i) => i !== index));
    setShowValues((prev) => prev.filter((_, i) => i !== index));
    if (generatorIndex === index) setGeneratorIndex(null);
    else if (generatorIndex !== null && generatorIndex > index)
      setGeneratorIndex(generatorIndex - 1);
  };

  const toggleVisibility = (index: number) => {
    setShowValues((prev) => prev.map((v, i) => (i === index ? !v : v)));
  };

  const toggleGenerator = (index: number) => {
    setGeneratorIndex(generatorIndex === index ? null : index);
  };

  const handleGenerate = (index: number, value: string) => {
    updatePassword(index, value);
    setGeneratorIndex(null);
  };

  const handleSubmit = () => {
    noteHook.upload({
      content,
      contentType: "password",
      maxViews,
      expireSec,
      password: notePasswordEnabled ? notePassword : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setPasswords([""]);
    setShowValues([false]);
    setGeneratorIndex(null);
    setNotePassword("");
    setNotePasswordEnabled(false);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* Password fields */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t("password.passwords")}</Label>
            <span
              className={`text-xs ${sizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
            >
              {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
            </span>
          </div>

          {passwords.map((pw, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showValues[index] ? "text" : "password"}
                    value={pw}
                    onChange={(e) => updatePassword(index, e.target.value)}
                    placeholder={t("password.enterPassword")}
                    className="pr-9 font-mono"
                    disabled={isSubmitting}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleVisibility(index)}
                  >
                    {showValues[index] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant={generatorIndex === index ? "secondary" : "outline"}
                  size="icon"
                  className="shrink-0"
                  onClick={() => toggleGenerator(index)}
                  disabled={isSubmitting}
                  title={t("passwordGenerator.title")}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
                {passwords.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive-foreground"
                    onClick={() => removeField(index)}
                    disabled={isSubmitting}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Generator panel for this field */}
              {generatorIndex === index && (
                <PasswordGenerator
                  onGenerate={(v) => handleGenerate(index, v)}
                  disabled={isSubmitting}
                />
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addField}
            disabled={isSubmitting}
            className="w-full"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("password.addAnother")}
          </Button>

          {sizeExceeded && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
            </p>
          )}
        </div>

        {/* Expiry + Max Views */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("note.expiry")}</Label>
            <Select
              value={String(expireSec)}
              onValueChange={(v) => setExpireSec(parseInt(v, 10))}
              disabled={isSubmitting}
            >
              <SelectTrigger>
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
            <Label>{t("note.maxViews")}</Label>
            <Select
              value={String(maxViews)}
              onValueChange={(v) => setMaxViews(parseInt(v, 10))}
              disabled={isSubmitting}
            >
              <SelectTrigger>
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

        {/* Password protection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              {t("upload.password")}
            </Label>
            <Switch
              checked={notePasswordEnabled}
              onCheckedChange={setNotePasswordEnabled}
              disabled={isSubmitting}
            />
          </div>
          {notePasswordEnabled && (
            <div className="relative">
              <Input
                type={showNotePassword ? "text" : "password"}
                value={notePassword}
                onChange={(e) => setNotePassword(e.target.value)}
                placeholder={t("upload.passwordPlaceholder")}
                autoComplete="off"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNotePassword(!showNotePassword)}
              >
                {showNotePassword ? (
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
