import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Stepper } from "@/components/ui/stepper";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export function Row({ label, labelId, children }: { label: ReactNode; labelId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span id={labelId} className="flex items-center gap-2 text-[13px] font-medium sm:w-36 sm:shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

interface ExpiryPickerProps {
  options: number[];
  value: number;
  onChange: (value: number) => void;
  labelId: string;
  disabled: boolean;
}

/**
 * The expiry times as chips while they fit on one line, as a dropdown once they would wrap.
 * An invisible copy of the chips measures that line, so the switch follows the width of the
 * row, on a phone as on a wide screen.
 */
export function ExpiryPicker({ options, value, onChange, labelId, disabled }: ExpiryPickerProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const check = () => setFits(measure.scrollWidth <= row.clientWidth);
    check();
    // The copy changes width when the web font arrives, the row when the window resizes.
    const observer = new ResizeObserver(check);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [options]);

  return (
    <div ref={rowRef} className="relative min-w-0 sm:flex-1">
      <div ref={measureRef} aria-hidden="true" className="invisible absolute left-0 top-0 w-max">
        <ToggleGroup type="single" className="flex-nowrap">
          {options.map((sec) => (
            <ToggleGroupItem key={sec} value={String(sec)}>
              {formatDuration(sec)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {fits ? (
        <ToggleGroup
          type="single"
          value={String(value)}
          // Radix lets a single toggle be switched off. An expiry is always required.
          onValueChange={(v) => v && onChange(parseInt(v, 10))}
          aria-labelledby={labelId}
          disabled={disabled}
        >
          {options.map((sec) => (
            <ToggleGroupItem key={sec} value={String(sec)}>
              {formatDuration(sec)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <Select value={String(value)} onValueChange={(v) => onChange(parseInt(v, 10))} disabled={disabled}>
          <SelectTrigger className="w-44" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((sec) => (
              <SelectItem key={sec} value={String(sec)}>
                {formatDuration(sec)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * Expiry, download or view limit and password for a share. Expiry times are chips, or a
 * dropdown when an operator lists too many for one line. Limits use a stepper.
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
        <ExpiryPicker
          options={expireOptions}
          value={expireSec}
          onChange={onExpireChange}
          labelId={`${id}-expiry`}
          disabled={disabled}
        />
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
