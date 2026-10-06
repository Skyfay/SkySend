import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, Wand2, X } from "lucide-react";
import { MAX_PASSWORD_ENTRIES, type PasswordBlock, type PasswordEntry } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlockEditorFrame, IconButton } from "@/components/BlockEditorFrame";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { copyText } from "@/lib/clipboard";

interface PasswordBlockEditorProps {
  block: PasswordBlock;
  onChange: (block: PasswordBlock) => void;
  controls: ReactNode;
  disabled: boolean;
}

/** One or more passwords with an optional label each, and a generator per entry. */
export function PasswordBlockEditor({ block, onChange, controls, disabled }: PasswordBlockEditorProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const [generatorIndex, setGeneratorIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const entries = block.entries;

  const update = (index: number, patch: Partial<PasswordEntry>) =>
    onChange({ ...block, entries: entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) });

  const remove = (index: number) => {
    onChange({ ...block, entries: entries.filter((_, i) => i !== index) });
    // Indexes after the removed entry move up by one.
    setShown((current) => new Set([...current].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))));
    setGeneratorIndex((current) => (current === null || current === index ? null : current > index ? current - 1 : current));
  };

  const toggleShown = (index: number) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const copy = async (index: number) => {
    const value = entries[index]?.value;
    if (!value) return;
    await copyText(value);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500);
  };

  return (
    <BlockEditorFrame icon={KeyRound} title={t("tab.password")} controls={controls}>
      <div className="space-y-3 p-3">
        {entries.map((entry, index) => (
          <div key={index} className="space-y-2.5">
            <div className="flex flex-wrap gap-2">
              <Input
                type="text"
                value={entry.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder={t("password.labelPlaceholder", { number: index + 1 })}
                aria-label={t("password.labelPlaceholder", { number: index + 1 })}
                className="min-w-40 flex-1 basis-44"
                disabled={disabled}
                autoComplete="off"
              />
              <div className="flex min-w-0 flex-[2] basis-60 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    type={shown.has(index) ? "text" : "password"}
                    value={entry.value}
                    onChange={(e) => update(index, { value: e.target.value })}
                    placeholder={t("password.enterPassword")}
                    aria-label={t("password.passwordNumber", { number: index + 1 })}
                    className="pr-10 font-mono placeholder:font-sans"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => toggleShown(index)}
                    aria-label={shown.has(index) ? t("share.hidePassword") : t("share.showPassword")}
                  >
                    {shown.has(index) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <IconButton
                  label={copiedIndex === index ? t("common.copied") : t("common.copy")}
                  onClick={() => void copy(index)}
                  disabled={disabled || !entry.value}
                >
                  {copiedIndex === index ? <Check className="text-primary-text" /> : <Copy />}
                </IconButton>
                <IconButton
                  label={t("passwordGenerator.title")}
                  onClick={() => setGeneratorIndex(generatorIndex === index ? null : index)}
                  disabled={disabled}
                  expanded={generatorIndex === index}
                >
                  <Wand2 />
                </IconButton>
                {entries.length > 1 && (
                  <IconButton label={t("common.delete")} onClick={() => remove(index)} disabled={disabled} className="hover:text-destructive-text">
                    <X />
                  </IconButton>
                )}
              </div>
            </div>
            {generatorIndex === index && (
              <PasswordGenerator
                onGenerate={(value) => {
                  update(index, { value });
                  setGeneratorIndex(null);
                }}
                disabled={disabled}
              />
            )}
          </div>
        ))}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...block, entries: [...entries, { label: "", value: "" }] })}
          disabled={disabled || entries.length >= MAX_PASSWORD_ENTRIES}
          className="text-primary-text"
        >
          <Plus />
          {t("password.addAnother")}
        </Button>
      </div>
    </BlockEditorFrame>
  );
}
