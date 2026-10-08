import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLimitLabel, type ShareKind } from "@/components/ShareOptions";
import { formatDuration } from "@/lib/utils";

interface ShareFooterProps {
  kind: ShareKind;
  expireSec: number;
  limit: number;
  label: string;
  busyLabel?: string;
  icon: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
}

/**
 * The bar at the foot of a share form: one sentence that says when the share is gone,
 * and the button that encrypts and sends it.
 */
export function ShareFooter({
  kind,
  expireSec,
  limit,
  label,
  busyLabel,
  icon,
  busy = false,
  disabled = false,
  onSubmit,
}: ShareFooterProps) {
  const { t } = useTranslation();
  const limitLabel = useLimitLabel(kind);
  const strong = <strong className="font-semibold text-foreground" />;
  // A note without a view limit only expires by time.
  const unlimited = kind === "note" && limit === 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-well p-3 sm:flex-row sm:items-center sm:pl-5">
      <p className="flex-1 text-[13px] leading-snug text-muted-foreground">
        {unlimited ? (
          <Trans i18nKey="share.summary" values={{ expiry: formatDuration(expireSec) }} components={{ b: strong }} />
        ) : (
          <Trans
            i18nKey="share.summaryLimit"
            values={{ expiry: formatDuration(expireSec), limit: limitLabel(limit, true) }}
            components={{ b: strong }}
          />
        )}
      </p>
      <Button size="lg" onClick={onSubmit} disabled={disabled || busy} className="w-full sm:w-auto">
        {busy ? <Loader2 className="animate-spin" /> : icon}
        {busy && busyLabel ? busyLabel : label}
      </Button>
      <span className="sr-only" aria-live="polite">{busy ? (busyLabel ?? t("common.loading")) : ""}</span>
    </div>
  );
}
