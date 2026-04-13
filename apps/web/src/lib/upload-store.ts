import { get, set, del, keys } from "idb-keyval";
import type { NoteContentType } from "@skysend/crypto";

export interface StoredUpload {
  id: string;
  ownerToken: string;
  secret: string;
  fileNames: string[];
  createdAt: string;
}

export interface StoredNote {
  id: string;
  ownerToken: string;
  secret: string;
  contentType: NoteContentType;
  createdAt: string;
}

const UPLOAD_PREFIX = "upload:";
const NOTE_PREFIX = "note:";

function uploadKey(id: string): string {
  return `${UPLOAD_PREFIX}${id}`;
}

function noteKey(id: string): string {
  return `${NOTE_PREFIX}${id}`;
}

export async function saveUpload(upload: StoredUpload): Promise<void> {
  await set(uploadKey(upload.id), upload);
}

export async function getUpload(id: string): Promise<StoredUpload | undefined> {
  return get<StoredUpload>(uploadKey(id));
}

export async function removeUpload(id: string): Promise<void> {
  await del(uploadKey(id));
}

export async function getAllUploads(): Promise<StoredUpload[]> {
  const allKeys = await keys();
  const uploadKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(UPLOAD_PREFIX),
  );

  const uploads: StoredUpload[] = [];
  for (const k of uploadKeys) {
    const upload = await get<StoredUpload>(k);
    if (upload) uploads.push(upload);
  }

  // Sort newest first
  uploads.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return uploads;
}

export async function clearExpiredUploads(activeIds: Set<string>): Promise<void> {
  const allKeys = await keys();
  for (const k of allKeys) {
    if (typeof k === "string" && k.startsWith(UPLOAD_PREFIX)) {
      const id = k.slice(UPLOAD_PREFIX.length);
      if (!activeIds.has(id)) {
        await del(k);
      }
    }
  }
}

// ── Note Storage ───────────────────────────────────────

export async function saveNote(note: StoredNote): Promise<void> {
  await set(noteKey(note.id), note);
}

export async function getNote(id: string): Promise<StoredNote | undefined> {
  return get<StoredNote>(noteKey(id));
}

export async function removeNote(id: string): Promise<void> {
  await del(noteKey(id));
}

export async function getAllNotes(): Promise<StoredNote[]> {
  const allKeys = await keys();
  const noteKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(NOTE_PREFIX),
  );

  const notes: StoredNote[] = [];
  for (const k of noteKeys) {
    const note = await get<StoredNote>(k);
    if (note) notes.push(note);
  }

  notes.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return notes;
}

export async function clearExpiredNotes(activeIds: Set<string>): Promise<void> {
  const allKeys = await keys();
  for (const k of allKeys) {
    if (typeof k === "string" && k.startsWith(NOTE_PREFIX)) {
      const id = k.slice(NOTE_PREFIX.length);
      if (!activeIds.has(id)) {
        await del(k);
      }
    }
  }
}
