import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareFooterProps {
  label: string;
  busyLabel?: string;
  icon: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
}

/** The foot of a share form: the button that encrypts and sends it. */
export function ShareFooter({
  label,
  busyLabel,
  icon,
  busy = false,
  disabled = false,
  onSubmit,
}: ShareFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-end px-2 sm:px-3">
      <Button size="lg" onClick={onSubmit} disabled={disabled || busy} className="w-full sm:w-auto">
        {busy ? <Loader2 className="animate-spin" /> : icon}
        {busy && busyLabel ? busyLabel : label}
      </Button>
      <span className="sr-only" aria-live="polite">{busy ? (busyLabel ?? t("common.loading")) : ""}</span>
    </div>
  );
}
