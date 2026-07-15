import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes, formatCount, formatDuration } from "@/lib/format";
import { getFlagClass } from "@/lib/countries";
import { isOfficialInstance, type Instance } from "@/lib/instances";

export function InstanceCard({ instance }: { instance: Instance }) {
  const official = isOfficialInstance(instance.url);
  const flagClass = getFlagClass(instance.country);
  const hasFiles = instance.enabledServices.includes("file");
  const hasNotes = instance.enabledServices.includes("note");

  const fileStats = [
    { label: "Max Size", value: formatBytes(instance.fileMaxSize) },
    { label: "Files / Upload", value: formatCount(instance.fileMaxFilesPerUpload) },
    {
      label: `Quota${
        instance.fileUploadQuotaBytes !== 0
          ? ` / ${instance.fileUploadQuotaWindow ? formatDuration(instance.fileUploadQuotaWindow) : "24h"}`
          : ""
      }`,
      value: formatBytes(instance.fileUploadQuotaBytes, true),
    },
    { label: "Max Expiry", value: formatDuration(instance.fileMaxExpiry) },
    { label: "Max Downloads", value: formatCount(instance.fileMaxDownloads) },
  ];

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card/50 p-6 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {flagClass ? (
            <span className={cn("fi", flagClass, "text-2xl")} />
          ) : (
            <span className="text-2xl" aria-hidden="true">
              {instance.flag}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={instance.url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-semibold hover:underline"
            >
              {instance.name}
            </a>
            {instance.version && <Badge variant="secondary">v{instance.version}</Badge>}
            <Badge variant={official ? "default" : "outline"}>
              {official ? "Official" : "Community"}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {instance.country}
            <span className="mx-1.5">&middot;</span>
            <a
              href={instance.contact.url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {instance.contact.label}
            </a>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
            instance.online
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              instance.online ? "animate-pulse bg-success" : "bg-destructive"
            )}
          />
          {instance.online ? "Online" : "Offline"}
        </span>
        {hasFiles && <Badge variant="outline">Files</Badge>}
        {hasNotes && <Badge variant="outline">Notes</Badge>}
      </div>

      {hasFiles && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {fileStats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center rounded-lg bg-muted/50 px-2 py-2.5 text-center"
            >
              <span className="text-sm font-bold">{stat.value}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {hasNotes && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground/80">Notes:</span>
          <span>{formatBytes(instance.noteMaxSize)} max</span>
          <span>&middot;</span>
          <span>{formatDuration(instance.noteMaxExpiry)} expiry</span>
          <span>&middot;</span>
          <span>{formatCount(instance.noteMaxViews)} views</span>
        </p>
      )}

      <a
        href={instance.url}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "default" }), "mt-5 w-full")}
      >
        Open Instance
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
