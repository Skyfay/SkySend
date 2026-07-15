import { ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHostname, hasAbuseSupport, type ReportInstance } from "@/lib/report";

export function InstancePicker({
  instances,
  selectedHostname,
  onSelect,
}: {
  instances: ReportInstance[];
  selectedHostname: string | null;
  onSelect: (hostname: string) => void;
}) {
  return (
    <div className="space-y-2">
      {instances.map((instance) => {
        const hostname = getHostname(instance.url) ?? instance.name;
        const abuseSupported = hasAbuseSupport(instance);
        const selected = selectedHostname === hostname;

        return (
          <button
            key={hostname}
            type="button"
            onClick={() => onSelect(hostname)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 bg-card/50 p-3 text-left transition-all",
              selected
                ? abuseSupported
                  ? "border-primary bg-primary/5"
                  : "border-amber-500 bg-amber-500/5"
                : "border-transparent hover:border-primary/30"
            )}
          >
            <span className="shrink-0 text-xl" aria-hidden="true">
              {instance.flag}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{instance.name}</span>
              <span className="block text-xs text-muted-foreground">{instance.country}</span>
            </span>
            {abuseSupported ? (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Info className="size-4 shrink-0 text-amber-500" />
            )}
          </button>
        );
      })}
    </div>
  );
}
