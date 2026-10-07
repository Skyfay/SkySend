import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff, KeyRound, Lock, LockOpen, Plus, Wand2, X } from "lucide-react";
import { MAX_LABEL_LENGTH, MAX_PASSWORD_ENTRIES, type PasswordBlock, type PasswordEntry } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlockEditorFrame, IconButton } from "@/components/BlockEditorFrame";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { copyText } from "@/lib/clipboard";
import type { EditorMode } from "@/lib/note-editor";

interface PasswordBlockEditorProps {
  block: PasswordBlock;
  onChange: (block: PasswordBlock) => void;
  controls: ReactNode;
  disabled: boolean;
  mode?: EditorMode;
}

/**
 * One or more passwords with an optional label each, and a generator per entry. An entry
 * that is no secret, like a username, is typed and shown in clear and gets no generator. A
 * template lays out only the labels and which entries are secret, and filling it in keeps
 * both as they are.
 */
export function PasswordBlockEditor({ block, onChange, controls, disabled, mode = "compose" }: PasswordBlockEditorProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const [generatorIndex, setGeneratorIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const entries = block.entries;

  const update = (index: number, patch: Partial<PasswordEntry>) =>
    onChange({ ...block, entries: entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) });

  /** Marks an entry as a secret, shown masked, or as a value shown in clear. */
  const setSecret = (index: number, secret: boolean) => {
    onChange({
      ...block,
      entries: entries.map((entry, i) => {
        if (i !== index) return entry;
        const { secret: _secret, ...rest } = entry;
        return secret ? rest : { ...rest, secret: false };
      }),
    });
    if (!secret) setGeneratorIndex((current) => (current === index ? null : current));
  };

  const secretToggle = (index: number, plain: boolean) => (
    <IconButton
      label={plain ? t("password.makeSecret") : t("password.makePlain")}
      onClick={() => setSecret(index, plain)}
      disabled={disabled}
    >
      {plain ? <LockOpen /> : <Lock />}
    </IconButton>
  );

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
        {entries.map((entry, index) => {
          const plain = entry.secret === false;
          return (
          <div key={index} className="space-y-2.5">
            <div className="flex flex-wrap gap-2">
              {mode === "fill" ? (
                <span className="flex min-w-40 flex-1 basis-44 items-center text-sm font-medium wrap-anywhere">
                  {entry.label || t("password.passwordNumber", { number: index + 1 })}
                </span>
              ) : (
                <Input
                  type="text"
                  value={entry.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  placeholder={t(mode === "template" ? "template.fieldLabel" : "password.labelPlaceholder", { number: index + 1 })}
                  aria-label={t(mode === "template" ? "template.fieldLabel" : "password.labelPlaceholder", { number: index + 1 })}
                  maxLength={mode === "template" ? MAX_LABEL_LENGTH : undefined}
                  className="min-w-40 flex-1 basis-44"
                  disabled={disabled}
                  autoComplete="off"
                />
              )}
              {mode === "template" ? (
                <div className="flex items-center gap-2">
                  {secretToggle(index, plain)}
                  {entries.length > 1 && (
                    <IconButton label={t("common.delete")} onClick={() => remove(index)} disabled={disabled} className="hover:text-destructive-text">
                      <X />
                    </IconButton>
                  )}
                </div>
              ) : (
              <div className="flex min-w-0 flex-[2] basis-60 items-center gap-2">
                {plain ? (
                  <Input
                    type="text"
                    value={entry.value}
                    onChange={(e) => update(index, { value: e.target.value })}
                    placeholder={t("password.enterValue")}
                    aria-label={entry.label || t("password.passwordNumber", { number: index + 1 })}
                    className="min-w-0 flex-1 font-mono placeholder:font-sans"
                    disabled={disabled}
                    autoComplete="off"
                  />
                ) : (
                <div className="relative min-w-0 flex-1">
                  <Input
                    type={shown.has(index) ? "text" : "password"}
                    value={entry.value}
                    onChange={(e) => update(index, { value: e.target.value })}
                    placeholder={t("password.enterPassword")}
                    aria-label={entry.label || t("password.passwordNumber", { number: index + 1 })}
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
                )}
                <IconButton
                  label={copiedIndex === index ? t("common.copied") : t("common.copy")}
                  onClick={() => void copy(index)}
                  disabled={disabled || !entry.value}
                >
                  {copiedIndex === index ? <Check className="text-primary-text" /> : <Copy />}
                </IconButton>
                {!plain && (
                  <IconButton
                    label={t("passwordGenerator.title")}
                    onClick={() => setGeneratorIndex(generatorIndex === index ? null : index)}
                    disabled={disabled}
                    expanded={generatorIndex === index}
                  >
                    <Wand2 />
                  </IconButton>
                )}
                {/* The requester decides this in a template, so filling it in cannot change it. */}
                {mode === "compose" && secretToggle(index, plain)}
                {mode === "compose" && entries.length > 1 && (
                  <IconButton label={t("common.delete")} onClick={() => remove(index)} disabled={disabled} className="hover:text-destructive-text">
                    <X />
                  </IconButton>
                )}
              </div>
              )}
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
          );
        })}

        {mode !== "fill" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...block, entries: [...entries, { label: "", value: "" }] })}
            disabled={disabled || entries.length >= MAX_PASSWORD_ENTRIES}
            className="text-primary-text"
          >
            <Plus />
            {t(mode === "template" ? "template.addField" : "password.addAnother")}
          </Button>
        )}
      </div>
    </BlockEditorFrame>
  );
}
