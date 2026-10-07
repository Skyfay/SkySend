import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { File, Inbox, Lock, NotebookPen, RotateCcw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { ExpiryPicker, Row, useLimitLabel } from "@/components/ShareOptions";
import { useBrowserDefaults } from "@/hooks/useBrowserDefaults";
import type { ServerConfig } from "@/lib/api";
import {
  fileStart,
  noteStart,
  requestSizeOptions,
  requestStart,
  type BrowserDefaults,
} from "@/lib/defaults";
import { formatBytes } from "@/lib/utils";

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
        <Label htmlFor={id} className="flex items-center gap-2 text-[13px]">
          <Lock className="h-3.5 w-3.5" />
          {t("share.password")}
        </Label>
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
  const changed = (section: keyof BrowserDefaults) =>
    Object.values(defaults[section]).some((value) => value !== undefined);

  const file = fileStart(config, defaults.file);
  const note = noteStart(config, defaults.note);
  const request = requestStart(config, defaults.request);
  const sendOptions = Array.from({ length: config.fileRequestMaxUploads }, (_, i) => i + 1);

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
            <ExpiryPicker
              options={config.fileExpireOptions}
              value={file.expireSec}
              onChange={(expireSec) => update("file", { expireSec })}
              labelId={`${id}-file-expiry`}
              disabled={false}
            />
          </Row>
          <Row label={t("upload.downloads")} labelId={`${id}-file-limit`}>
            <div role="group" aria-labelledby={`${id}-file-limit`}>
              <Stepper
                options={config.fileDownloadOptions}
                value={file.limit}
                onChange={(limit) => update("file", { limit })}
                format={fileLimit}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
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
            <ExpiryPicker
              options={config.noteExpireOptions}
              value={note.expireSec}
              onChange={(expireSec) => update("note", { expireSec })}
              labelId={`${id}-note-expiry`}
              disabled={false}
            />
          </Row>
          <Row label={t("note.maxViews")} labelId={`${id}-note-limit`}>
            <div role="group" aria-labelledby={`${id}-note-limit`}>
              <Stepper
                options={config.noteViewOptions}
                value={note.limit}
                onChange={(limit) => update("note", { limit })}
                format={noteLimit}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
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
            <ExpiryPicker
              options={config.fileRequestExpireOptions}
              value={request.expireSec}
              onChange={(expireSec) => update("request", { expireSec })}
              labelId={`${id}-request-expiry`}
              disabled={false}
            />
          </Row>
          <Row label={t("request.maxUploads")} labelId={`${id}-request-sends`}>
            <div role="group" aria-labelledby={`${id}-request-sends`} className="space-y-1.5">
              <Stepper
                options={sendOptions}
                value={request.sends}
                onChange={(sends) => update("request", { sends })}
                format={(count) => t("request.uploads", { count })}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
              />
              <p className="text-xs text-muted-foreground">{t("settings.sendsHint")}</p>
            </div>
          </Row>
          <Row label={t("request.maxSize")} labelId={`${id}-request-size`}>
            <div role="group" aria-labelledby={`${id}-request-size`}>
              <Stepper
                options={requestSizeOptions(config.fileRequestMaxSize)}
                value={request.maxSize}
                onChange={(maxSize) => update("request", { maxSize })}
                format={formatBytes}
                decreaseLabel={t("share.fewer")}
                increaseLabel={t("share.more")}
              />
            </div>
          </Row>
          <PasswordRow
            forced={config.forceFilePassword}
            checked={request.password}
            onChange={(password) => update("request", { password })}
          />
        </Section>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.defaultsHint")}</p>
    </div>
  );
}
