import { get, set, del, keys } from "idb-keyval";
import type { RequestAsk } from "@skysend/crypto";
import type { LegacyNoteKind, NOTE_KIND } from "@skysend/note-format";
import type { NoteKindKey } from "@/lib/note-editor";
import { readStoredTemplate, type RequestTemplate } from "@/lib/request-templates";

export interface StoredUpload {
  id: string;
  ownerToken: string;
  secret: string;
  fileNames: string[];
  createdAt: string;
  /** Optional label the owner set in "My Links". Never leaves this browser. */
  name?: string;
}

/** Maximum length of a user-defined upload name. */
export const UPLOAD_NAME_MAX_LENGTH = 100;

export interface StoredNote {
  id: string;
  ownerToken: string;
  secret: string;
  /** "blocks". LEGACY(notes-v1): or the content type of a note created before v3. */
  contentType: typeof NOTE_KIND | LegacyNoteKind;
  /** The kinds of blocks a note made of blocks holds, for "My Links". Never leaves this browser. */
  kinds?: NoteKindKey[];
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

/** Trims and truncates a user-defined upload name. Blank input clears the name. */
export function normalizeUploadName(name: string): string | undefined {
  const trimmed = name.trim().slice(0, UPLOAD_NAME_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Sets or clears the user-defined name of a stored upload.
 * Reads before writing because `set` replaces the whole record.
 */
export async function setUploadName(id: string, name: string): Promise<void> {
  const upload = await getUpload(id);
  if (!upload) return;
  await set(uploadKey(id), { ...upload, name: normalizeUploadName(name) });
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

// ── File Request Storage ───────────────────────────────

/**
 * A file request created in this browser, for My Links. The two fragments are
 * what the two links carry. With a password the inbox fragment holds the protected
 * secret, so it opens nothing without the password, and no token is kept beside it.
 */
export interface StoredRequest {
  id: string;
  /** What follows "#" in the inbox link. */
  inboxFragment: string;
  /** What follows "#" in the upload link. */
  uploadFragment: string;
  hasPassword: boolean;
  /** The title in plain text. Never leaves this browser unencrypted. */
  title?: string;
  closesAt: string;
  createdAt: string;
  /** IDs of the uploads the inbox listed when it was last open here. Any other one is new. */
  seenUploads?: string[];
  /** What the request asks for, so a submission of files and a note counts as one. */
  asks?: RequestAsk[];
}

const REQUEST_PREFIX = "request:";

function requestKey(id: string): string {
  return `${REQUEST_PREFIX}${id}`;
}

export async function saveRequest(request: StoredRequest): Promise<void> {
  await set(requestKey(request.id), request);
}

export async function getRequest(id: string): Promise<StoredRequest | undefined> {
  return get<StoredRequest>(requestKey(id));
}

export async function removeRequest(id: string): Promise<void> {
  await del(requestKey(id));
}

/**
 * Remembers which uploads the inbox listed, so only later ones count as new. Only for the
 * link this browser stored, so a made-up link to the same ID changes nothing. Returns the
 * IDs it knew before, or null when it changed nothing.
 */
export async function markUploadsSeen(
  id: string,
  inboxFragment: string,
  uploadIds: string[],
): Promise<Set<string> | null> {
  const request = await getRequest(id);
  if (!request || request.inboxFragment !== inboxFragment) return null;
  await saveRequest({ ...request, seenUploads: uploadIds });
  return new Set(request.seenUploads ?? []);
}

export async function getAllRequests(): Promise<StoredRequest[]> {
  const allKeys = await keys();
  const requests: StoredRequest[] = [];
  for (const k of allKeys) {
    if (typeof k !== "string" || !k.startsWith(REQUEST_PREFIX)) continue;
    const request = await get<StoredRequest>(k);
    if (request) requests.push(request);
  }
  requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return requests;
}

// ── Request Template Storage ───────────────────────────

const TEMPLATE_PREFIX = "template:";

function templateKey(id: string): string {
  return `${TEMPLATE_PREFIX}${id}`;
}

export async function saveTemplate(template: RequestTemplate): Promise<void> {
  await set(templateKey(template.id), template);
}

export async function removeTemplate(id: string): Promise<void> {
  await del(templateKey(id));
}

/**
 * The templates kept in this browser, by name. Each one is read like a template from
 * elsewhere, so one that does not read is left out instead of breaking the list.
 */
export async function getAllTemplates(): Promise<RequestTemplate[]> {
  const allKeys = await keys();
  const templates: RequestTemplate[] = [];
  for (const k of allKeys) {
    if (typeof k !== "string" || !k.startsWith(TEMPLATE_PREFIX)) continue;
    const template = readStoredTemplate(await get(k));
    if (template) templates.push(template);
  }
  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}
