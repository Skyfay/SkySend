import { useState, useCallback, useSyncExternalStore } from "react";
import {
  getAllNotes,
  removeNote,
  type StoredNote,
} from "@/lib/upload-store";
import * as api from "@/lib/api";

export interface NoteWithStatus extends StoredNote {
  info: api.NoteInfo | null;
  loading: boolean;
  gone: boolean;
}

// Simple external store to trigger re-fetches
let refreshCounter = 0;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return refreshCounter;
}
function emitNoteRefresh() {
  refreshCounter++;
  for (const l of listeners) l();
}

export function useNoteHistory() {
  const [notes, setNotes] = useState<NoteWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const version = useSyncExternalStore(subscribe, getSnapshot);

  const loadData = useCallback(async () => {
    setLoading(true);
    const stored = await getAllNotes();

    const withStatus: NoteWithStatus[] = stored.map((n) => ({
      ...n,
      info: null,
      loading: true,
      gone: false,
    }));
    setNotes(withStatus);
    setLoading(false);

    // Fetch live status for each note
    for (const note of withStatus) {
      try {
        const info = await api.fetchNoteInfo(note.id);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === note.id ? { ...n, info, loading: false } : n,
          ),
        );
      } catch (err) {
        if (err instanceof api.ApiError && (err.status === 404 || err.status === 410)) {
          await removeNote(note.id);
          setNotes((prev) =>
            prev.map((n) =>
              n.id === note.id ? { ...n, loading: false, gone: true } : n,
            ),
          );
        } else {
          setNotes((prev) =>
            prev.map((n) =>
              n.id === note.id ? { ...n, loading: false } : n,
            ),
          );
        }
      }
    }
  }, []);

  const [lastVersion, setLastVersion] = useState(-1);
  if (lastVersion !== version) {
    setLastVersion(version);
    loadData();
  }

  const deleteNoteById = useCallback(
    async (id: string, ownerToken: string) => {
      await api.deleteNote(id, ownerToken);
      await removeNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    },
    [],
  );

  return {
    notes: notes.filter((n) => !n.gone),
    loading,
    refresh: emitNoteRefresh,
    deleteNote: deleteNoteById,
  };
}
