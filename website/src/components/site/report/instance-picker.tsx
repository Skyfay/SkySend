import { ArrowUpRight } from "lucide-react";
import { CountryFlag } from "@/components/site/country-flag";
import { countryName } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { getHostname, hasAbuseSupport, type ReportInstance } from "@/lib/report";
import { INTL_LOCALE } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";

/**
 * The instances a report can go to, as native radio buttons, so arrow keys and
 * screen readers work as they should. An instance without an abuse contact
 * stays unselectable and links to its operator instead, so a report never fails
 * only at the end.
 */
export function InstancePicker({
  instances,
  selectedHostname,
  onSelect,
}: {
  instances: ReportInstance[];
  selectedHostname: string | null;
  onSelect: (hostname: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t("report.instanceLegend")}</legend>
      {instances.map((instance) => {
        const hostname = getHostname(instance.url) ?? instance.name;
        const reportable = hasAbuseSupport(instance);
        const selected = selectedHostname === hostname;

        return (
          <div
            key={hostname}
            className={cn(
              "flex min-h-[60px] items-center gap-3 rounded-xl border pr-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60",
              selected ? "border-tone-green/55 bg-tone-green/8" : "border-border bg-surface",
              !reportable && "border-dashed"
            )}
          >
            <label
              className={cn(
                "flex min-w-0 grow items-center gap-3 py-2.5 pl-2.5",
                reportable ? "cursor-pointer" : "cursor-not-allowed"
              )}
            >
              <input
                type="radio"
                name="instance"
                value={hostname}
                checked={selected}
                disabled={!reportable}
                onChange={() => onSelect(hostname)}
                className="sr-only"
              />
              <CountryFlag country={instance.country} emoji={instance.flag} size={36} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold">{instance.name}</span>
                <span className="text-xs text-muted-foreground">
                  {reportable
                    ? countryName(instance.country, instance.flag, INTL_LOCALE[locale])
                    : t("report.noReportsHere")}
                </span>
              </span>
              {reportable && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-tone-green" : "border-input"
                  )}
                >
                  {selected && <span className="size-2 rounded-full bg-tone-green" />}
                </span>
              )}
            </label>
            {!reportable && instance.contact?.url && (
              <a
                href={instance.contact.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t("report.contactLabel", { name: instance.name })}
                className="btn-chip flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium"
              >
                {instance.contact.label || t("report.contact")}
                <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
