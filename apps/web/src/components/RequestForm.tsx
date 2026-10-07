import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BookmarkPlus,
  File,
  Inbox,
  Layers,
  Loader2,
  Lock,
  NotebookPen,
  Pencil,
} from "lucide-react";
import { REQUEST_TITLE_MAX_BYTES, type RequestAsk } from "@skysend/crypto";
import { serializeTemplate } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlockListEditor } from "@/components/BlockListEditor";
import { ExpiryPicker, Row } from "@/components/ShareOptions";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import { SaveTemplateDialog, type SaveChoice } from "@/components/SaveTemplateDialog";
import { TemplateStart, builtInOf, type TemplateStartValue } from "@/components/TemplateStart";
import type { NewRequestOptions } from "@/hooks/useFileRequests";
import type { ServerConfig } from "@/lib/api";
import { requestSizeOptions, requestStart } from "@/lib/defaults";
import { briefFits } from "@/lib/file-request";
import { toDrafts, type DraftBlock } from "@/lib/note-editor";
import {
  builtInTemplate,
  readTemplateFields,
  templateBlocks,
  type RequestTemplate,
  type TemplateFields,
} from "@/lib/request-templates";
import { formatBytes, formatDuration } from "@/lib/utils";

type Mode = "files" | "note" | "both";
const ASKS: Record<Mode, RequestAsk[]> = {
  files: ["files"],
  note: ["note"],
  both: ["files", "note"],
};

/** The option closest to `value` from below, the smallest when all are larger, or `none`. */
function fitOption(options: readonly number[], value: number, none: number): number {
  const sorted = [...options].sort((a, b) => a - b);
  return sorted.filter((option) => option <= value).at(-1) ?? sorted[0] ?? none;
}

/** The tab of what a template asks for. */
function modeOf(asks: readonly RequestAsk[]): Mode {
  return asks.includes("files") ? (asks.includes("note") ? "both" : "files") : "note";
}

/** How many sends a mode takes, a submission of files and a note as one. */
function maxSendsOf(mode: Mode, config: ServerConfig): number {
  return mode === "both"
    ? Math.floor(config.fileRequestMaxUploads / 2)
    : config.fileRequestMaxUploads;
}

/**
 * The form as a template sets it up, within what this server offers. Without a template, the
 * form as it starts. A request for both falls back to one thing when the server takes too few
 * uploads for both.
 */
function setupFrom(fields: TemplateFields | null, config: ServerConfig) {
  const blocks = fields ? templateBlocks(fields) : [];
  let mode = modeOf(fields?.asks ?? ["files"]);
  if (mode === "both" && config.fileRequestMaxUploads < 2) {
    mode = blocks.length > 0 ? "note" : "files";
  }
  const limits = fields?.limits;
  // Without limits of its own, the form starts from this browser's defaults.
  const base = requestStart(config);
  return {
    mode,
    title: fields?.title ?? "",
    template: toDrafts(blocks),
    expireSec: limits
      ? fitOption(config.fileRequestExpireOptions, limits.expireSec, base.expireSec)
      : base.expireSec,
    maxUploads: limits ? Math.min(limits.sends, config.fileRequestMaxUploads) : base.sends,
    maxSize: limits
      ? fitOption(requestSizeOptions(config.fileRequestMaxSize), limits.maxSize, base.maxSize)
      : base.maxSize,
  };
}

type Setup = ReturnType<typeof setupFrom>;

/**
 * Whether the server offers less than the edited template sets up, so the form shows its own
 * values instead.
 */
function adjustedFrom(template: RequestTemplate, first: Setup, config: ServerConfig): boolean {
  const { limits } = template;
  if (first.mode !== modeOf(template.asks)) return true;
  if (!limits) return false;
  const sends = Math.min(first.maxUploads, maxSendsOf(first.mode, config));
  return (
    first.expireSec !== limits.expireSec ||
    sends !== limits.sends ||
    first.maxSize !== limits.maxSize
  );
}

