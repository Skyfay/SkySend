import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Code, Search } from "lucide-react";
import { MAX_LABEL_LENGTH, type CodeBlock } from "@skysend/note-format";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlockEditorFrame } from "@/components/BlockEditorFrame";
import { CODE_LANGUAGES } from "@/lib/code-languages";
import type { EditorMode } from "@/lib/note-editor";

function LanguageSelect({ value, onValueChange, disabled }: { value: string; onValueChange: (v: string) => void; disabled: boolean }) {
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
      </SelectContent>
    </Select>
  );
}

interface CodeBlockEditorProps {
  block: CodeBlock;
  onChange: (block: CodeBlock) => void;
  controls: ReactNode;
  disabled: boolean;
  mode?: EditorMode;
}

/**
 * A code snippet with an optional file name and its language, detected by default. A template
 * holds the name and the language, and filling it in keeps the name.
 */
export function CodeBlockEditor({ block, onChange, controls, disabled, mode = "compose" }: CodeBlockEditorProps) {
  const { t } = useTranslation();
  return (
    <BlockEditorFrame icon={Code} title={t("tab.code")} controls={controls}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2 pl-3">
        {mode === "fill" ? (
          <span className="min-w-40 flex-1 px-1 font-mono text-[13px] wrap-anywhere">{block.title}</span>
        ) : (
          <Input
            type="text"
            value={block.title}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            placeholder={t("code.titlePlaceholder")}
            aria-label={t("code.titlePlaceholder")}
            maxLength={mode === "template" ? MAX_LABEL_LENGTH : undefined}
            className="h-8 min-w-40 flex-1 rounded-lg border-0 bg-transparent px-1 font-mono text-[13px] shadow-none placeholder:font-sans focus-visible:ring-0"
            disabled={disabled}
            autoComplete="off"
          />
        )}
        <LanguageSelect value={block.language} onValueChange={(language) => onChange({ ...block, language })} disabled={disabled} />
      </div>
      {mode === "template" ? (
        <p className="p-3 text-xs text-muted-foreground">{t("template.codeHint")}</p>
      ) : (
      <div className="p-1.5">
        <Textarea
          value={block.code}
          onChange={(e) => onChange({ ...block, code: e.target.value })}
          placeholder={t("code.placeholder")}
          aria-label={t("tab.code")}
          className="min-h-44 resize-y rounded-xl border-0 bg-transparent px-3 font-mono text-sm shadow-none placeholder:font-sans focus-visible:ring-0"
          disabled={disabled}
          spellCheck={false}
        />
      </div>
      )}
    </BlockEditorFrame>
  );
}
