import { useId } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Clock, Download, Eye, Lock } from "lucide-react";
import { OptionPill, SwitchPill } from "@/components/OptionPill";
import { PasswordProtectionInput } from "@/components/PasswordProtectionInput";
import { formatDuration } from "@/lib/utils";
import { MIN_PASSWORD_LENGTH, meetsPasswordMinimum } from "@skysend/crypto";

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

/** How a limit reads, for the defaults and the summary of a share. */
export function useLimitLabel(kind: ShareKind) {
  const { t } = useTranslation();
  return (value: number, short = false) => {
    if (kind === "file") return t("share.downloads", { count: value });
    if (value === 0) return t("note.unlimited");
    if (value === 1 && !short) return t("note.burnAfterReading");
    return t("share.views", { count: value });
  };
}

/**
 * How the chips of a view limit read: unlimited as ∞ with its name for a screen reader, and a
 * hint for what 1 and ∞ do, as far as the server offers them.
 */
export function useViewChips(options: readonly number[]) {
  const { t } = useTranslation();
  const burns = options.includes(1);
  const unlimited = options.includes(0);
  return {
    format: (count: number) => (count === 0 ? "∞" : String(count)),
    optionLabel: (count: number) => (count === 0 ? t("note.unlimited") : undefined),
    hint:
      burns && unlimited
        ? t("share.pick.viewsHint")
        : burns
          ? t("share.pick.burnHint")
          : unlimited
            ? t("share.pick.unlimitedHint")
            : undefined,
  };
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
  const chips = useViewChips(limitOptions);

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
          hint={file ? undefined : chips.hint}
          options={limitOptions}
          value={limit}
          onChange={onLimitChange}
          format={file ? String : chips.format}
          optionLabel={file ? undefined : chips.optionLabel}
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
          {password !== "" && !meetsPasswordMinimum(password) ? (
            <p className="text-xs text-destructive-text">
              {t("share.passwordTooShort", { count: MIN_PASSWORD_LENGTH })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("share.passwordHint")}</p>
          )}
          {forcePassword && <p className="text-xs text-muted-foreground">{t("share.passwordForced")}</p>}
        </div>
      )}
    </section>
  );
}
