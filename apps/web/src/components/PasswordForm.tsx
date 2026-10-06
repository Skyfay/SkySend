import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { showKnownErrorToast } from "@/lib/toast";
import { Eye, EyeOff, Copy, Check, Send, Plus, Wand2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { ShareFooter } from "@/components/ShareFooter";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { cn, formatBytes } from "@/lib/utils";

export function PasswordForm({ forcePassword = false }: { forcePassword?: boolean }) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.error) {
      showKnownErrorToast(noteHook.error);
    }
  }, [noteHook.phase, noteHook.error]);

  const [passwords, setPasswords] = useState<{ label: string; value: string }[]>([{ label: "", value: "" }]);
  const [showValues, setShowValues] = useState<boolean[]>([false]);
  const [generatorIndex, setGeneratorIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [notePassword, setNotePassword] = useState("");
  const [notePasswordEnabled, setNotePasswordEnabled] = useState(forcePassword);

  if (!config) return null;

  const effectiveExpireSec = expireSec ?? config.noteDefaultExpire;
  const effectiveMaxViews = maxViews ?? config.noteDefaultViews;

  const nonEmpty = passwords.filter((p) => p.value.length > 0);
  const content = JSON.stringify(nonEmpty.map((p) => ({ label: p.label, value: p.value })));
  const contentBytes = new TextEncoder().encode(content).length;
  const sizeExceeded = contentBytes > config.noteMaxSize;
  const isSubmitting =
    noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const canSubmit =
    passwords.some((p) => p.value.length > 0) && !sizeExceeded && !isSubmitting;

  const updatePassword = (index: number, value: string) => {
    setPasswords((prev) => prev.map((p, i) => (i === index ? { ...p, value } : p)));
  };

  const updateLabel = (index: number, label: string) => {
    setPasswords((prev) => prev.map((p, i) => (i === index ? { ...p, label } : p)));
  };

  const addField = () => {
    setPasswords((prev) => [...prev, { label: "", value: "" }]);
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

  const copyPassword = async (index: number) => {
    const value = passwords[index]?.value;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 1500);
  };

  const handleGenerate = (index: number, value: string) => {
    updatePassword(index, value);
    setGeneratorIndex(null);
  };

  const handleSubmit = () => {
    noteHook.upload({
      content,
      contentType: "password",
      maxViews: effectiveMaxViews,
      expireSec: effectiveExpireSec,
      password: notePasswordEnabled ? notePassword : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setPasswords([{ label: "", value: "" }]);
    setShowValues([false]);
    setGeneratorIndex(null);
    setNotePassword("");
    setNotePasswordEnabled(forcePassword);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  const iconButton = (label: string, onClick: () => void, icon: ReactNode, options: { disabled?: boolean; expanded?: boolean; className?: string } = {}) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("shrink-0 aria-expanded:border-primary-line aria-expanded:bg-primary-soft aria-expanded:text-primary-text", options.className)}
          onClick={onClick}
          disabled={options.disabled}
          aria-label={label}
          aria-expanded={options.expanded}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] border border-border bg-well">
        <div className="flex items-center justify-between border-b border-border py-2.5 pl-4 pr-4">
          <Label className="text-[13px]">{t("password.passwords")}</Label>
          <span className={cn("text-xs tabular-nums", sizeExceeded ? "text-destructive-text" : "text-muted-foreground")}>
            {formatBytes(contentBytes)} / {formatBytes(config.noteMaxSize)}
          </span>
        </div>

        <div className="space-y-3 p-3">
          {passwords.map((pw, index) => (
            <div key={index} className="space-y-2.5">
              <div className="flex flex-wrap gap-2">
                <Input
                  type="text"
                  value={pw.label}
                  onChange={(e) => updateLabel(index, e.target.value)}
                  placeholder={t("password.labelPlaceholder", { number: index + 1 })}
                  aria-label={t("password.labelPlaceholder", { number: index + 1 })}
                  className="min-w-40 flex-1 basis-44"
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <div className="flex min-w-0 flex-[2] basis-60 items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      type={showValues[index] ? "text" : "password"}
                      value={pw.value}
                      onChange={(e) => updatePassword(index, e.target.value)}
                      placeholder={t("password.enterPassword")}
                      aria-label={t("password.passwordNumber", { number: index + 1 })}
                      className="pr-10 font-mono placeholder:font-sans"
                      disabled={isSubmitting}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => toggleVisibility(index)}
                      aria-label={showValues[index] ? t("share.hidePassword") : t("share.showPassword")}
                    >
                      {showValues[index] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {iconButton(
                    copiedIndex === index ? t("common.copied") : t("common.copy"),
                    () => copyPassword(index),
                    copiedIndex === index ? <Check className="text-primary-text" /> : <Copy />,
                    { disabled: isSubmitting || !pw.value },
                  )}
                  {iconButton(t("passwordGenerator.title"), () => toggleGenerator(index), <Wand2 />, {
                    disabled: isSubmitting,
                    expanded: generatorIndex === index,
                  })}
                  {passwords.length > 1 &&
                    iconButton(t("common.delete"), () => removeField(index), <X />, {
                      disabled: isSubmitting,
                      className: "hover:text-destructive-text",
                    })}
                </div>
              </div>

              {/* Generator panel for this field */}
              {generatorIndex === index && (
                <PasswordGenerator onGenerate={(v) => handleGenerate(index, v)} disabled={isSubmitting} />
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addField}
            disabled={isSubmitting}
            className="text-primary-text"
          >
            <Plus />
            {t("password.addAnother")}
          </Button>
        </div>
      </div>

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
          passwordEnabled={notePasswordEnabled}
          onPasswordEnabledChange={setNotePasswordEnabled}
          password={notePassword}
          onPasswordChange={setNotePassword}
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
