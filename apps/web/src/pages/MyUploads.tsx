import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookmarkPlus,
  Inbox,
  File,
  FileText,
  Layers,
  KeyRound,
  Code,
  Heading,
  Share2,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequestList } from "@/components/RequestList";
import { TemplateList } from "@/components/TemplateList";
import { UploadCard } from "@/components/UploadCard";
import { NoteCard } from "@/components/NoteCard";
import { useUploadHistory } from "@/hooks/useUploadHistory";
import { useNoteHistory } from "@/hooks/useNoteHistory";
import { useServerConfig } from "@/hooks/useServerConfig";
import { storedNoteKinds, type NoteKindKey } from "@/lib/note-editor";
import { peekLinkImport, setLinkImport } from "@/lib/request-templates";
import { subscribeUnseen, unseenTotal } from "@/lib/unseen-uploads";
import { toast } from "sonner";

type Filter = "all" | "files" | "notes-text" | "notes-password" | "notes-code" | "notes-markdown" | "notes-sshkey";

const FILTER_ICONS: Record<Filter, React.ComponentType<{ className?: string }>> = {
  all: Layers,
  files: File,
  "notes-text": FileText,
  "notes-password": KeyRound,
  "notes-code": Code,
  "notes-markdown": Heading,
  "notes-sshkey": Terminal,
};

/**
 * My Links: everything this browser shared, the file requests it made and the templates it
 * keeps for them, each in its own tab when the instance offers requests.
 */
