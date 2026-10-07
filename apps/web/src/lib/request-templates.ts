import { z } from "zod";
import {
  encodeUtf8,
  fromBase64url,
  openWithPassword,
  sealWithPassword,
  toBase64url,
  PASSWORD_BOX_NONCE_LENGTH,
  PASSWORD_SALT_LENGTH,
  REQUEST_TITLE_MAX_BYTES,
  type Argon2idHashFn,
  type PasswordBox,
  type RequestAsk,
} from "@skysend/crypto";
import {
  MAX_LABEL_LENGTH,
  cleanLabel,
  parseTemplate,
  serializeTemplate,
  type NoteBlock,
  type NoteTemplate,
} from "@skysend/note-format";
import { briefFits, sanitizeTitle } from "@/lib/file-request";
import { formatBytes, formatDuration } from "@/lib/utils";

/** The `t` of i18next, as far as this module needs it. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Open for, sends and the size of one upload, as the request form sets them. */
export interface TemplateLimits {
  expireSec: number;
  /** Submissions in a request for files and a note, uploads otherwise. */
  sends: number;
  maxSize: number;
  /** How often each upload can be downloaded. Missing in a template made before it was chosen. */
  downloads?: number;
}

/**
 * What a template keeps of a request: what it asks for, the fields of the note and, when
 * chosen, the title and the limits. Never an inbox password and never a value of a field.
 */
export interface TemplateFields {
  name: string;
  asks: RequestAsk[];
  title?: string;
  /** The fields of the note, without values. Missing for a note written freely. */
  note?: NoteTemplate;
  limits?: TemplateLimits;
}

/** A template kept in this browser, to start the next request of its kind from. */
export interface RequestTemplate extends TemplateFields {
  id: string;
  createdAt: string;
  /** When a request was last created from it. */
  usedAt?: string;
}

const ASK_ORDER: RequestAsk[] = ["files", "note"];
/** Durations are capped at 100 years, like everywhere else. */
const MAX_SECONDS = 100 * 365 * 24 * 3600;
/** The largest export a file or a link may hold, and the most templates in one. */
export const MAX_EXPORT_BYTES = 512 * 1024;
export const MAX_TEMPLATES_PER_EXPORT = 200;
/** The longest fragment of a templates link: the largest export as base64url. */
const MAX_LINK_LENGTH = Math.ceil((MAX_EXPORT_BYTES * 4) / 3);
const EXPORT_KIND = "skysend-request-templates";
/** The AAD of a sealed export, so a box made for something else does not open as one. */
const EXPORT_PURPOSE = "skysend-request-templates-v1";

const fieldsSchema = z.object({
  name: z.string().max(2000),
  asks: z.array(z.string().max(32)).max(8),
  title: z.string().max(8192).optional(),
  note: z.unknown().optional(),
  limits: z
    .object({
      expireSec: z.number().int().positive().max(MAX_SECONDS),
      sends: z.number().int().positive().max(1_000_000),
      maxSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      downloads: z.number().int().positive().max(1000).optional(),
    })
    .optional(),
});

const storedSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  usedAt: z.string().datetime().optional(),
});

/** The bytes of a text in UTF-8, as the title limit of a request counts them. */
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Reads a template as untrusted, wherever it comes from: a file, a link or this browser's
 * store. The name and every label are cleaned, values are dropped, asks it does not know are
 * left out, and it has to fit the brief of a request. Null when nothing usable is left.
 */
export function readTemplateFields(raw: unknown): TemplateFields | null {
  const parsed = fieldsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { limits } = parsed.data;
  const name = cleanLabel(parsed.data.name);
  const asks = ASK_ORDER.filter((ask) => parsed.data.asks.includes(ask));
  if (!name || asks.length === 0) return null;

  const cleaned = parsed.data.title === undefined ? "" : sanitizeTitle(parsed.data.title);
  const title = cleaned && byteLength(cleaned) <= REQUEST_TITLE_MAX_BYTES ? cleaned : "";
  let blocks: NoteBlock[] = [];
  if (asks.includes("note") && parsed.data.note !== undefined) {
    try {
      blocks = parseTemplate(parsed.data.note);
    } catch {
      // Nothing in it can be filled in, which leaves a note written freely.
    }
  }
  if (!briefFits(title, asks, blocks)) return null;
  return {
    name,
    asks,
    ...(title ? { title } : {}),
    ...(blocks.length > 0 ? { note: serializeTemplate(blocks) } : {}),
    ...(limits ? { limits } : {}),
  };
}

/** Reads a template from this browser's store, the same way as one from elsewhere. */
export function readStoredTemplate(raw: unknown): RequestTemplate | null {
  const stored = storedSchema.safeParse(raw);
  const fields = readTemplateFields(raw);
  if (!stored.success || !fields) return null;
  return { ...fields, ...stored.data };
}

/** What a kept template holds, without what only this browser knows of it. */
export function fieldsOf(template: RequestTemplate): TemplateFields {
  const { id: _id, createdAt: _createdAt, usedAt: _usedAt, ...fields } = template;
  return fields;
}

