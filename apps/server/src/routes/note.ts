import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { notes, type Note } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { constantTimeEqual, fromBase64url, toBase64url } from "@skysend/crypto";

const noteRoute = new Hono();

// ── Validation Schemas ─────────────────────────────────

const createNoteSchema = z.object({
  encryptedContent: z.string().min(1),
  nonce: z.string().min(1),
  salt: z.string().min(1),
  ownerToken: z.string().min(1),
  authToken: z.string().min(1),
  contentType: z.enum(["text", "password", "code"]),
  maxViews: z.number().int().positive(),
  expireSec: z.number().int().positive(),
  hasPassword: z.boolean().default(false),
  passwordSalt: z.string().optional(),
  passwordAlgo: z.string().optional(),
});

const viewNoteSchema = z.object({
  authToken: z.string().min(1),
});

// ── Helpers ────────────────────────────────────────────

function isNoteAvailable(note: Note): { available: boolean; error?: string } {
  if (new Date() >= note.expiresAt) {
    return { available: false, error: "Note has expired" };
  }
  if (note.viewCount >= note.maxViews) {
    return { available: false, error: "View limit reached" };
  }
  return { available: true };
}

// ── POST /api/note ─────────────────────────────────────

noteRoute.post(
  "/",
  bodyLimit({
    maxSize: 2 * 1024 * 1024, // 2 MB hard limit on body (encrypted content + overhead)
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
  async (c) => {
    const config = getConfig();

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = createNoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const data = parsed.data;

    // Validate encrypted content size
    let contentBytes: Buffer;
    try {
      contentBytes = Buffer.from(data.encryptedContent, "base64");
    } catch {
      return c.json({ error: "Invalid encryptedContent encoding" }, 400);
    }

    if (contentBytes.length > config.NOTE_MAX_SIZE + 256) {
      // Allow some overhead for GCM tag + padding
      return c.json({ error: `Note content exceeds maximum size` }, 413);
    }

    // Validate salt
    let saltBytes: Uint8Array;
    try {
      saltBytes = fromBase64url(data.salt);
      if (saltBytes.length !== 16) {
        return c.json({ error: "Salt must be exactly 16 bytes" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid salt encoding" }, 400);
    }

    // Validate nonce
    let nonceBytes: Buffer;
    try {
      nonceBytes = Buffer.from(data.nonce, "base64");
      if (nonceBytes.length !== 12) {
        return c.json({ error: "Nonce must be exactly 12 bytes" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid nonce encoding" }, 400);
    }

    // Validate expiry and view options
    if (!config.NOTE_EXPIRE_OPTIONS_SEC.includes(data.expireSec)) {
      return c.json({ error: "Invalid expiry time. Must be one of the allowed options." }, 400);
    }

    if (!config.NOTE_VIEW_OPTIONS.includes(data.maxViews)) {
      return c.json({ error: "Invalid view limit. Must be one of the allowed options." }, 400);
    }

    // Validate password fields
    if (data.hasPassword) {
      if (!data.passwordSalt || !data.passwordAlgo) {
        return c.json({ error: "Password-protected notes require passwordSalt and passwordAlgo" }, 400);
      }
      try {
        const pwSaltBytes = fromBase64url(data.passwordSalt);
        if (pwSaltBytes.length !== 16) {
          return c.json({ error: "Password salt must be exactly 16 bytes" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid password salt encoding" }, 400);
      }
    }

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + data.expireSec * 1000);

    const db = getDb();
    db.insert(notes)
      .values({
        id,
        ownerToken: data.ownerToken,
        authToken: data.authToken,
        salt: saltBytes as Buffer,
        encryptedContent: contentBytes,
        nonce: nonceBytes,
        contentType: data.contentType,
        hasPassword: data.hasPassword,
        passwordSalt: data.hasPassword && data.passwordSalt
          ? Buffer.from(fromBase64url(data.passwordSalt))
          : null,
        passwordAlgo: data.hasPassword ? data.passwordAlgo : null,
        maxViews: data.maxViews,
        expiresAt,
      })
      .run();

    return c.json({ id, expiresAt: expiresAt.toISOString() }, 201);
  },
);

// ── GET /api/note/:id ──────────────────────────────────

noteRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const db = getDb();
  const note = await db.query.notes.findFirst({
    where: eq(notes.id, id),
  });

  if (!note) {
    return c.json({ error: "Note not found" }, 404);
  }

  const { available, error } = isNoteAvailable(note);
  if (!available) {
    return c.json({ error }, 410);
  }

  return c.json({
    id: note.id,
    contentType: note.contentType,
    hasPassword: note.hasPassword,
    passwordAlgo: note.hasPassword ? note.passwordAlgo : undefined,
    passwordSalt: note.hasPassword && note.passwordSalt
      ? toBase64url(new Uint8Array(note.passwordSalt))
      : undefined,
    salt: toBase64url(new Uint8Array(note.salt)),
    maxViews: note.maxViews,
    viewCount: note.viewCount,
    expiresAt: note.expiresAt.toISOString(),
    createdAt: note.createdAt.toISOString(),
  });
});

// ── POST /api/note/:id/view ────────────────────────────

noteRoute.post(
  "/:id/view",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
  async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = viewNoteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Missing authToken in body" }, 400);
    }

    const db = getDb();
    const note = await db.query.notes.findFirst({
      where: eq(notes.id, id),
    });

    if (!note) {
      return c.json({ error: "Note not found" }, 404);
    }

    const { available, error } = isNoteAvailable(note);
    if (!available) {
      return c.json({ error }, 410);
    }

    // Constant-time auth token comparison
    let providedToken: Uint8Array;
    try {
      providedToken = fromBase64url(parsed.data.authToken);
    } catch {
      return c.json({ error: "Invalid auth token format" }, 401);
    }

    const storedToken = fromBase64url(note.authToken);
    if (!constantTimeEqual(providedToken, storedToken)) {
      return c.json({ error: "Invalid auth token" }, 401);
    }

    // Atomically increment view count with race-proof WHERE clause
    const result = db
      .update(notes)
      .set({ viewCount: sql`${notes.viewCount} + 1` })
      .where(
        sql`${notes.id} = ${id} AND ${notes.viewCount} < ${notes.maxViews}`,
      )
      .run();

    if (result.changes === 0) {
      return c.json({ error: "View limit reached" }, 410);
    }

    return c.json({
      encryptedContent: Buffer.from(note.encryptedContent).toString("base64"),
      nonce: Buffer.from(note.nonce).toString("base64"),
      viewCount: note.viewCount + 1,
      maxViews: note.maxViews,
    });
  },
);

// ── POST /api/note/:id/password ────────────────────────

noteRoute.post(
  "/:id/password",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
  async (c) => {
    const id = c.req.param("id");

    let body: { authToken?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.authToken || typeof body.authToken !== "string") {
      return c.json({ error: "Missing authToken in body" }, 400);
    }

    const db = getDb();
    const note = await db.query.notes.findFirst({
      where: eq(notes.id, id),
    });

    if (!note) {
      return c.json({ error: "Note not found" }, 404);
    }

    if (!note.hasPassword) {
      return c.json({ error: "Note is not password-protected" }, 400);
    }

    const { available, error } = isNoteAvailable(note);
    if (!available) {
      return c.json({ error }, 410);
    }

    // Constant-time comparison
    let providedToken: Uint8Array;
    try {
      providedToken = fromBase64url(body.authToken);
    } catch {
      return c.json({ error: "Invalid auth token format" }, 401);
    }

    const storedToken = fromBase64url(note.authToken);
    if (!constantTimeEqual(providedToken, storedToken)) {
      return c.json({ error: "Invalid password" }, 401);
    }

    return c.json({ ok: true });
  },
);

// ── DELETE /api/note/:id ───────────────────────────────

noteRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const tokenHeader = c.req.header("X-Owner-Token");
  if (!tokenHeader) {
    return c.json({ error: "Missing X-Owner-Token header" }, 401);
  }

  const db = getDb();
  const note = await db.query.notes.findFirst({
    where: eq(notes.id, id),
  });

  if (!note) {
    return c.json({ error: "Note not found" }, 404);
  }

  let providedToken: Uint8Array;
  try {
    providedToken = fromBase64url(tokenHeader);
  } catch {
    return c.json({ error: "Invalid owner token format" }, 401);
  }

  const storedToken = fromBase64url(note.ownerToken);
  if (!constantTimeEqual(providedToken, storedToken)) {
    return c.json({ error: "Invalid owner token" }, 401);
  }

  db.delete(notes).where(eq(notes.id, id)).run();

  return c.json({ ok: true });
});

export { noteRoute };
