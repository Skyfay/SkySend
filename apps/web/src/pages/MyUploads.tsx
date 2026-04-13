import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Inbox, File, FileText, Layers, KeyRound, Code, Heading, Terminal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCard } from "@/components/UploadCard";
import { NoteCard } from "@/components/NoteCard";
import { useUploadHistory } from "@/hooks/useUploadHistory";
import { useNoteHistory } from "@/hooks/useNoteHistory";
import { useServerConfig } from "@/hooks/useServerConfig";
import type { NoteContentType } from "@skysend/crypto";
import { toast } from "@/hooks/useToast";

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

export function MyUploadsPage() {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const { uploads, loading: uploadsLoading, deleteUpload } = useUploadHistory();
  const { notes, loading: notesLoading, deleteNote } = useNoteHistory();
  const [filter, setFilter] = useState<Filter>("all");

  const fileEnabled = config?.enabledServices.includes("file") ?? true;
  const noteEnabled = config?.enabledServices.includes("note") ?? true;

  const loading = uploadsLoading || notesLoading;

  const handleDeleteUpload = async (id: string, ownerToken: string) => {
    try {
      await deleteUpload(id, ownerToken);
      toast({ title: t("myUploads.deleteSuccess"), variant: "success" });
    } catch {
      toast({
        title: t("myUploads.deleteFailed"),
        variant: "destructive",
      });
    }
  };

  const handleDeleteNote = async (id: string, ownerToken: string) => {
    try {
      await deleteNote(id, ownerToken);
      toast({ title: t("myUploads.deleteNoteSuccess"), variant: "success" });
    } catch {
      toast({
        title: t("myUploads.deleteNoteFailed"),
        variant: "destructive",
      });
    }
  };

  // Build combined list sorted by createdAt
  const isNoteFilter = filter.startsWith("notes-");
  const noteContentFilter: NoteContentType | null =
    filter.startsWith("notes-") ? (filter.replace("notes-", "") as NoteContentType) : null;

  const items: Array<
    | { type: "upload"; data: (typeof uploads)[number] }
    | { type: "note"; data: (typeof notes)[number] }
  > = [];

  if (filter === "all" || filter === "files") {
    for (const u of uploads) items.push({ type: "upload", data: u });
  }
  if (filter === "all" || isNoteFilter) {
    for (const n of notes) {
      if (noteContentFilter && n.contentType !== noteContentFilter) continue;
      items.push({ type: "note", data: n });
    }
  }

  items.sort(
    (a, b) =>
      new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime(),
  );

  const isEmpty = items.length === 0 && !loading;

  // Build content type counts for note sub-filters
  const noteTypeCounts: Record<string, number> = {};
  for (const n of notes) {
    noteTypeCounts[n.contentType] = (noteTypeCounts[n.contentType] ?? 0) + 1;
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

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
        <FolderOpen className="h-7 w-7 text-primary" />
        {t("myUploads.title")}
      </h1>

      {/* Filter tabs */}
      {(uploads.length > 0 || notes.length > 0) && (
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/50 p-1">
          {filters.map((f) => {
            const Icon = FILTER_ICONS[f];
            const count = getFilterCount(f);
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t(`myUploads.filter.${f}`)}</span>
                <span className="ml-0.5 text-xs text-muted-foreground">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-8 w-8 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
          <Inbox className="h-12 w-12" />
          <div>
            <p className="text-lg font-medium">{t("myUploads.empty")}</p>
            <p className="text-sm">{t("myUploads.emptyHint")}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) =>
            item.type === "upload" ? (
              <UploadCard
                key={`upload-${item.data.id}`}
                upload={item.data}
                onDelete={handleDeleteUpload}
              />
            ) : (
              <NoteCard
                key={`note-${item.data.id}`}
                note={item.data}
                onDelete={handleDeleteNote}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