/** One template of an import, and the kept one with the same name, if there is one. */
export interface ImportItem {
  fields: TemplateFields;
  existing: RequestTemplate | null;
}

/** Pairs every template of an import with a kept template of the same name. */
export function planImport(
  found: readonly TemplateFields[],
  kept: readonly RequestTemplate[],
): ImportItem[] {
  return found.map((fields) => ({
    fields,
    existing: kept.find((template) => sameName(template.name, fields.name)) ?? null,
  }));
}

/** The blocks of the note to fill in, or none for a note written freely. */
export function templateBlocks(fields: TemplateFields): NoteBlock[] {
  if (!fields.note) return [];
  try {
    return parseTemplate(fields.note);
  } catch {
    return [];
  }
}

/** The names of the fields a sender fills in, as the requester gave them. */
export function fieldNames(blocks: readonly NoteBlock[], translate: Translate): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "password":
        return block.entries.map((entry) => entry.label || translate("templates.field.entry"));
      case "text":
        return [block.label || translate("templates.field.text")];
      case "code":
        return [block.title || translate("templates.field.code")];
      case "sshkey":
        return [block.label || translate("templates.field.sshKey")];
    }
  });
}

/** How many field names a summary shows before it counts the rest. */
const SHOWN_FIELDS = 4;

/** One line on what a template asks for and how: the kind, the fields and the limits. */
export function templateSummary(fields: TemplateFields, translate: Translate): string {
  const { asks, limits } = fields;
  const both = asks.length > 1;
  const parts = [
    both
      ? translate("request.asksBoth")
      : asks[0] === "files"
        ? translate("request.asksFiles")
        : translate("request.asksNote"),
  ];
  if (asks.includes("note")) {
    const names = fieldNames(templateBlocks(fields), translate);
    const rest = names.length - SHOWN_FIELDS;
    parts.push(
      names.length === 0
        ? translate("templates.freeNote")
        : names.slice(0, SHOWN_FIELDS).join(", ") + (rest > 0 ? ` +${rest}` : ""),
    );
  }
  if (limits) {
    const size = formatBytes(limits.maxSize);
    if (both) {
      parts.push(translate("request.submissionsCount", { count: limits.sends }), size);
    } else if (asks[0] === "files") {
      parts.push(translate("templates.uploadsUpTo", { count: limits.sends, size }));
    } else {
      parts.push(translate("request.uploads", { count: limits.sends }));
    }
    parts.push(formatDuration(limits.expireSec));
  }
  return parts.join(" · ");
}

