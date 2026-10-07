import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Clock, Download, Eye, Lock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OptionPill, SwitchPill } from "@/components/OptionPill";
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

/** How a limit reads, for the steppers of the defaults. */
export function useLimitLabel(kind: ShareKind) {
  const { t } = useTranslation();
  return (value: number) => {
    if (kind === "file") return t("share.downloads", { count: value });
    if (value === 0) return t("note.unlimited");
    if (value === 1) return t("note.burnAfterReading");
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
 * Expiry, download or view limit and password for a share, as pills that show their value
 * and open their options on a click.
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
  const file = kind === "file";
  // Trans parses its values as markup, so only numbers and what is formatted from them go
  // in here.
  const pill = (key: string, values: Record<string, string | number> = {}) => (
    <Trans i18nKey={key} values={values} components={{ b: <strong className="font-semibold" /> }} />
  );
  // A note without a view limit only expires by time, one with a single view burns.
  const limitLabel = file
    ? pill("share.pill.downloads", { count: limit })
    : limit === 0
      ? pill("share.pill.unlimitedViews")
      : limit === 1
        ? pill("share.pill.burnAfterReading")
        : pill("share.pill.views", { count: limit });
  const burns = limitOptions.includes(1);
  const unlimited = limitOptions.includes(0);
  const viewsHint =
    burns && unlimited
      ? t("share.pick.viewsHint")
      : burns
        ? t("share.pick.burnHint")
        : unlimited
          ? t("share.pick.unlimitedHint")
          : undefined;

  return (
    <section className="space-y-3" aria-labelledby={`${id}-settings`}>
      <h3 id={`${id}-settings`} className="text-[13px] font-medium">
        {t("share.settings")}
      </h3>
      <div className="flex flex-wrap gap-2">
        <OptionPill
          icon={Clock}
          label={pill("share.pill.expiry", { time: formatDuration(expireSec) })}
          title={t("share.pick.expiry")}
          options={expireOptions}
          value={expireSec}
          onChange={onExpireChange}
          format={formatDuration}
          columns={3}
          disabled={disabled}
        />
        <OptionPill
          icon={file ? Download : Eye}
          label={limitLabel}
          title={file ? t("share.pick.downloads") : t("share.pick.views")}
          hint={file ? undefined : viewsHint}
          options={limitOptions}
          value={limit}
          onChange={onLimitChange}
          format={(count) => (count === 0 ? "\u221e" : String(count))}
          optionLabel={(count) => (count === 0 ? t("note.unlimited") : undefined)}
          columns={4}
          disabled={disabled}
        />
        {/* A forced password stays on. */}
        <SwitchPill
          icon={Lock}
          label={t("share.password")}
          checked={passwordEnabled}
          onCheckedChange={onPasswordEnabledChange}
          disabled={disabled || forcePassword}
        />
      </div>

      {passwordEnabled && (
        <div className="space-y-1.5">
          <PasswordProtectionInput
            value={password}
            onChange={onPasswordChange}
            placeholder={t(forcePassword ? "upload.passwordPlaceholderRequired" : "upload.passwordPlaceholder")}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">{t("share.passwordHint")}</p>
          {forcePassword && <p className="text-xs text-muted-foreground">{t("share.passwordForced")}</p>}
        </div>
      )}
    </section>
  );
}