interface RequestFormProps {
  config: ServerConfig;
  creating: boolean;
  /** Creates the request, and names the kept template it started from, if one. */
  onSubmit: (options: NewRequestOptions, template?: RequestTemplate) => void;
  /** The templates kept in this browser. */
  templates: readonly RequestTemplate[];
  /** The template the form starts from, picked in My Links. */
  start?: RequestTemplate;
  /** The template the form edits, instead of creating a request. */
  editing?: RequestTemplate;
  onSaveTemplate: (fields: TemplateFields, replace?: RequestTemplate) => Promise<RequestTemplate>;
  /** The edited template was saved, or the editing was cancelled. */
  onEditDone: () => void;
}

/**
 * What a requester sets for a new request: files, a note or both, a title for the sender, a
 * template for the note, and the limits. A kept template fills it in, and the form can be
 * kept as one. Editing a template uses the same form without creating anything.
 */
export function RequestForm({
  config,
  creating,
  onSubmit,
  templates,
  start,
  editing,
  onSaveTemplate,
  onEditDone,
}: RequestFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const sizeOptions = requestSizeOptions(config.fileRequestMaxSize);
  // A request for notes alone takes a common size, so the limit does not tell what it is for.
  const noteOnlySize =
    sizeOptions.find((size) => size >= 2 * config.noteMaxSize) ?? config.fileRequestMaxSize;

  const [first] = useState(() => setupFrom(editing ?? start ?? null, config));
  const [mode, setMode] = useState<Mode>(first.mode);
  const [template, setTemplate] = useState<DraftBlock[]>(first.template);
  const [title, setTitle] = useState(first.title);
  const [expireSec, setExpireSec] = useState(first.expireSec);
  const [maxUploads, setMaxUploads] = useState(first.maxUploads);
  const [maxSize, setMaxSize] = useState(first.maxSize);
  const [passwordEnabled, setPasswordEnabled] = useState(() => requestStart(config).password);
  const [password, setPassword] = useState("");
  const [startedFrom, setStartedFrom] = useState<TemplateStartValue>(
    editing?.id ?? start?.id ?? "blank",
  );
  const [saveOpen, setSaveOpen] = useState(false);
  // What an edit changed. What it left alone keeps the template's own value, also when this
  // server offers less and the form shows less.
  const [touched, setTouched] = useState({ mode: false, limits: false });
  const ownStart = templates.find((kept) => kept.id === startedFrom);
  const adjusted = !!editing && adjustedFrom(editing, first, config);
  const limit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setTouched((current) => ({ ...current, limits: true }));
    };

  const asks = ASKS[mode];
  const files = asks.includes("files");
  const note = asks.includes("note");
  // Files and a note go as one submission, which takes two uploads of the request.
  const both = files && note;
  const bothOffered = config.fileRequestMaxUploads >= 2;
  const maxSends = maxSendsOf(mode, config);
  const sends = Math.min(maxUploads, maxSends);
  const sendOptions = Array.from({ length: maxSends }, (_, i) => i + 1);
  const titleTooLong = new TextEncoder().encode(title).length > REQUEST_TITLE_MAX_BYTES;
  const templateTooLarge = !titleTooLong && !briefFits(title, asks, template);
  const canSave = !creating && !titleTooLong && !templateTooLarge;
  const canSubmit = canSave && !editing && (!passwordEnabled || password.length > 0);
  const strong = <strong className="font-semibold text-foreground" />;
  const countLabel = (count: number) =>
    both ? t("request.submissionsCount", { count }) : t("request.uploads", { count });

  const submit = () =>
    onSubmit(
      {
        title,
        asks,
        template: note && template.length > 0 ? template : null,
        expireSec,
        maxUploads: both ? sends * 2 : sends,
        maxSize: files ? maxSize : noteOnlySize,
        password: passwordEnabled ? password : "",
      },
      ownStart,
    );

  const apply = (setup: Setup & { startedFrom: TemplateStartValue }) => {
    setMode(setup.mode);
    setTitle(setup.title);
    setTemplate(setup.template);
    setExpireSec(setup.expireSec);
    setMaxUploads(setup.maxUploads);
    setMaxSize(setup.maxSize);
    setStartedFrom(setup.startedFrom);
  };

  /**
   * Fills the form in from a template, or empties it. What was typed is replaced, so a toast
   * offers to bring it back.
   */
  const pick = (value: TemplateStartValue) => {
    const builtIn = builtInOf(value);
    const fields = builtIn
      ? builtInTemplate(builtIn, (key) => t(key))
      : (templates.find((kept) => kept.id === value) ?? null);
    const before = { mode, title, template, expireSec, maxUploads, maxSize, startedFrom };
    apply({ ...setupFrom(fields, config), startedFrom: value });
    if (title.trim() || template.length > 0) {
      toast(t("templates.replacedForm"), {
        id: "template-pick",
        action: { label: t("templates.undo"), onClick: () => apply(before) },
      });
    }
  };

  const saveTemplate = async (choice: SaveChoice) => {
    const kept = title.trim();
    const ownLimits = editing && !touched.limits ? editing.limits : undefined;
    // Read like any other template, so what is kept is what an import would keep.
    const fields = readTemplateFields({
      name: choice.name,
      asks: editing && !touched.mode ? editing.asks : asks,
      ...(choice.keepTitle && kept ? { title: kept } : {}),
      ...(note && template.length > 0 ? { note: serializeTemplate(template) } : {}),
      ...(choice.keepLimits ? { limits: ownLimits ?? { expireSec, sends, maxSize } } : {}),
    });
    if (!fields) {
      toast.error(t("templates.saveFailed"));
      return;
    }
    try {
      const saved = await onSaveTemplate(fields, choice.replace);
      setSaveOpen(false);
      toast.success(t("templates.saved", { name: saved.name }));
      if (editing) onEditDone();
      else setStartedFrom(saved.id);
    } catch {
      toast.error(t("templates.saveFailed"));
    }
  };

  const form = (
    <form
      className="space-y-5 px-2 pb-2 pt-5 sm:px-4 sm:pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (editing) {
          if (canSave) setSaveOpen(true);
        } else if (canSubmit) {
          submit();
        }
      }}
    >
      {editing ? (
        <p className="flex items-start gap-2 rounded-2xl bg-well px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
          {/* The name is the requester's own text, so it stays out of any markup. */}
          <span className="min-w-0 wrap-anywhere">
            {t("templates.editing", { name: editing.name })}
            {adjusted && ` ${t("templates.editAdjusted")}`}
          </span>
        </p>
      ) : (
        <TemplateStart
          templates={templates}
          value={startedFrom}
          onPick={pick}
          disabled={creating}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-title`} className="text-[13px]">
          {t("request.titleLabel")}
        </Label>
        <Input
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("request.titlePlaceholder")}
          maxLength={REQUEST_TITLE_MAX_BYTES}
          aria-invalid={titleTooLong}
          disabled={creating}
        />
        <p
          className={
            titleTooLong ? "text-xs text-destructive-text" : "text-xs text-muted-foreground"
          }
        >
          {titleTooLong ? t("request.titleTooLong") : t("request.titleHint")}
        </p>
      </div>

      {note && (
        <section className="space-y-3" aria-labelledby={`${id}-template`}>
          <div>
            <h3 id={`${id}-template`} className="text-[13px] font-medium">
              {t("template.title")}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("template.hint")}
            </p>
          </div>
          <BlockListEditor
            drafts={template}
            onChange={setTemplate}
            mode="template"
            disabled={creating}
          />
          {templateTooLarge && (
            <p className="text-xs text-destructive-text" role="alert">
              {t("template.tooLarge")}
            </p>
          )}
        </section>
      )}

      <div className="space-y-4">
        <Row label={t("request.openFor")} labelId={`${id}-expiry`}>
          <ExpiryPicker
            options={config.fileRequestExpireOptions}
            value={expireSec}
            onChange={limit(setExpireSec)}
            labelId={`${id}-expiry`}
            disabled={creating}
          />
        </Row>

        <Row
          label={both ? t("request.submissions") : t("request.maxUploads")}
          labelId={`${id}-uploads`}
        >
          <div role="group" aria-labelledby={`${id}-uploads`}>
            <Stepper
              options={sendOptions}
              value={sends}
              onChange={limit(setMaxUploads)}
              format={(v) =>
                both
                  ? t("request.submissionsCount", { count: v })
                  : t("request.uploads", { count: v })
              }
              decreaseLabel={t("share.fewer")}
              increaseLabel={t("share.more")}
              disabled={creating}
            />
          </div>
        </Row>

        {files && (
          <Row label={t("request.maxSize")} labelId={`${id}-size`}>
            <div role="group" aria-labelledby={`${id}-size`}>
              <Stepper
                options={sizeOptions}
                value={maxSize}
                onChange={limit(setMaxSize)}
                format={formatBytes}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
                disabled={creating}
              />
            </div>
          </Row>
        )}

        {/* A template never keeps a password, so editing one asks for none. */}
        {!editing && (
          <>
            <Row
              labelId={`${id}-password`}
              label={
                <Label
                  htmlFor={`${id}-password-toggle`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {t("share.password")}
                </Label>
              }
            >
              <div className="flex items-center gap-3">
                {!config.forceFilePassword && (
                  <Switch
                    id={`${id}-password-toggle`}
                    checked={passwordEnabled}
                    onCheckedChange={setPasswordEnabled}
                    disabled={creating}
                  />
                )}
                <span className="text-[13px] text-muted-foreground">
                  {passwordEnabled ? t("request.passwordHint") : t("request.passwordOff")}
                </span>
              </div>
            </Row>

            {passwordEnabled && (
              <div className="sm:pl-40">
                <PasswordProtectionInput
                  value={password}
                  onChange={setPassword}
                  placeholder={t(
                    config.forceFilePassword
                      ? "upload.passwordPlaceholderRequired"
                      : "upload.passwordPlaceholder",
                  )}
                  disabled={creating}
                />
              </div>
            )}
          </>
        )}
      </div>

      {!editing && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("request.retentionHint", {
            time: formatDuration(config.fileRequestRetention),
            count: config.fileRequestDownloads,
          })}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl bg-well p-3 sm:flex-row sm:items-center sm:pl-5">
        <p className="flex-1 text-[13px] leading-snug text-muted-foreground">
          <Trans
            i18nKey={
              both ? "request.summaryBoth" : files ? "request.summary" : "request.summaryNote"
            }
            values={{
              expiry: formatDuration(expireSec),
              uploads: countLabel(sends),
              size: formatBytes(maxSize),
            }}
            components={{ b: strong }}
          />
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {editing ? (
            <>
              <Button type="button" size="lg" variant="outline" onClick={onEditDone}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="lg" disabled={!canSave}>
                <BookmarkPlus />
                {t("templates.saveEdited")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={!canSave}
                onClick={() => setSaveOpen(true)}
              >
                <BookmarkPlus />
                {t("templates.saveAs")}
              </Button>
              <Button type="submit" size="lg" disabled={!canSubmit}>
                {creating ? <Loader2 className="animate-spin" /> : <Inbox />}
                {creating ? t("request.creating") : t("request.create")}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );

  const limits = [
    formatDuration(expireSec),
    countLabel(sends),
    ...(files ? [formatBytes(maxSize)] : []),
  ].join(" · ");
  const keep = editing ?? ownStart;

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => {
        setMode(v as Mode);
        setTouched((current) => ({ ...current, mode: true }));
      }}
    >
      <TabsList variant="cards" aria-label={t("request.asks")}>
        <TabsTrigger value="files" disabled={creating}>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <File />
            {t("request.asksFiles")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("requestUpload.fileTabHint", { size: formatBytes(config.fileRequestMaxSize) })}
          </span>
        </TabsTrigger>
        <TabsTrigger value="note" disabled={creating}>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <NotebookPen />
            {t("request.asksNote")}
          </span>
          <span className="text-xs text-muted-foreground">{t("request.asksNoteHint")}</span>
        </TabsTrigger>
        {/* One submission of both takes two uploads, so it needs room for two. */}
        <TabsTrigger value="both" disabled={creating || !bothOffered}>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Layers />
            {t("request.asksBoth")}
          </span>
          <span className="text-xs text-muted-foreground">
            {bothOffered ? t("request.asksBothHint") : t("request.asksBothUnavailable")}
          </span>
        </TabsTrigger>
      </TabsList>
      {/* One panel for every tab, since the form is the same and only what it asks for changes. */}
      <TabsContent value={mode}>{form}</TabsContent>
      <SaveTemplateDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultName={keep?.name ?? title.trim()}
        title={title.trim()}
        limits={limits}
        keepLimits={keep ? !!keep.limits : true}
        templates={templates}
        editing={editing}
        onSave={saveTemplate}
      />
    </Tabs>
  );
}
