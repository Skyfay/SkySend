import { useState, useCallback, useSyncExternalStore } from "react";
import {
  getAllUploads,
  removeUpload,
  type StoredUpload,
} from "@/lib/upload-store";
import * as api from "@/lib/api";

export interface UploadWithStatus extends StoredUpload {
  info: api.UploadInfo | null;
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
function emitRefresh() {
  refreshCounter++;
  for (const l of listeners) l();
}

export function useUploadHistory() {
  const [uploads, setUploads] = useState<UploadWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const version = useSyncExternalStore(subscribe, getSnapshot);

  const loadData = useCallback(async () => {
    setLoading(true);
    const stored = await getAllUploads();

    const withStatus: UploadWithStatus[] = stored.map((u) => ({
      ...u,
      info: null,
      loading: true,
      gone: false,
    }));
    setUploads(withStatus);
    setLoading(false);

    // Fetch live status for each upload
    for (const upload of withStatus) {
      try {
        const info = await api.fetchInfo(upload.id);
        setUploads((prev) =>
          prev.map((u) =>
            u.id === upload.id ? { ...u, info, loading: false } : u,
          ),
        );
      } catch (err) {
        if (err instanceof api.ApiError && (err.status === 404 || err.status === 410)) {
          await removeUpload(upload.id);
          setUploads((prev) =>
            prev.map((u) =>
              u.id === upload.id ? { ...u, loading: false, gone: true } : u,
            ),
          );
        } else {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === upload.id ? { ...u, loading: false } : u,
            ),
          );
        }
      }
    }
  }, []);

  // Load on mount and when refresh is triggered
  // Using version as key to trigger re-loads
  const [lastVersion, setLastVersion] = useState(-1);
  if (lastVersion !== version) {
    setLastVersion(version);
    loadData();
  }

  const deleteUploadById = useCallback(
    async (id: string, ownerToken: string) => {
      await api.deleteUpload(id, ownerToken);
      await removeUpload(id);
      setUploads((prev) => prev.filter((u) => u.id !== id));
    },
    [],
  );

  return {
    uploads: uploads.filter((u) => !u.gone),
    loading,
    refresh: emitRefresh,
    deleteUpload: deleteUploadById,
  };
}
