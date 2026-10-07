import { useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BookmarkPlus,
  Copy,
  Download,
  File,
  Layers,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateExportDialog } from "@/components/TemplateExportDialog";
import { TemplateImportDialog, type ImportSource } from "@/components/TemplateImportDialog";
import { useRequestTemplates } from "@/hooks/useRequestTemplates";
import {
  BUILT_IN_KEYS,
  builtInTemplate,
  fieldNames,
  freeName,
  MAX_EXPORT_BYTES,
  templateBlocks,
  templateSummary,
  type RequestTemplate,
  type TemplateFields,
} from "@/lib/request-templates";

interface TemplateListProps {
  /** An export that came with a templates link, to import right away. */
  linkImport?: string;
  onLinkImportDone?: () => void;
}

/**
 * The Templates tab of My Links: the templates kept in this browser, the ones that come with
 * SkySend, and export and import to move them to another browser.
 */
export function TemplateList({ linkImport, onLinkImportDone }: TemplateListProps) {
  const { t, i18n } = useTranslation();
  const translate = (key: string, options?: Record<string, unknown>) => t(key, options);
  const kept = useRequestTemplates();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [fileImport, setFileImport] = useState<ImportSource | null>(null);
  const [deleting, setDeleting] = useState<RequestTemplate | null>(null);
  const [removing, setRemoving] = useState(false);
  // When the tab opened, so "last used" reads the same on every render.
  const [now] = useState(() => Date.now());
  const importing: ImportSource | null =
    fileImport ?? (linkImport !== undefined ? { text: linkImport, fileName: null } : null);

  const ago = (iso: string) => {
    const seconds = (new Date(iso).getTime() - now) / 1000;
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 31_536_000],
      ["month", 2_592_000],
      ["week", 604_800],
      ["day", 86_400],
      ["hour", 3600],
      ["minute", 60],
    ];
    const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
    const [unit, size] = steps.find(([, size]) => Math.abs(seconds) >= size) ?? ["minute", 60];
    return format.format(Math.round(seconds / size), unit);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_EXPORT_BYTES) {
      toast.error(t("templates.importError.tooLarge"));
      return;
    }
    try {
      setFileImport({ text: await file.text(), fileName: file.name });
    } catch {
      toast.error(t("templates.importError.invalid"));
    }
  };

  const closeImport = () => {
    setFileImport(null);
    if (!fileImport) onLinkImportDone?.();
  };

  const copyBuiltIn = async (fields: TemplateFields) => {
    try {
      const saved = await kept.save({
        ...fields,
        name: freeName(
          fields.name,
          kept.templates.map((template) => template.name),
        ),
      });
      toast.success(t("templates.copied", { name: saved.name }));
    } catch {
      toast.error(t("templates.saveFailed"));
    }
  };

  const remove = async (template: RequestTemplate) => {
    setRemoving(true);
    try {
      await kept.remove(template.id);
      setDeleting(null);
      toast.success(t("templates.deleted"));
    } catch {
      toast.error(t("templates.deleteFailed"));
    } finally {
      setRemoving(false);
    }
  };

  const duplicate = async (template: RequestTemplate) => {
    try {
      const copy = await kept.duplicate(template);
      toast.success(t("templates.duplicated", { name: copy.name }));
    } catch {
      toast.error(t("templates.saveFailed"));
    }
  };

  const tile = (fields: TemplateFields) => {
    const Icon = fields.asks.length > 1 ? Layers : fields.asks[0] === "files" ? File : NotebookPen;
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
        <Icon className="h-4 w-4" />
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {t("templates.own")}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {kept.templates.length}
          </span>
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload />
            {t("templates.import")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={kept.templates.length === 0}
            onClick={() => setExporting(kept.templates.map((template) => template.id))}
          >
            <Download />
            {t("templates.exportAll")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {kept.loading ? (
        <Card className="overflow-hidden" aria-busy="true">
          <ul className="divide-y divide-border">
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-9 w-24 rounded-lg" />
              </li>
            ))}
          </ul>
        </Card>
      ) : kept.templates.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
            <BookmarkPlus className="h-5 w-5" />
          </span>
          <p className="font-semibold tracking-tight">{t("templates.empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("templates.emptyHint")}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border" role="list">
            {kept.templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  {tile(template)}
                  <div className="min-w-0 flex-1">
                    <p id={`template-${template.id}`} className="truncate text-sm font-semibold">
                      {template.name}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">
                      {templateSummary(template, translate)} ·{" "}
                      {template.usedAt
                        ? t("templates.usedAgo", { time: ago(template.usedAt) })
                        : t("templates.neverUsed")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                  {/* The name of the row tells the buttons of one row from those of another. */}
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      to={`/requests?template=${encodeURIComponent(template.id)}`}
                      aria-describedby={`template-${template.id}`}
                    >
                      {t("templates.use")}
                    </Link>
                  </Button>
                  {/* Not modal, so a dialog opened from an item gets the focus back. */}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        aria-label={t("share.moreActions")}
                        aria-describedby={`template-${template.id}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/requests?edit=${encodeURIComponent(template.id)}`}>
                          <Pencil />
                          {t("templates.edit")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void duplicate(template)}>
                        <Copy />
                        {t("templates.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setExporting([template.id])}>
                        <Download />
                        {t("templates.export")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleting(template)}
                        className="text-destructive-text focus:bg-destructive-soft focus:text-destructive-text"
                      >
                        <Trash2 />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="templates-built-in">
        <h2 id="templates-built-in" className="text-sm font-semibold">
          {t("templates.builtIn.section")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2" role="list">
          {BUILT_IN_KEYS.map((key) => {
            const fields = builtInTemplate(key, translate);
            return (
              <li key={key}>
                <Card className="flex h-full flex-col gap-1 p-4">
                  <p className="text-sm font-semibold">{fields.name}</p>
                  <p className="flex-1 text-xs text-muted-foreground">
                    {fieldNames(templateBlocks(fields), translate).join(", ")}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto self-start px-0 pt-1"
                    onClick={() => void copyBuiltIn(fields)}
                  >
                    {t("templates.copyBuiltIn")}
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">{t("templates.localHint")}</p>

      <TemplateExportDialog
        selected={exporting}
        onClose={() => setExporting(null)}
        templates={kept.templates}
      />
      <TemplateImportDialog
        // An import is checked against the kept templates, so it waits until they are read.
        source={kept.loading ? null : importing}
        onClose={closeImport}
        templates={kept.templates}
        onImport={kept.importItems}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("templates.deleteTitle")}</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              {t("templates.deleteText", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => deleting && void remove(deleting)}
            >
              {removing && <Loader2 className="animate-spin" />}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
