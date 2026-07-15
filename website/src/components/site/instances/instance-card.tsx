import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatCount, formatDuration } from "@/lib/format";
import { isOfficialInstance, type Instance } from "@/lib/instances";

function serviceLabel(services: string[]): string | null {
  if (services.includes("file") && services.includes("note")) return "Files & Notes";
  if (services.includes("file")) return "Files only";
  if (services.includes("note")) return "Notes only";
  return null;
}

export function InstanceCard({ instance }: { instance: Instance }) {
  const official = isOfficialInstance(instance.url);
  const services = serviceLabel(instance.enabledServices);

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xl" aria-hidden="true">
            {instance.flag}
          </span>
          <a
            href={instance.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:underline"
          >
            {instance.name}
          </a>
          {instance.online && instance.version ? (
            <Badge variant="secondary">v{instance.version}</Badge>
          ) : (
            <Badge variant="destructive">offline</Badge>
          )}
          <span className="ml-auto" />
          <Badge variant={official ? "default" : "outline"}>
            {official ? "Official" : "Community"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {instance.country}
          <span className="mx-1.5">&middot;</span>
          <a href={instance.contact.url} target="_blank" rel="noreferrer" className="hover:underline">
            {instance.contact.label}
          </a>
        </p>
      </CardHeader>

      {services && (
        <CardContent className="-mt-2">
          <Badge variant="outline">{services}</Badge>
        </CardContent>
      )}

      {instance.enabledServices.includes("file") && (
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Max Size", value: formatBytes(instance.fileMaxSize) },
            { label: "Files / Upload", value: formatCount(instance.fileMaxFilesPerUpload) },
            {
              label: `Quota${instance.fileUploadQuotaBytes !== 0 ? ` / ${instance.fileUploadQuotaWindow ? formatDuration(instance.fileUploadQuotaWindow) : "24h"}` : ""}`,
              value: formatBytes(instance.fileUploadQuotaBytes, true),
            },
            { label: "Max Expiry", value: formatDuration(instance.fileMaxExpiry) },
            { label: "Max Downloads", value: formatCount(instance.fileMaxDownloads) },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center rounded-lg border border-border bg-background/60 px-2 py-2 text-center"
            >
              <span className="text-sm font-bold">{stat.value}</span>
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </CardContent>
      )}

      {instance.enabledServices.includes("note") && (
        <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground/80">Notes:</span>
          <span>{formatBytes(instance.noteMaxSize)} max</span>
          <span>&middot;</span>
          <span>{formatDuration(instance.noteMaxExpiry)} expiry</span>
          <span>&middot;</span>
          <span>{formatCount(instance.noteMaxViews)} views</span>
        </CardContent>
      )}
    </Card>
  );
}