export function MyUploadsPage() {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const [params, setParams] = useSearchParams();
  // The export a templates link brought, to import right away.
  const [linkImport, setLinkImportShown] = useState(() => peekLinkImport() ?? undefined);
  // Leaving the page drops it, so it never comes back on a later visit.
  useEffect(() => () => setLinkImport(null), []);
  const unseen = useSyncExternalStore(subscribeUnseen, unseenTotal);
  const {
    uploads,
    loading: uploadsLoading,
    deleteUpload,
    renameUpload,
  } = useUploadHistory();
  const { notes, loading: notesLoading, deleteNote } = useNoteHistory();
  const [filter, setFilter] = useState<Filter>("all");

  const fileEnabled = config?.enabledServices.includes("file") ?? true;
  const noteEnabled = config?.enabledServices.includes("note") ?? true;

  const loading = uploadsLoading || notesLoading;

  const handleDeleteUpload = async (id: string, ownerToken: string) => {
    try {
      await deleteUpload(id, ownerToken);
      toast.success(t("myUploads.deleteSuccess"));
    } catch {
      toast.error(t("myUploads.deleteFailed"));
    }
  };

  const handleRenameUpload = async (id: string, name: string) => {
    try {
      await renameUpload(id, name);
    } catch {
      toast.error(t("myUploads.renameFailed"));
    }
  };

  const handleDeleteNote = async (id: string, ownerToken: string) => {
    try {
      await deleteNote(id, ownerToken);
      toast.success(t("myUploads.deleteNoteSuccess"));
    } catch {
      toast.error(t("myUploads.deleteNoteFailed"));
    }
  };

  // Build combined list sorted by createdAt
  const isNoteFilter = filter.startsWith("notes-");
  const noteContentFilter: NoteKindKey | null =
    filter.startsWith("notes-") ? (filter.replace("notes-", "") as NoteKindKey) : null;

  const items: Array<
    | { type: "upload"; data: (typeof uploads)[number] }
    | { type: "note"; data: (typeof notes)[number] }
  > = [];

  if (filter === "all" || filter === "files") {
    for (const u of uploads) items.push({ type: "upload", data: u });
  }
  if (filter === "all" || isNoteFilter) {
    for (const n of notes) {
      if (noteContentFilter && !storedNoteKinds(n).includes(noteContentFilter)) continue;
      items.push({ type: "note", data: n });
    }
  }

  items.sort(
    (a, b) =>
      new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime(),
  );

  const isEmpty = items.length === 0 && !loading;

  // How many notes hold each kind. A note made of several kinds counts for each of them.
  const noteTypeCounts: Record<string, number> = {};
  for (const n of notes) {
    for (const kind of storedNoteKinds(n)) noteTypeCounts[kind] = (noteTypeCounts[kind] ?? 0) + 1;
  }

  const noteSubFilters: Filter[] = (
    ["text", "password", "code", "markdown", "sshkey"] as const
  )
    .filter((ct) => (noteTypeCounts[ct] ?? 0) > 0)
    .map((ct) => `notes-${ct}` as Filter);

  const filters: Filter[] = [
    ...(fileEnabled && noteEnabled ? ["all" as const] : []),
    ...(fileEnabled && uploads.length > 0 ? ["files" as const] : []),
    ...(noteEnabled ? noteSubFilters : []),
  ];

  const getFilterCount = (f: Filter): number => {
    if (f === "all") return uploads.length + notes.length;
    if (f === "files") return uploads.length;
    const ct = f.replace("notes-", "");
    return noteTypeCounts[ct] ?? 0;
  };

  // The same rule as the navigation: an instance with only file requests shares nothing.
  const sharing = !config || config.enabledServices.length > 0;
  const requests = config?.fileRequestsEnabled ?? false;
  const tab = params.get("tab");
  const firstSection = sharing ? "shared" : "requests";
  const section =
    requests && (tab === "requests" || tab === "templates") ? tab : firstSection;
  const intro =
    sharing && requests
      ? t("myUploads.intro")
      : sharing
        ? t("myUploads.emptyHint")
        : t("requests.localHint");

  const shared = (
    <>
      {(uploads.length > 0 || notes.length > 0) && (
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label={t("share.filter")}
        >
          {filters.map((f) => {
            const Icon = FILTER_ICONS[f];
            return (
              <ToggleGroupItem key={f} value={f}>
                <Icon />
                {t(`myUploads.filter.${f}`)}
                <span className="text-xs tabular-nums opacity-70">{getFilterCount(f)}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      )}

      {loading ? (
        <Card className="overflow-hidden" aria-busy="true">
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-24 rounded-xl" />
              </li>
            ))}
          </ul>
        </Card>
      ) : isEmpty ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
            <Inbox className="h-6 w-6" />
          </span>
          <p className="text-lg font-semibold tracking-tight">{t("myUploads.empty")}</p>
          <Button asChild>
            <Link to="/">
              {t("share.goneAction")}
              <ArrowRight />
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border" role="list">
            {items.map((item) =>
              item.type === "upload" ? (
                <UploadCard
                  key={`upload-${item.data.id}`}
                  upload={item.data}
                  onDelete={handleDeleteUpload}
                  onRename={handleRenameUpload}
                />
              ) : (
                <NoteCard
                  key={`note-${item.data.id}`}
                  note={item.data}
                  onDelete={handleDeleteNote}
                />
              ),
            )}
          </ul>
        </Card>
      )}
    </>
  );

  let body;
  if (requests) {
    body = (
      <Tabs
        value={section}
        onValueChange={(v) => setParams(v === firstSection ? {} : { tab: v }, { replace: true })}
        className="space-y-6"
      >
        <TabsList aria-label={t("myUploads.title")}>
          {sharing && (
            <TabsTrigger value="shared">
              <Share2 />
              {t("myUploads.tabShared")}
            </TabsTrigger>
          )}
          <TabsTrigger value="requests">
            <Inbox />
            {t("myUploads.tabRequests")}
            {unseen > 0 && (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <span className="sr-only">{t("nav.requestsUnseen")}</span>
              </>
            )}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <BookmarkPlus />
            {t("myUploads.tabTemplates")}
          </TabsTrigger>
        </TabsList>
        {sharing && (
          <TabsContent value="shared" className="space-y-6">
            {shared}
          </TabsContent>
        )}
        <TabsContent value="requests">
          {/* Without sharing, the intro says where the list lives already. */}
          <RequestList hint={sharing} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplateList
            linkImport={linkImport}
            onLinkImportDone={() => {
              setLinkImport(null);
              setLinkImportShown(undefined);
            }}
          />
        </TabsContent>
      </Tabs>
    );
  } else {
    body = shared;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
        >
          {t("myUploads.title")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{intro}</p>
      </header>
      {body}
    </div>
  );
}
