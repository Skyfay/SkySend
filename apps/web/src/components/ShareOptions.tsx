import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Stepper } from "@/components/ui/stepper";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import { formatDuration } from "@/lib/utils";

export type ShareKind = "file" | "note";

interface ShareOptionsProps {
  kind: ShareKind;
  expireOptions: number[];
  expireSec: number;
  onExpireChange: (value: number) => void;
  /** Download limits for files, view limits for notes, in the order the server sends them. */
  limitOptions: number[];
  limit: number;
  onLimitChange: (value: number) => void;
  passwordEnabled: boolean;
  onPasswordEnabledChange: (value: boolean) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  forcePassword?: boolean;
  disabled?: boolean;
}

/** How a limit reads, for the stepper and for the summary above the share button. */
export function useLimitLabel(kind: ShareKind) {
  const { t } = useTranslation();
  return (value: number, short = false) => {
    if (kind === "file") return t("share.downloads", { count: value });
    if (value === 0) return t("note.unlimited");
    if (value === 1 && !short) return t("note.burnAfterReading");
    return t("share.views", { count: value });
  };
}

function Row({ label, labelId, children }: { label: ReactNode; labelId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span id={labelId} className="flex items-center gap-2 text-[13px] font-medium sm:w-36 sm:shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Expiry, download or view limit and password for a share. Expiry options are chips
 * because there are few of them, limits use a stepper because there can be nine.
 */
export function ShareOptions({
  kind,
  expireOptions,
  expireSec,
  onExpireChange,
  limitOptions,
  limit,
  onLimitChange,
  passwordEnabled,
  onPasswordEnabledChange,
  password,
  onPasswordChange,
  forcePassword = false,
  disabled = false,
}: ShareOptionsProps) {
  const { t } = useTranslation();
  const id = useId();
  const limitLabel = useLimitLabel(kind);

  return (
    <div className="space-y-4">
      <Row label={t("share.expires")} labelId={`${id}-expiry`}>
        <ToggleGroup
          type="single"
          value={String(expireSec)}
          // Radix lets a single toggle be switched off. An expiry is always required.
          onValueChange={(v) => v && onExpireChange(parseInt(v, 10))}
          aria-labelledby={`${id}-expiry`}
          disabled={disabled}
        >
          {expireOptions.map((sec) => (
            <ToggleGroupItem key={sec} value={String(sec)}>
              {formatDuration(sec)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>

      <Row label={t(kind === "file" ? "upload.downloads" : "note.maxViews")} labelId={`${id}-limit`}>
        <div role="group" aria-labelledby={`${id}-limit`}>
          <Stepper
            options={limitOptions}
            value={limit}
            onChange={onLimitChange}
            format={(v) => limitLabel(v)}
            decreaseLabel={t("share.fewer")}
            increaseLabel={t("share.more")}
            disabled={disabled}
          />
        </div>
      </Row>

      <Row
        labelId={`${id}-password`}
        label={
          <Label htmlFor={`${id}-password-toggle`} className="flex items-center gap-2 text-[13px]">
            <Lock className="h-3.5 w-3.5" />
            {t("share.password")}
          </Label>
        }
      >
        <div className="flex items-center gap-3">
          {!forcePassword && (
            <Switch
              id={`${id}-password-toggle`}
              checked={passwordEnabled}
              onCheckedChange={onPasswordEnabledChange}
              disabled={disabled}
            />
          )}
          <span className="text-[13px] text-muted-foreground">
            {forcePassword
              ? t("upload.passwordRequired")
              : passwordEnabled
                ? t("share.passwordHint")
                : t("share.passwordOff")}
          </span>
        </div>
      </Row>

      {passwordEnabled && (
        <div className="sm:pl-40">
          <PasswordProtectionInput
            value={password}
            onChange={onPasswordChange}
            placeholder={t(forcePassword ? "upload.passwordPlaceholderRequired" : "upload.passwordPlaceholder")}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
