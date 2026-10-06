import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { showKnownErrorToast } from "@/lib/toast";
import { Send, Plus, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { ShareFooter } from "@/components/ShareFooter";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { cn, formatBytes } from "@/lib/utils";

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
      <SelectTrigger className="h-8 w-40 rounded-lg text-xs" aria-label={t("code.language")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        header={
          <div className="p-1 pb-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-input px-2 py-1.5">
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
    setPasswordEnabled(forcePassword);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between px-2">
        <Label className="text-[13px]">{t("code.blocks")}</Label>
        <span className={cn("text-xs tabular-nums", sizeExceeded ? "text-destructive-text" : "text-muted-foreground")}>
          {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
        </span>
      </div>

      {blocks.map((block, index) => (
        <div
          key={index}
          className="rounded-[20px] border border-border bg-well transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2 pl-3">
            <Input
              type="text"
              value={block.title}
              onChange={(e) => updateBlock(index, "title", e.target.value)}
              placeholder={t("code.titlePlaceholder")}
              aria-label={t("code.noTitle", { number: index + 1 })}
              className="h-8 min-w-40 flex-1 rounded-lg border-0 bg-transparent px-1 font-mono text-[13px] shadow-none focus-visible:ring-0"
              disabled={isSubmitting}
              autoComplete="off"
            />
            <LanguageSelect
              value={block.language}
              onValueChange={(v) => updateBlock(index, "language", v)}
              disabled={isSubmitting}
            />
            {blocks.length > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive-text"
                    onClick={() => removeBlock(index)}
                    disabled={isSubmitting}
                    aria-label={t("common.delete")}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.delete")}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="p-1.5">
            <Textarea
              value={block.code}
              onChange={(e) => updateBlock(index, "code", e.target.value)}
              placeholder={t("code.placeholder")}
              aria-label={block.title || t("code.noTitle", { number: index + 1 })}
              className="min-h-44 resize-y rounded-xl border-0 bg-transparent px-3 font-mono text-sm shadow-none focus-visible:ring-0"
              disabled={isSubmitting}
            />
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addBlock}
        disabled={isSubmitting}
        className="text-primary-text"
      >
        <Plus />
        {t("code.addBlock")}
      </Button>

      {sizeExceeded && (
        <p className="px-2 text-sm text-destructive-text" role="alert">
          {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
        </p>
      )}

      <div className="px-2 sm:px-3">
        <ShareOptions
          kind="note"
          expireOptions={config.noteExpireOptions}
          expireSec={effectiveExpireSec}
          onExpireChange={setExpireSec}
          limitOptions={config.noteViewOptions}
          limit={effectiveMaxViews}
          onLimitChange={setMaxViews}
          passwordEnabled={passwordEnabled}
          onPasswordEnabledChange={setPasswordEnabled}
          password={password}
          onPasswordChange={setPassword}
          forcePassword={forcePassword}
          disabled={isSubmitting}
        />
      </div>

      <ShareFooter
        kind="note"
        expireSec={effectiveExpireSec}
        limit={effectiveMaxViews}
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
