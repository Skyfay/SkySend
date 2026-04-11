import { useTranslation } from "react-i18next";
import { HardDrive } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { QuotaStatus } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

function formatTimeRemaining(resetsAt: string): string {
  const remaining = Math.max(0, new Date(resetsAt).getTime() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

interface QuotaBarProps {
  quota: QuotaStatus | null;
}

export function QuotaBar({ quota }: QuotaBarProps) {
  const { t } = useTranslation();

  if (!quota || !quota.enabled) return null;

  const percentage = Math.min(100, Math.round((quota.used / quota.limit) * 100));
  const exceeded = quota.used >= quota.limit;

  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-card-foreground">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <HardDrive className="h-4 w-4" />
          {t("quota.title")}
        </span>
        <span className="text-muted-foreground">
          {formatBytes(quota.used)} / {formatBytes(quota.limit)}
        </span>
      </div>
      <Progress
        value={percentage}
        className={`mt-2 h-2 ${exceeded ? "[&>div]:bg-destructive" : ""}`}
      />
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        {exceeded ? (
          <span className="text-destructive-foreground font-medium">
            {t("quota.exceeded")}
          </span>
        ) : (
          <span>
            {t("quota.remaining", { size: formatBytes(quota.remaining) })}
          </span>
        )}
        {quota.resetsAt && (
          <span>{t("quota.resetsIn", { time: formatTimeRemaining(quota.resetsAt) })}</span>
        )}
      </div>
    </div>
  );
}
