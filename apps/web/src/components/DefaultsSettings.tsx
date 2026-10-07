import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Download,
  Eye,
  File,
  HardDrive,
  Inbox,
  Lock,
  NotebookPen,
  RotateCcw,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OptionPill } from "@/components/OptionPill";
import { useLimitLabel, useViewChips } from "@/components/ShareOptions";
import { useBrowserDefaults } from "@/hooks/useBrowserDefaults";
import type { ServerConfig } from "@/lib/api";
import {
  fileStart,
  noteStart,
  requestSizeOptions,
  requestStart,
  type BrowserDefaults,
} from "@/lib/defaults";
import { formatBytes, formatDuration } from "@/lib/utils";

/** A setting with its name beside it, or above it on a phone. */
function Row({
  label,
  labelId,
  children,
}: {
  label: ReactNode;
  labelId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span
        id={labelId}
        className="flex items-center gap-2 text-[13px] font-medium sm:w-36 sm:shrink-0"
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  changed,
  onReset,
  children,
}: {
  icon: LucideIcon;
  title: string;
  changed: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex min-h-9 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
          <Icon className="h-4 w-4" />
        </span>
        <h2
          id={id}
          ref={heading}
          tabIndex={-1}
          className="flex-1 text-sm font-semibold outline-none"
        >
          {title}
        </h2>
        {changed && (
          <Button
            variant="ghost"
            size="sm"
            aria-describedby={id}
            onClick={() => {
              onReset();
              // The button goes once nothing is left to reset, so focus stays in its section.
              heading.current?.focus();
            }}
          >
            <RotateCcw />
            {t("settings.reset")}
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
}

/** Whether the password starts on, unless the server asks for one anyway. */
function PasswordRow({
  forced,
  checked,
  onChange,
}: {
  forced: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Row
      labelId={`${id}-label`}
      label={
        // A forced password has no switch for the label to point at.
        forced ? (
          <span className="flex items-center gap-2 text-[13px]">
            <Lock className="h-3.5 w-3.5" />
            {t("share.password")}
          </span>
        ) : (
          <Label htmlFor={id} className="flex items-center gap-2 text-[13px]">
            <Lock className="h-3.5 w-3.5" />
            {t("share.password")}
          </Label>
        )
      }
    >
      <div className="flex items-center gap-3">
        {!forced && <Switch id={id} checked={checked} onCheckedChange={onChange} />}
        <span className="text-[13px] text-muted-foreground">
          {forced
            ? t("upload.passwordRequired")
            : checked
              ? t("settings.passwordOn")
              : t("settings.passwordOff")}
        </span>
      </div>
    </Row>
  );
}

/**
 * What the forms of this browser start with: for a file, a note and a request. Every value
 * is one the server offers, and what is never changed follows the server's own default.
 */
export function DefaultsSettings({ config }: { config: ServerConfig }) {
  const { t } = useTranslation();
  const id = useId();
  const { defaults, update, reset } = useBrowserDefaults();
  const fileLimit = useLimitLabel("file");
  const noteLimit = useLimitLabel("note");
  const viewChips = useViewChips(config.noteViewOptions);
  const changed = (section: keyof BrowserDefaults) =>
    Object.values(defaults[section]).some((value) => value !== undefined);

  const file = fileStart(config, defaults.file);
  const note = noteStart(config, defaults.note);
  const request = requestStart(config, defaults.request);

  return (
    <div className="space-y-4">
      {config.enabledServices.includes("file") && (
        <Section
          icon={File}
          title={t("settings.files")}
          changed={changed("file")}
          onReset={() => reset("file")}
        >
          <Row label={t("share.expires")} labelId={`${id}-file-expiry`}>
            <div role="group" aria-labelledby={`${id}-file-expiry`}>
              <OptionPill
                labelledBy={`${id}-file-expiry`}
                icon={Clock}
                label={formatDuration(file.expireSec)}
                title={t("share.pick.expiry")}
                options={config.fileExpireOptions}
                value={file.expireSec}
                onChange={(expireSec) => update("file", { expireSec })}
                format={formatDuration}
                columns={3}
              />
            </div>
          </Row>
          <Row label={t("upload.downloads")} labelId={`${id}-file-limit`}>
            <div role="group" aria-labelledby={`${id}-file-limit`}>
              <OptionPill
                labelledBy={`${id}-file-limit`}
                icon={Download}
                label={fileLimit(file.limit)}
                title={t("share.pick.downloads")}
                options={config.fileDownloadOptions}
                value={file.limit}
                onChange={(limit) => update("file", { limit })}
                format={String}
                columns={4}
              />
            </div>
          </Row>
          <PasswordRow
            forced={config.forceFilePassword}
            checked={file.password}
            onChange={(password) => update("file", { password })}
          />
        </Section>
      )}

      {config.enabledServices.includes("note") && (
        <Section
          icon={NotebookPen}
          title={t("settings.notes")}
          changed={changed("note")}
          onReset={() => reset("note")}
        >
          <Row label={t("share.expires")} labelId={`${id}-note-expiry`}>
            <div role="group" aria-labelledby={`${id}-note-expiry`}>
              <OptionPill
                labelledBy={`${id}-note-expiry`}
                icon={Clock}
                label={formatDuration(note.expireSec)}
                title={t("share.pick.expiry")}
                options={config.noteExpireOptions}
                value={note.expireSec}
                onChange={(expireSec) => update("note", { expireSec })}
                format={formatDuration}
                columns={3}
              />
            </div>
          </Row>
          <Row label={t("note.maxViews")} labelId={`${id}-note-limit`}>
            <div role="group" aria-labelledby={`${id}-note-limit`}>
              <OptionPill
                labelledBy={`${id}-note-limit`}
                icon={Eye}
                label={noteLimit(note.limit)}
                title={t("share.pick.views")}
                hint={viewChips.hint}
                options={config.noteViewOptions}
                value={note.limit}
                onChange={(limit) => update("note", { limit })}
                format={viewChips.format}
                optionLabel={viewChips.optionLabel}
                columns={4}
              />
            </div>
          </Row>
          <PasswordRow
            forced={config.forceNotePassword}
            checked={note.password}
            onChange={(password) => update("note", { password })}
          />
        </Section>
      )}

      {config.fileRequestsEnabled && (
        <Section
          icon={Inbox}
          title={t("settings.requests")}
          changed={changed("request")}
          onReset={() => reset("request")}
        >
          <Row label={t("request.openFor")} labelId={`${id}-request-expiry`}>
            <div role="group" aria-labelledby={`${id}-request-expiry`}>
              <OptionPill
                labelledBy={`${id}-request-expiry`}
                icon={Clock}
                label={formatDuration(request.expireSec)}
                title={t("request.pick.expiry")}
                options={config.fileRequestExpireOptions}
                value={request.expireSec}
                onChange={(expireSec) => update("request", { expireSec })}
                format={formatDuration}
                columns={3}
              />
            </div>
          </Row>
          <Row label={t("request.maxUploads")} labelId={`${id}-request-sends`}>
            <div role="group" aria-labelledby={`${id}-request-sends`} className="space-y-1.5">
              <OptionPill
                labelledBy={`${id}-request-sends`}
                icon={Upload}
                label={t("request.uploads", { count: request.sends })}
                title={t("request.pick.uploads")}
                options={config.fileRequestUploadOptions}
                value={request.sends}
                onChange={(sends) => update("request", { sends })}
                format={String}
                columns={4}
              />
              <p className="text-xs text-muted-foreground">{t("settings.sendsHint")}</p>
            </div>
          </Row>
          <Row label={t("request.maxSize")} labelId={`${id}-request-size`}>
            <div role="group" aria-labelledby={`${id}-request-size`}>
              <OptionPill
                labelledBy={`${id}-request-size`}
                icon={HardDrive}
                label={formatBytes(request.maxSize)}
                title={t("request.pick.size")}
                options={requestSizeOptions(config.fileRequestMaxSize)}
                value={request.maxSize}
                onChange={(maxSize) => update("request", { maxSize })}
                format={formatBytes}
                columns={3}
              />
            </div>
          </Row>
          <Row label={t("request.downloads")} labelId={`${id}-request-downloads`}>
            <div role="group" aria-labelledby={`${id}-request-downloads`}>
              <OptionPill
                labelledBy={`${id}-request-downloads`}
                icon={Download}
                label={fileLimit(request.downloads)}
                title={t("request.pick.downloads")}
                options={config.fileRequestDownloadOptions}
                value={request.downloads}
                onChange={(downloads) => update("request", { downloads })}
                format={String}
                columns={4}
              />
            </div>
          </Row>
          <PasswordRow
            forced={config.forceRequestPassword}
            checked={request.password}
            onChange={(password) => update("request", { password })}
          />
        </Section>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.defaultsHint")}</p>
    </div>
  );
}
