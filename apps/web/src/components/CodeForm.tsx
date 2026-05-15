import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff, Send, Loader2, Plus, X } from "lucide-react";
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

export const CODE_LANGUAGES = [
  { value: "auto", label: "Auto Detect" },
  // Web & scripting
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "lua", label: "Lua" },
  { value: "perl", label: "Perl" },
  { value: "r", label: "R" },
  // Systems & compiled
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "scala", label: "Scala" },
  { value: "dart", label: "Dart" },
  { value: "haskell", label: "Haskell" },
  { value: "elixir", label: "Elixir" },
  { value: "erlang", label: "Erlang" },
  { value: "fsharp", label: "F#" },
  // Shell & scripting
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "powershell", label: "PowerShell" },
  // Data & config
  { value: "sql", label: "SQL" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "ini", label: "INI" },
  { value: "toml", label: "TOML" },
  { value: "protobuf", label: "Protocol Buffers" },
  { value: "graphql", label: "GraphQL" },
  { value: "diff", label: "Diff" },
  // Web & styles
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  // Infrastructure
  { value: "dockerfile", label: "Dockerfile" },
  { value: "nginx", label: "Nginx" },
  { value: "nix", label: "Nix" },
  { value: "makefile", label: "Makefile" },
  // Markup & docs
  { value: "markdown", label: "Markdown" },
  { value: "http", label: "HTTP" },
  // Editor
  { value: "vim", label: "Vim Script" },
  { value: "plaintext", label: "Plain Text" },
] as const;

interface CodeBlock {
  title: string;
  language: string;
  code: string;
}

export function CodeForm({ forcePassword = false }: { forcePassword?: boolean }) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  const [blocks, setBlocks] = useState<CodeBlock[]>([{ title: "", language: "auto", code: "" }]);
  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(forcePassword);

  if (!config) return null;

  const effectiveExpireSec = expireSec ?? config.noteDefaultExpire;
  const effectiveMaxViews = maxViews ?? config.noteDefaultViews;

  const nonEmptyBlocks = blocks.filter((b) => b.code.length > 0);
  const content = JSON.stringify(
    nonEmptyBlocks.map((b) => ({ title: b.title, language: b.language, code: b.code })),
  );
  const contentBytes = new TextEncoder().encode(content).length;
  const sizeExceeded = contentBytes > config.noteMaxSize;
  const isSubmitting = noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const canSubmit = nonEmptyBlocks.length > 0 && !sizeExceeded && !isSubmitting;

  const updateBlock = (index: number, field: keyof CodeBlock, value: string) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  };

  const addBlock = () => {
    setBlocks((prev) => [...prev, { title: "", language: "auto", code: "" }]);
  };

  const removeBlock = (index: number) => {
    if (blocks.length <= 1) return;
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    noteHook.upload({
      content,
      contentType: "code",
      maxViews: effectiveMaxViews,
      expireSec: effectiveExpireSec,
      password: passwordEnabled ? password : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setBlocks([{ title: "", language: "auto", code: "" }]);
    setPassword("");
    setPasswordEnabled(false);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* Code blocks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t("code.blocks")}</Label>
            <span
              className={`text-xs ${sizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
            >
              {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
            </span>
          </div>

          {blocks.map((block, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={block.title}
                  onChange={(e) => updateBlock(index, "title", e.target.value)}
                  placeholder={t("code.titlePlaceholder")}
                  className="h-8 flex-1 text-xs"
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <Select
                  value={block.language}
                  onValueChange={(v) => updateBlock(index, "language", v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CODE_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value} className="text-xs">
                        {lang.value === "auto" ? t("code.auto") : lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {blocks.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive-foreground"
                    onClick={() => removeBlock(index)}
                    disabled={isSubmitting}
                    title={t("common.delete")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Textarea
                value={block.code}
                onChange={(e) => updateBlock(index, "code", e.target.value)}
                placeholder={t("code.placeholder")}
                className="min-h-40 resize-y font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addBlock}
            disabled={isSubmitting}
            className="w-full"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("code.addBlock")}
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
              value={String(effectiveExpireSec)}
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
              value={String(effectiveMaxViews)}
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

        {/* Password */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              {t("upload.password")}
              {forcePassword && (
                <span className="text-xs text-muted-foreground">({t("upload.passwordRequired")})</span>
              )}
            </Label>
            {!forcePassword && (
              <Switch
                checked={passwordEnabled}
                onCheckedChange={setPasswordEnabled}
                disabled={isSubmitting}
              />
            )}
          </div>
          {passwordEnabled && (
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t(forcePassword ? "upload.passwordPlaceholderRequired" : "upload.passwordPlaceholder")}
                autoComplete="off"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
        <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full" size="lg">
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
