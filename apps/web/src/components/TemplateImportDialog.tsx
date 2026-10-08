import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { PasswordBox } from "@skysend/crypto";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ImportChoice } from "@/hooks/useRequestTemplates";
import { hashWasmArgon2 } from "@/lib/argon2";
import {
  openTemplateExport,
  planImport,
  readTemplateExport,
  templateSummary,
  TemplateExportError,
  type ImportItem,
  type RequestTemplate,
  type TemplateFields,
} from "@/lib/request-templates";

/** An export to import: the text of a file or of a link, and where it came from. */
export interface ImportSource {
  text: string;
  /** The file name, or null for a link. */
  fileName: string | null;
}

type Step =
  | { kind: "error"; reason: TemplateExportError["reason"] }
  | { kind: "password"; box: PasswordBox }
  | { kind: "review"; found: TemplateFields[]; skipped: number };

/** What an export holds, or why it does not read. */
function firstStep(source: ImportSource): Step {
  try {
    const read = readTemplateExport(source.text);
    return read.sealed
      ? { kind: "password", box: read.box }
      : { kind: "review", found: read.templates, skipped: read.skipped };
  } catch (err) {
    return { kind: "error", reason: err instanceof TemplateExportError ? err.reason : "invalid" };
  }
}

interface TemplateImportDialogProps {
  source: ImportSource | null;
  onClose: () => void;
  templates: readonly RequestTemplate[];
  onImport: (items: readonly ImportItem[], choices: readonly ImportChoice[]) => Promise<void>;
}

/**
 * Imports templates from a file or a link. Everything in it is read as untrusted, like a
 * template of a stranger: names and labels are cleaned, values are dropped. A template with
 * the name of a kept one replaces it, or goes in beside it.
 */
export function TemplateImportDialog({ source, onClose, ...props }: TemplateImportDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("templates.importTitle")}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {source?.fileName
              ? t("templates.importFromFile", { name: source.fileName })
              : t("templates.importFromLink")}
          </DialogDescription>
        </DialogHeader>
        {/* A phone is shorter than the dialog can grow, so its body scrolls. */}
        <ScrollArea className="-mx-6 min-h-0 flex-1" viewportClassName="px-6 py-1">
          {source && <ImportFlow source={source} onClose={onClose} {...props} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ImportFlow({
  source,
  onClose,
  templates,
  onImport,
}: Omit<TemplateImportDialogProps, "source"> & { source: ImportSource }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(() => firstStep(source));

  if (step.kind === "error") {
    return (
      <div className="space-y-5">
        <p className="flex items-start gap-2 rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t(`templates.importError.${step.reason}`)}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </div>
    );
  }
  if (step.kind === "password") {
    return (
      <PasswordStep
        box={step.box}
        onOpened={(found, skipped) => setStep({ kind: "review", found, skipped })}
        onFailed={(reason) => setStep({ kind: "error", reason })}
        onClose={onClose}
      />
    );
  }
  return (
    <ReviewStep
      found={step.found}
      skipped={step.skipped}
      templates={templates}
      onImport={onImport}
      onClose={onClose}
    />
  );
}

function PasswordStep({
  box,
  onOpened,
  onFailed,
  onClose,
}: {
  box: PasswordBox;
  onOpened: (found: TemplateFields[], skipped: number) => void;
  onFailed: (reason: TemplateExportError["reason"]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const open = async () => {
    setBusy(true);
    setWrong(false);
    try {
      const { templates, skipped } = await openTemplateExport(box, password, hashWasmArgon2);
      onOpened(templates, skipped);
    } catch (err) {
      const reason = err instanceof TemplateExportError ? err.reason : "invalid";
      if (reason === "password") setWrong(true);
      else onFailed(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password && !busy) void open();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-password`} className="text-[13px]">
          {t("templates.importPassword")}
        </Label>
        <Input
          id={`${id}-password`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={wrong}
          autoComplete="off"
          autoFocus
        />
        {wrong && (
          <p className="text-xs text-destructive-text" role="alert">
            {t("templates.importError.password")}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!password || busy}>
          {busy && <Loader2 className="animate-spin" />}
          {t("templates.importOpen")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReviewStep({
  found,
  skipped,
  templates,
  onImport,
  onClose,
}: {
  found: TemplateFields[];
  skipped: number;
  templates: readonly RequestTemplate[];
  onImport: TemplateImportDialogProps["onImport"];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const translate = (key: string, options?: Record<string, unknown>) => t(key, options);
  const [items] = useState(() => planImport(found, templates));
  // Nothing kept is replaced unless chosen: an import may come from someone else's link.
  const [choices, setChoices] = useState<ImportChoice[]>(() => items.map(() => "keep"));
  const [busy, setBusy] = useState(false);
  const count = items.filter((item, i) => !item.existing || choices[i] !== "skip").length;

  const run = async () => {
    setBusy(true);
    try {
      await onImport(items, choices);
      toast.success(t("templates.imported", { count }));
      onClose();
    } catch {
      toast.error(t("templates.importFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border">
          <ScrollArea viewportClassName="max-h-48 sm:max-h-64">
            <ul className="divide-y divide-border" role="list">
              {items.map((item, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5">
                  {/* What it would set up, so a template from a stranger shows what it asks. */}
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-[13px]">{item.fields.name}</span>
                    <span className="block text-xs text-muted-foreground wrap-anywhere">
                      {templateSummary(item.fields, translate)}
                    </span>
                    {item.fields.title && (
                      <span className="line-clamp-2 block text-xs text-muted-foreground wrap-anywhere">
                        {t("templates.quoted", { text: item.fields.title })}
                      </span>
                    )}
                  </span>
                  {item.existing ? (
                    <>
                      <Badge variant="warning" className="h-6">
                        {t("templates.importExists")}
                      </Badge>
                      <ToggleGroup
                        type="single"
                        variant="segmented"
                        value={choices[index]}
                        onValueChange={(v) =>
                          v &&
                          setChoices((current) =>
                            current.map((choice, i) =>
                              i === index ? (v as ImportChoice) : choice,
                            ),
                          )
                        }
                        aria-label={t("templates.importChoice", { name: item.fields.name })}
                      >
                        <ToggleGroupItem value="replace">{t("templates.replace")}</ToggleGroupItem>
                        <ToggleGroupItem value="keep">{t("templates.keepBoth")}</ToggleGroupItem>
                        <ToggleGroupItem value="skip">{t("templates.skip")}</ToggleGroupItem>
                      </ToggleGroup>
                    </>
                  ) : (
                    <Badge variant="accent" className="h-6">
                      {t("templates.importNew")}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      ) : (
        <p className="rounded-2xl bg-well px-4 py-3 text-sm text-muted-foreground">
          {t("templates.importNone")}
        </p>
      )}

      {skipped > 0 && (
        <p className="text-xs text-warning">{t("templates.importSkipped", { count: skipped })}</p>
      )}
      <p className="flex items-start gap-2 rounded-2xl bg-well px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        {t("templates.importChecked")}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void run()} disabled={count === 0 || busy}>
          {busy && <Loader2 className="animate-spin" />}
          {t("templates.importCount", { count })}
        </Button>
      </DialogFooter>
    </div>
  );
}
