import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface StoredUpload {
  id: string;
  server: string;
  url: string;
  ownerToken: string;
  fileNames: string[];
  totalSize: number;
  hasPassword: boolean;
  createdAt: string;
  expireSec: number;
}

export interface StoredNote {
  id: string;
  server: string;
  url: string;
  ownerToken: string;
  contentType: string;
  hasPassword: boolean;
  createdAt: string;
  expireSec: number;
}

interface HistoryData {
  uploads: StoredUpload[];
  notes: StoredNote[];
}

function getHistoryDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || path.join(os.homedir(), ".config");
  return path.join(base, "skysend");
}

function getHistoryPath(): string {
  return path.join(getHistoryDir(), "history.json");
}

function loadHistory(): HistoryData {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return { uploads: [], notes: [] };
  try {
    const raw = fs.readFileSync(historyPath, "utf-8");
    const data = JSON.parse(raw) as Partial<HistoryData>;
    return {
      uploads: Array.isArray(data.uploads) ? data.uploads : [],
      notes: Array.isArray(data.notes) ? data.notes : [],
    };
  } catch {
    return { uploads: [], notes: [] };
  }
}

function saveHistory(data: HistoryData): void {
  const dir = getHistoryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getHistoryPath(), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Uploads ────────────────────────────────────────────

export function addUpload(upload: StoredUpload): void {
  const data = loadHistory();
  data.uploads.unshift(upload);
  // Keep max 100 entries
  if (data.uploads.length > 100) data.uploads.length = 100;
  saveHistory(data);
}

export function getUploads(): StoredUpload[] {
  return loadHistory().uploads;
}

export function removeUpload(id: string): void {
  const data = loadHistory();
  data.uploads = data.uploads.filter((u) => u.id !== id);
  saveHistory(data);
}

// ── Notes ──────────────────────────────────────────────

export function addNote(note: StoredNote): void {
  const data = loadHistory();
  data.notes.unshift(note);
  if (data.notes.length > 100) data.notes.length = 100;
  saveHistory(data);
}

export function getNotes(): StoredNote[] {
  return loadHistory().notes;
}

export function removeNote(id: string): void {
  const data = loadHistory();
  data.notes = data.notes.filter((n) => n.id !== id);
  saveHistory(data);
}

// ── Cleanup ────────────────────────────────────────────

/** Remove uploads and notes whose expiry has passed (local check). */
export function cleanupExpired(): { removedUploads: number; removedNotes: number } {
  const data = loadHistory();
  const now = Date.now();

  const beforeUploads = data.uploads.length;
  data.uploads = data.uploads.filter((u) => {
    const expiresAt = new Date(u.createdAt).getTime() + u.expireSec * 1000;
    return expiresAt > now;
  });

  const beforeNotes = data.notes.length;
  data.notes = data.notes.filter((n) => {
    const expiresAt = new Date(n.createdAt).getTime() + n.expireSec * 1000;
    return expiresAt > now;
  });

  const removedUploads = beforeUploads - data.uploads.length;
  const removedNotes = beforeNotes - data.notes.length;

  if (removedUploads > 0 || removedNotes > 0) {
    saveHistory(data);
  }

  return { removedUploads, removedNotes };
}
