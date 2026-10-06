import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Inbox, Loader2, Lock } from "lucide-react";
import { REQUEST_TITLE_MAX_BYTES } from "@skysend/crypto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { ExpiryPicker, Row } from "@/components/ShareOptions";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import type { NewRequestOptions } from "@/hooks/useFileRequests";
import type { ServerConfig } from "@/lib/api";
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

interface RequestFormProps {
  config: ServerConfig;
  creating: boolean;
  onSubmit: (options: NewRequestOptions) => void;
}

/** What a requester sets for a new request: a title for the sender and the limits. */
export function RequestForm({ config, creating, onSubmit }: RequestFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const uploadOptions = Array.from({ length: config.fileRequestMaxUploads }, (_, i) => i + 1);
  const sizeOptions = requestSizeOptions(config.fileRequestMaxSize);

  const [title, setTitle] = useState("");
  const [expireSec, setExpireSec] = useState(config.fileRequestDefaultExpire);
  const [maxUploads, setMaxUploads] = useState(Math.min(10, config.fileRequestMaxUploads));
  const [maxSize, setMaxSize] = useState(config.fileRequestMaxSize);
  const [passwordEnabled, setPasswordEnabled] = useState(config.forceFilePassword);
  const [password, setPassword] = useState("");

  const titleTooLong = new TextEncoder().encode(title).length > REQUEST_TITLE_MAX_BYTES;
  const canSubmit = !creating && !titleTooLong && (!passwordEnabled || password.length > 0);
  const strong = <strong className="font-semibold text-foreground" />;

  const submit = () =>
    onSubmit({ title, expireSec, maxUploads, maxSize, password: passwordEnabled ? password : "" });

  return (
    <form
      className="space-y-5 p-3 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
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
            i18nKey="request.summary"
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