/** Two names count as the same when they differ in case only. */
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/** The name, or the name with a number behind it, so it is not one of `taken`. */
export function freeName(name: string, taken: readonly string[]): string {
  if (!taken.some((other) => sameName(other, name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate =
      Array.from(name)
        .slice(0, MAX_LABEL_LENGTH - suffix.length)
        .join("") + suffix;
    if (!taken.some((other) => sameName(other, candidate))) return candidate;
  }
}

// ── Templates that come with SkySend ──────────────────

export type BuiltInKey = "credentials" | "sshKey" | "wifi" | "apiKey";

/** A field of a built-in: its label, and whether its value is a secret shown masked. */
type Field = [label: string, secret: boolean];

/** A block of fields under a title, the name of the built-in. */
const password = (label: string, fields: Field[]): NoteBlock => ({
  type: "password",
  label,
  entries: fields.map(([field, secret]) => ({
    label: field,
    value: "",
    ...(secret ? {} : { secret: false }),
  })),
});

const BUILT_INS: Record<BuiltInKey, (label: (field: string) => string) => NoteBlock[]> = {
  credentials: (label) => [
    password(label("name"), [
      [label("address"), false],
      [label("username"), false],
      [label("password"), true],
    ]),
  ],
  sshKey: () => [{ type: "sshkey", publicKey: "", privateKey: "", passphrase: "" }],
  wifi: (label) => [
    password(label("name"), [
      [label("network"), false],
      [label("password"), true],
    ]),
  ],
  apiKey: (label) => [
    password(label("name"), [
      [label("service"), false],
      [label("key"), true],
      [label("expires"), false],
    ]),
  ],
};

export const BUILT_IN_KEYS = Object.keys(BUILT_INS) as BuiltInKey[];

/** A template that comes with SkySend, in the language of the page. */
export function builtInTemplate(
  key: BuiltInKey,
  translate: (key: string) => string,
): TemplateFields {
  const label = (field: string) => translate(`templates.builtIn.${key}.${field}`);
  return { name: label("name"), asks: ["note"], note: serializeTemplate(BUILT_INS[key](label)) };
}

// ── Export and import ─────────────────────────────────

/** The export is not one, or it does not fit. */
export class TemplateExportError extends Error {
  constructor(readonly reason: "invalid" | "tooLarge" | "password") {
    super(`Template export: ${reason}`);
    this.name = "TemplateExportError";
  }
}

const plainExportSchema = z.object({
  kind: z.literal(EXPORT_KIND),
  v: z.literal(1),
  templates: z.array(z.unknown()),
});

const base64url = (max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]*$/)
    .max(max);
const sealedExportSchema = z.object({
  kind: z.literal(EXPORT_KIND),
  v: z.literal(1),
  sealed: z.object({
    salt: base64url(32),
    nonce: base64url(32),
    ciphertext: base64url(MAX_LINK_LENGTH),
  }),
});

/** What an export holds: the templates it could read, or a box that needs its password. */
export type TemplateExport =
  | { sealed: false; templates: TemplateFields[]; skipped: number }
  | { sealed: true; box: PasswordBox };

/**
 * The JSON of an export of these templates, sealed with a password when one is given. Throws
 * when it holds more than an import takes, so no export is made that would not open.
 */
export async function exportTemplates(
  templates: readonly TemplateFields[],
  seal?: { password: string; argon2id: Argon2idHashFn },
): Promise<string> {
  if (templates.length > MAX_TEMPLATES_PER_EXPORT) throw new TemplateExportError("tooLarge");
  const plain = JSON.stringify({
    kind: EXPORT_KIND,
    v: 1,
    templates: templates.map(({ name, asks, title, note, limits }) => ({
      name,
      asks,
      ...(title ? { title } : {}),
      ...(note ? { note } : {}),
      ...(limits ? { limits } : {}),
    })),
  });
  if (!seal) return fitting(plain);
  const box = await sealWithPassword(
    encodeUtf8(plain),
    seal.password,
    EXPORT_PURPOSE,
    seal.argon2id,
  );
  return fitting(
    JSON.stringify({
      kind: EXPORT_KIND,
      v: 1,
      sealed: {
        salt: toBase64url(box.salt),
        nonce: toBase64url(box.nonce),
        ciphertext: toBase64url(box.ciphertext),
      },
    }),
  );
}

/** The export, when an import would take it. */
function fitting(json: string): string {
  if (byteLength(json) > MAX_EXPORT_BYTES) throw new TemplateExportError("tooLarge");
  return json;
}

/** Reads an export as untrusted. A template it cannot read is skipped, the rest is kept. */
export function readTemplateExport(text: string): TemplateExport {
  if (byteLength(text) > MAX_EXPORT_BYTES) throw new TemplateExportError("tooLarge");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TemplateExportError("invalid");
  }
  const sealed = sealedExportSchema.safeParse(data);
  if (sealed.success) {
    const { salt, nonce, ciphertext } = sealed.data.sealed;
    const box = {
      salt: fromBase64url(salt),
      nonce: fromBase64url(nonce),
      ciphertext: fromBase64url(ciphertext),
    };
    if (
      box.salt.length !== PASSWORD_SALT_LENGTH ||
      box.nonce.length !== PASSWORD_BOX_NONCE_LENGTH
    ) {
      throw new TemplateExportError("invalid");
    }
    return { sealed: true, box };
  }
  const plain = plainExportSchema.safeParse(data);
  if (!plain.success) throw new TemplateExportError("invalid");
  if (plain.data.templates.length > MAX_TEMPLATES_PER_EXPORT) {
    throw new TemplateExportError("tooLarge");
  }
  const templates = plain.data.templates.flatMap((raw) => {
    const fields = readTemplateFields(raw);
    return fields ? [fields] : [];
  });
  return { sealed: false, templates, skipped: plain.data.templates.length - templates.length };
}

/** Opens a sealed export. A wrong password and a changed box read the same. */
export async function openTemplateExport(
  box: PasswordBox,
  password: string,
  argon2id: Argon2idHashFn,
): Promise<{ templates: TemplateFields[]; skipped: number }> {
  let bytes: Uint8Array;
  try {
    bytes = await openWithPassword(box, password, EXPORT_PURPOSE, argon2id);
  } catch {
    throw new TemplateExportError("password");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TemplateExportError("invalid");
  }
  const inner = readTemplateExport(text);
  // A box inside a box is nothing an export of SkySend makes.
  if (inner.sealed) throw new TemplateExportError("invalid");
  return { templates: inner.templates, skipped: inner.skipped };
}

/** The link that carries an export. Everything is in the fragment, which never reaches a server. */
export function templatesLink(json: string, origin = window.location.origin): string {
  return `${origin}/templates#${toBase64url(encodeUtf8(json))}`;
}

/**
 * The export a templates link brought, held in memory until My Links imports it, so it never
 * lands in the history of the page.
 */
let linkImport: string | null = null;

export function setLinkImport(text: string | null): void {
  linkImport = text;
}

export function peekLinkImport(): string | null {
  return linkImport;
}

/** The export in the fragment of a templates link. */
export function readTemplatesLink(fragment: string): string {
  if (fragment.length > MAX_LINK_LENGTH) {
    throw new TemplateExportError("tooLarge");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(fromBase64url(fragment));
  } catch {
    throw new TemplateExportError("invalid");
  }
}
