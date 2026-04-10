import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ownerMiddleware } from "../middleware/auth.js";
import type { Upload } from "../db/schema.js";

const metaBodySchema = z.object({
  encryptedMeta: z.string().min(1),
  nonce: z.string().min(1),
});

const metaRoute = new Hono<{
  Variables: { upload: Upload };
}>();

/**
 * POST /api/meta/:id
 * Save encrypted metadata for an upload. Requires owner token.
 */
metaRoute.post("/:id", ownerMiddleware, async (c) => {
  const upload = c.get("upload");

  // Do not allow overwriting metadata
  if (upload.encryptedMeta) {
    return c.json({ error: "Metadata already set" }, 409);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = metaBodySchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "Invalid request body", details: result.error.flatten().fieldErrors },
      400,
    );
  }

  const { encryptedMeta, nonce } = result.data;

  const db = getDb();
  db.update(uploads)
    .set({
      encryptedMeta: Buffer.from(encryptedMeta, "base64"),
      nonce: Buffer.from(nonce, "base64"),
    })
    .where(eq(uploads.id, upload.id))
    .run();

  return c.json({ ok: true });
});

export { metaRoute };
