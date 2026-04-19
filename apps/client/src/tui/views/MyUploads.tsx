import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { fetchInfo, fetchNoteInfo, deleteUpload, deleteNote } from "../../lib/api.js";
import {
  getUploads, getNotes, removeUpload, removeNote, cleanupExpired,
  type StoredUpload, type StoredNote,
} from "../../lib/history.js";
import { ApiError } from "../../lib/errors.js";
import { formatBytes } from "../../lib/progress.js";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";
import { QRCodeDisplay } from "../components/QRCodeDisplay.js";

type Phase = "list" | "upload-detail" | "note-detail" | "confirm-delete";

interface MyUploadsViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

interface LiveUploadInfo {
  downloadCount: number;
  maxDownloads: number;
  expiresAt: string;
  gone: boolean;
}

interface LiveNoteInfo {
  viewCount: number;
  maxViews: number;
  expiresAt: string;
  gone: boolean;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MyUploadsView({ appState, onBack }: MyUploadsViewProps): React.ReactElement {
  const accent = useAccent();
  const { server } = appState;
  const [phase, setPhase] = useState<Phase>("list");
  const [selectedUpload, setSelectedUpload] = useState<StoredUpload | null>(null);
  const [selectedNote, setSelectedNote] = useState<StoredNote | null>(null);
  const [liveUpload, setLiveUpload] = useState<LiveUploadInfo | null>(null);
  const [liveNote, setLiveNote] = useState<LiveNoteInfo | null>(null);
  const [now] = useState(() => Date.now());
  const [cleanupMsg] = useState(() => {
    const cleaned = cleanupExpired();
    const parts: string[] = [];
    if (cleaned.removedUploads > 0) parts.push(`${cleaned.removedUploads} upload(s)`);
    if (cleaned.removedNotes > 0) parts.push(`${cleaned.removedNotes} note(s)`);
    return parts.length > 0 ? `Cleaned ${parts.join(" and ")} (expired)` : "";
  });
  const [, setRefreshKey] = useState(0);
  const [showQR, setShowQR] = useState(false);

  const uploads = getUploads().filter((u) => u.server === server);
  const notes = getNotes().filter((n) => n.server === server);

  const isEmpty = uploads.length === 0 && notes.length === 0;

  useInput((_input, key) => {
    if (key.escape) onBack();
  }, { isActive: phase === "list" && isEmpty });

  const showUpload = useCallback(async (upload: StoredUpload) => {
    setSelectedUpload(upload);
    setLiveUpload(null);
    setPhase("upload-detail");
    try {
      const info = await fetchInfo(upload.server, upload.id);
      setLiveUpload({
        downloadCount: info.downloadCount,
        maxDownloads: info.maxDownloads,
        expiresAt: info.expiresAt,
        gone: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setLiveUpload({ downloadCount: 0, maxDownloads: 0, expiresAt: "", gone: true });
      }
    }
  }, []);

  const showNote = useCallback(async (note: StoredNote) => {
    setSelectedNote(note);
    setLiveNote(null);
    setPhase("note-detail");
    try {
      const info = await fetchNoteInfo(note.server, note.id);
      setLiveNote({
        viewCount: info.viewCount,
        maxViews: info.maxViews,
        expiresAt: info.expiresAt,
        gone: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setLiveNote({ viewCount: 0, maxViews: 0, expiresAt: "", gone: true });
      }
    }
  }, []);

  // List view
  if (phase === "list") {
    if (uploads.length === 0 && notes.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {cleanupMsg && <Text dimColor>{cleanupMsg}</Text>}
          <Text>No uploads or notes in history for this server.</Text>
          <Box marginTop={1}><Text dimColor>Press Esc to go back</Text></Box>
        </Box>
      );
    }

    const items: Array<SelectItem<string>> = [];
    for (const u of uploads) {
      const names = u.fileNames.join(", ");
      items.push({
        label: `[File] ${names}`,
        value: `upload:${u.id}`,
        description: `${formatBytes(u.totalSize)} - ${formatAge(u.createdAt)}`,
      });
    }
    for (const n of notes) {
      items.push({
        label: `[Note] ${n.contentType}`,
        value: `note:${n.id}`,
        description: formatAge(n.createdAt),
      });
    }

    return (
      <Box flexDirection="column">
        {cleanupMsg && <Box paddingX={1}><Text dimColor>{cleanupMsg}</Text></Box>}
        <SelectList
          items={items}
          title="My uploads"
          onSelect={(val) => {
            const [type, id] = val.split(":") as [string, string];
            if (type === "upload") {
              const upload = uploads.find((u) => u.id === id);
              if (upload) void showUpload(upload);
            } else {
              const note = notes.find((n) => n.id === id);
              if (note) void showNote(note);
            }
          }}
          onCancel={onBack}
        />
      </Box>
    );
  }

  // Upload detail
  if (phase === "upload-detail" && selectedUpload) {
    const u = selectedUpload;
    const gone = liveUpload?.gone;
    const items: Array<SelectItem<string>> = gone
      ? [
          { label: "Remove from history", value: "remove" },
          { label: "Back", value: "back" },
        ]
      : [
          { label: "Copy URL (print)", value: "url" },
          { label: showQR ? "Hide QR code" : "Show QR code", value: "qr" },
          { label: "Delete from server", value: "delete" },
          { label: "Remove from history", value: "remove" },
          { label: "Back", value: "back" },
        ];

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}><Text bold>Upload detail</Text></Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>ID:        </Text>{u.id}</Text>
          <Text><Text dimColor>Files:     </Text>{u.fileNames.join(", ")}</Text>
          <Text><Text dimColor>Size:      </Text>{formatBytes(u.totalSize)}</Text>
          <Text><Text dimColor>Password:  </Text>{u.hasPassword ? "yes" : "no"}</Text>
          <Text><Text dimColor>Created:   </Text>{formatAge(u.createdAt)}</Text>
          {liveUpload && !gone && (
            <>
              <Text>
                <Text dimColor>Downloads: </Text>
                {liveUpload.downloadCount} / {liveUpload.maxDownloads}
                <Text dimColor> ({liveUpload.maxDownloads - liveUpload.downloadCount} remaining)</Text>
              </Text>
              <Text>
                <Text dimColor>Expires:   </Text>
                {formatTimeRemaining(new Date(liveUpload.expiresAt).getTime() - now)}
              </Text>
            </>
          )}
          {gone && (
            <Text color="yellow">Status: deleted or expired on server</Text>
          )}
          {!liveUpload && !gone && (
            <Text dimColor>Loading live info...</Text>
          )}
          <Text><Text dimColor>URL:       </Text><Text color={accent}>{u.url}</Text></Text>
        </Box>
        {showQR && (
          <Box marginTop={1} marginLeft={2}>
            <QRCodeDisplay url={u.url} />
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={items}
            onSelect={async (val) => {
              if (val === "url") {
                process.stdout.write(u.url + "\n");
              } else if (val === "qr") {
                setShowQR((v) => !v);
              } else if (val === "delete") {
                try {
                  await deleteUpload(u.server, u.id, u.ownerToken);
                  removeUpload(u.id);
                } catch (err) {
                  if (err instanceof ApiError && err.status === 404) {
                    removeUpload(u.id);
                  }
                }
                setPhase("list");
                setRefreshKey((k) => k + 1);
              } else if (val === "remove") {
                removeUpload(u.id);
                setPhase("list");
                setShowQR(false);
                setRefreshKey((k) => k + 1);
              } else {
                setPhase("list");
                setShowQR(false);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Note detail
  if (phase === "note-detail" && selectedNote) {
    const n = selectedNote;
    const gone = liveNote?.gone;
    const items: Array<SelectItem<string>> = gone
      ? [
          { label: "Remove from history", value: "remove" },
          { label: "Back", value: "back" },
        ]
      : [
          { label: "Copy URL (print)", value: "url" },
          { label: showQR ? "Hide QR code" : "Show QR code", value: "qr" },
          { label: "Delete from server", value: "delete" },
          { label: "Remove from history", value: "remove" },
          { label: "Back", value: "back" },
        ];

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}><Text bold>Note detail</Text></Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>ID:        </Text>{n.id}</Text>
          <Text><Text dimColor>Type:      </Text>{n.contentType}</Text>
          <Text><Text dimColor>Password:  </Text>{n.hasPassword ? "yes" : "no"}</Text>
          <Text><Text dimColor>Created:   </Text>{formatAge(n.createdAt)}</Text>
          {liveNote && !gone && (
            <>
              <Text>
                <Text dimColor>Views:     </Text>
                {liveNote.viewCount} / {liveNote.maxViews}
                <Text dimColor> ({liveNote.maxViews - liveNote.viewCount} remaining)</Text>
              </Text>
              <Text>
                <Text dimColor>Expires:   </Text>
                {formatTimeRemaining(new Date(liveNote.expiresAt).getTime() - now)}
              </Text>
            </>
          )}
          {gone && (
            <Text color="yellow">Status: deleted or expired on server</Text>
          )}
          {!liveNote && !gone && (
            <Text dimColor>Loading live info...</Text>
          )}
          <Text><Text dimColor>URL:       </Text><Text color={accent}>{n.url}</Text></Text>
        </Box>
        {showQR && (
          <Box marginTop={1} marginLeft={2}>
            <QRCodeDisplay url={n.url} />
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={items}
            onSelect={async (val) => {
              if (val === "url") {
                process.stdout.write(n.url + "\n");
              } else if (val === "qr") {
                setShowQR((v) => !v);
              } else if (val === "delete") {
                try {
                  await deleteNote(n.server, n.id, n.ownerToken);
                  removeNote(n.id);
                } catch (err) {
                  if (err instanceof ApiError && err.status === 404) {
                    removeNote(n.id);
                  }
                }
                setPhase("list");
                setRefreshKey((k) => k + 1);
              } else if (val === "remove") {
                removeNote(n.id);
                setPhase("list");
                setShowQR(false);
                setRefreshKey((k) => k + 1);
              } else {
                setPhase("list");
                setShowQR(false);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  return <Box />;
}
