import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { File, Inbox, Layers, Loader2, Lock, NotebookPen } from "lucide-react";
import { REQUEST_BRIEF_MAX_BYTES, REQUEST_TITLE_MAX_BYTES, type RequestAsk } from "@skysend/crypto";
import { serializeTemplate } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BlockListEditor } from "@/components/BlockListEditor";
import { ExpiryPicker, Row } from "@/components/ShareOptions";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import type { NewRequestOptions } from "@/hooks/useFileRequests";
import type { ServerConfig } from "@/lib/api";
import type { DraftBlock } from "@/lib/note-editor";
import { formatBytes, formatDuration } from "@/lib/utils";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
/** Sizes a requester can pick, as far as the server allows. */
const SIZE_STEPS = [
  10 * MIB,
  50 * MIB,
  100 * MIB,
  250 * MIB,
  500 * MIB,
  GIB,
  2 * GIB,
  5 * GIB,
  10 * GIB,
  20 * GIB,
  50 * GIB,
  100 * GIB,
];

/** The size steps below the server maximum, and the maximum itself. */
function requestSizeOptions(max: number): number[] {
  return [...SIZE_STEPS.filter((size) => size < max), max];
}

type Mode = "files" | "note" | "both";
const ASKS: Record<Mode, RequestAsk[]> = {
  files: ["files"],
  note: ["note"],
  both: ["files", "note"],
};

/**
 * Whether the brief would fit: the title, what is asked for and the template, as the brief
 * carries them. A template the format refuses does not fit either.
 */
function briefFits(title: string, asks: RequestAsk[], template: DraftBlock[]): boolean {
  try {
    const blocks =
      asks.includes("note") && template.length > 0 ? serializeTemplate(template) : null;
    const json = JSON.stringify({ v: 1, title: title || null, asks, template: blocks });
    return new TextEncoder().encode(json).length <= REQUEST_BRIEF_MAX_BYTES;
  } catch {
    return false;
  }
}

interface RequestFormProps {
  config: ServerConfig;
  creating: boolean;
  onSubmit: (options: NewRequestOptions) => void;
}

/**
 * What a requester sets for a new request: files, a note or both, a title for the sender, a
 * template for the note, and the limits.
 */
export function RequestForm({ config, creating, onSubmit }: RequestFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const uploadOptions = Array.from({ length: config.fileRequestMaxUploads }, (_, i) => i + 1);
  const sizeOptions = requestSizeOptions(config.fileRequestMaxSize);
  // A request for notes alone takes a common size, so the limit does not tell what it is for.
  const noteOnlySize =
    sizeOptions.find((size) => size >= 2 * config.noteMaxSize) ?? config.fileRequestMaxSize;

  const [mode, setMode] = useState<Mode>("files");
  const [template, setTemplate] = useState<DraftBlock[]>([]);
  const [title, setTitle] = useState("");
  const [expireSec, setExpireSec] = useState(config.fileRequestDefaultExpire);
  const [maxUploads, setMaxUploads] = useState(Math.min(10, config.fileRequestMaxUploads));
  const [maxSize, setMaxSize] = useState(config.fileRequestMaxSize);
  const [passwordEnabled, setPasswordEnabled] = useState(config.forceFilePassword);
  const [password, setPassword] = useState("");

  const asks = ASKS[mode];
  const files = asks.includes("files");
  const note = asks.includes("note");
  const titleTooLong = new TextEncoder().encode(title).length > REQUEST_TITLE_MAX_BYTES;
  const templateTooLarge = !titleTooLong && !briefFits(title, asks, template);
  const canSubmit =
    !creating && !titleTooLong && !templateTooLarge && (!passwordEnabled || password.length > 0);
  const strong = <strong className="font-semibold text-foreground" />;

  const submit = () =>
    onSubmit({
      title,
      asks,
      template: note && template.length > 0 ? template : null,
      expireSec,
      maxUploads,
      maxSize: files ? maxSize : noteOnlySize,
      password: passwordEnabled ? password : "",
    });

  return (
    <form
      className="space-y-5 p-3 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <Row label={t("request.asks")} labelId={`${id}-asks`}>
        <ToggleGroup
          variant="segmented"
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as Mode)}
          aria-labelledby={`${id}-asks`}
          disabled={creating}
        >
          <ToggleGroupItem value="files">
            <File />
            {t("request.asksFiles")}
          </ToggleGroupItem>
          <ToggleGroupItem value="note">
            <NotebookPen />
            {t("request.asksNote")}
          </ToggleGroupItem>
          <ToggleGroupItem value="both">
            <Layers />
            {t("request.asksBoth")}
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>

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
            onChange={setExpireSec}
            labelId={`${id}-expiry`}
            disabled={creating}
          />
        </Row>

        <Row label={t("request.maxUploads")} labelId={`${id}-uploads`}>
          <div role="group" aria-labelledby={`${id}-uploads`}>
            <Stepper
              options={uploadOptions}
              value={maxUploads}
              onChange={setMaxUploads}
              format={(v) => t("request.uploads", { count: v })}
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
                onChange={setMaxSize}
                format={formatBytes}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
                disabled={creating}
              />
            </div>
          </Row>
        )}

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
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("request.retentionHint", {
          time: formatDuration(config.fileRequestRetention),
          count: config.fileRequestDownloads,
        })}
      </p>

      <div className="flex flex-col gap-3 rounded-2xl bg-well p-3 sm:flex-row sm:items-center sm:pl-5">
        <p className="flex-1 text-[13px] leading-snug text-muted-foreground">
          <Trans
            i18nKey={files ? "request.summary" : "request.summaryNote"}
            values={{
              expiry: formatDuration(expireSec),
              uploads: t("request.uploads", { count: maxUploads }),
              size: formatBytes(maxSize),
            }}
            components={{ b: strong }}
          />
        </p>
        <Button type="submit" size="lg" disabled={!canSubmit} className="w-full sm:w-auto">
          {creating ? <Loader2 className="animate-spin" /> : <Inbox />}
          {creating ? t("request.creating") : t("request.create")}
        </Button>
      </div>
    </form>
  );
}
