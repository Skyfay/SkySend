import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { showKnownErrorToast } from "@/lib/toast";
import { Lock, Send, Loader2, Plus, X, Search } from "lucide-react";
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
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
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

function LanguageSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = CODE_LANGUAGES.filter(
    (l) => l.value === "auto" || l.label.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        header={
          <div className="p-1 pb-0">
            <div className="flex items-center gap-1.5 rounded-sm border border-input px-2 py-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder={t("language.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        }
      >
        {filtered.map((lang) => (
          <SelectItem key={lang.value} value={lang.value} className="text-xs">
            {lang.value === "auto" ? t("code.auto") : lang.label}
          </SelectItem>
        ))}
        {filtered.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {t("language.search")}
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

export function CodeForm({ forcePassword = false }: { forcePassword?: boolean }) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  const [blocks, setBlocks] = useState<CodeBlock[]>([{ title: "", language: "auto", code: "" }]);
  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(forcePassword);

  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.error) {
      showKnownErrorToast(noteHook.error);
    }
  }, [noteHook.phase, noteHook.error]);

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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="text"
                  value={block.title}
                  onChange={(e) => updateBlock(index, "title", e.target.value)}
                  placeholder={t("code.titlePlaceholder")}
                  className="h-8 flex-1 text-xs"
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <div className="flex items-center gap-2">
                <LanguageSelect
                  value={block.language}
                  onValueChange={(v) => updateBlock(index, "language", v)}
                  disabled={isSubmitting}
                />
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
            <PasswordProtectionInput
              value={password}
              onChange={setPassword}
              placeholder={t(forcePassword ? "upload.passwordPlaceholderRequired" : "upload.passwordPlaceholder")}
              disabled={isSubmitting}
            />
          )}
        </div>

        {/* Error */}
        {/* Error is shown via toast (see useEffect below) */}

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
