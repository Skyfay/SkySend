import { get, set, del, keys } from "idb-keyval";

export interface StoredUpload {
  id: string;
  ownerToken: string;
  secret: string;
  fileNames: string[];
  createdAt: string;
}

const PREFIX = "upload:";

function key(id: string): string {
  return `${PREFIX}${id}`;
}

export async function saveUpload(upload: StoredUpload): Promise<void> {
  await set(key(upload.id), upload);
}

export async function getUpload(id: string): Promise<StoredUpload | undefined> {
  return get<StoredUpload>(key(id));
}

export async function removeUpload(id: string): Promise<void> {
  await del(key(id));
}

export async function getAllUploads(): Promise<StoredUpload[]> {
  const allKeys = await keys();
  const uploadKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(PREFIX),
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
    if (typeof k === "string" && k.startsWith(PREFIX)) {
      const id = k.slice(PREFIX.length);
      if (!activeIds.has(id)) {
        await del(k);
      }
    }
  }
}
