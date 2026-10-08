import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, FileJson, Link2, Loader2 } from "lucide-react";
import { MIN_PASSWORD_LENGTH, meetsPasswordMinimum } from "@skysend/crypto";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import { hashWasmArgon2 } from "@/lib/argon2";
import { copyText } from "@/lib/clipboard";
import {
  exportTemplates,
  fieldsOf,
  TemplateExportError,
  templatesLink,
  type RequestTemplate,
} from "@/lib/request-templates";

/** Past this length a link may break in a chat or a mail, and a file is the safer way. */
const LONG_LINK = 2000;

interface TemplateExportDialogProps {
  /** The IDs that start ticked, or null while the dialog is closed. */
  selected: string[] | null;
  onClose: () => void;
  templates: readonly RequestTemplate[];
}

/**
 * Exports templates to move them to another browser: as a file, or as a link that carries
 * everything after the "#". A password seals the export, since names of fields can tell what
 * a request is about.
 */
export function TemplateExportDialog({ selected, onClose, templates }: TemplateExportDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={selected !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("templates.exportTitle")}</DialogTitle>
          <DialogDescription>{t("templates.exportText")}</DialogDescription>
        </DialogHeader>
        {/* A phone is shorter than the dialog can grow, so its body scrolls. */}
        <ScrollArea className="-mx-6 min-h-0 flex-1" viewportClassName="px-6 py-1">
          {selected && <ExportForm selected={selected} templates={templates} onClose={onClose} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({
  selected,
  templates,
  onClose,
}: {
  selected: string[];
  templates: readonly RequestTemplate[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [format, setFormat] = useState<"file" | "link">("file");
  const [sealed, setSealed] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const picked = templates.filter((template) => chosen.has(template.id));
  // Anyone who holds the file or the link can test guesses offline, so the password needs the
  // same length as the one of a file.
  const ready = picked.length > 0 && (!sealed || meetsPasswordMinimum(password)) && !busy;

  const toggle = (templateId: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(templateId);
      else next.delete(templateId);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const json = await exportTemplates(
        picked.map(fieldsOf),
        sealed ? { password, argon2id: hashWasmArgon2 } : undefined,
      );
      if (format === "link") {
        setLink(templatesLink(json));
        return;
      }
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "skysend-templates.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("templates.exported", { count: picked.length }));
      onClose();
    } catch (err) {
      const tooLarge = err instanceof TemplateExportError && err.reason === "tooLarge";
      toast.error(tooLarge ? t("templates.exportTooLarge") : t("templates.exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={link}
            aria-label={t("templates.linkLabel")}
            className="font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            onClick={async () => {
              await copyText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="text-primary-text" /> : <Copy />}
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {link.length > LONG_LINK ? t("templates.linkLong") : t("templates.linkHint")}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void run();
      }}
    >
      <fieldset className="overflow-hidden rounded-2xl border border-border">
        <legend className="sr-only">{t("templates.exportWhich")}</legend>
        <ScrollArea viewportClassName="max-h-36 sm:max-h-56">
          <ul className="divide-y divide-border" role="list">
            {templates.map((template) => (
              <li key={template.id}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
                  <Checkbox
                    checked={chosen.has(template.id)}
                    onCheckedChange={(v) => toggle(template.id, v === true)}
                  />
                  <span className="truncate">{template.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </fieldset>

      <ToggleGroup
        type="single"
        variant="cards"
        value={format}
        onValueChange={(v) => v && setFormat(v as "file" | "link")}
        aria-label={t("templates.exportAs")}
      >
        <ToggleGroupItem value="file">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <FileJson />
            {t("templates.asFile")}
          </span>
          <span className="text-xs text-muted-foreground">{t("templates.asFileHint")}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="link">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Link2 />
            {t("templates.asLink")}
          </span>
          <span className="text-xs text-muted-foreground">{t("templates.asLinkHint")}</span>
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-seal`} className="text-[13px]">
            {t("templates.seal")}
          </Label>
          <Switch id={`${id}-seal`} checked={sealed} onCheckedChange={setSealed} />
        </div>
        {sealed && (
          <PasswordProtectionInput
            value={password}
            onChange={setPassword}
            placeholder={t("templates.sealPlaceholder")}
          />
        )}
        {sealed && password !== "" && !meetsPasswordMinimum(password) ? (
          <p className="text-xs text-destructive-text">
            {t("share.passwordTooShort", { count: MIN_PASSWORD_LENGTH })}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("templates.sealHint")}</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!ready}>
          {busy && <Loader2 className="animate-spin" />}
          {t("templates.exportCount", { count: picked.length })}
        </Button>
      </DialogFooter>
    </form>
  );
}
