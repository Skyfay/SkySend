import { describe, expect, it } from "vitest";
import { toBase64url, type Argon2idHashFn } from "@skysend/crypto";
import { MAX_LABEL_LENGTH } from "@skysend/note-format";
import {
  BUILT_IN_KEYS,
  MAX_EXPORT_BYTES,
  MAX_TEMPLATES_PER_EXPORT,
  TemplateExportError,
  builtInTemplate,
  exportTemplates,
  fieldsOf,
  freeName,
  openTemplateExport,
  planImport,
  readStoredTemplate,
  readTemplateExport,
  readTemplateFields,
  peekLinkImport,
  readTemplatesLink,
  sameName,
  setLinkImport,
  templateBlocks,
  templateSummary,
  templatesLink,
  type RequestTemplate,
  type TemplateFields,
} from "../../src/lib/request-templates.js";
import { formatBytes, formatDuration } from "../../src/lib/utils.js";
import { hashWasmArgon2 } from "../../src/lib/argon2.js";
import frozen from "../fixtures/frozen-passwords.json";

/** A stand-in for Argon2id: SHA-256 of password and salt, fast and deterministic. */
const fakeArgon2: Argon2idHashFn = async (password, salt) => {
  const both = new Uint8Array(password.length + salt.length);
  both.set(password);
  both.set(salt, password.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", both));
};

const access: TemplateFields = {
  name: "Server access",
  asks: ["files", "note"],
  title: "Access to the new server",
  note: {
    v: 1,
    blocks: [{ type: "password", entries: [{ label: "Username", value: "" }] }],
  },
  limits: { expireSec: 259_200, sends: 5, maxSize: 1024 ** 3 },
};

function kept(fields: TemplateFields, id: string): RequestTemplate {
  return {
    ...fields,
    id,
    createdAt: "2026-10-01T00:00:00.000Z",
    usedAt: "2026-10-05T00:00:00.000Z",
  };
}

/** The error an export or a link is refused with. */
async function refusal(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (err) {
    return err instanceof TemplateExportError ? err.reason : "other";
  }
  return undefined;
}

describe("readTemplateFields", () => {
  it("keeps a template as it was saved", () => {
    expect(readTemplateFields(access)).toEqual(access);
  });

  it("cleans the name, orders the asks and drops the ones it does not know", () => {
    const read = readTemplateFields({
      name: " Tax‮  2026\u0000 ",
      asks: ["note", "video", "files"],
    });
    expect(read).toEqual({ name: "Tax 2026", asks: ["files", "note"] });
  });

  it("refuses a template without a name or without anything it asks for", () => {
    expect(readTemplateFields({ name: "​‮", asks: ["files"] })).toBeNull();
    expect(readTemplateFields({ name: "Empty", asks: ["video"] })).toBeNull();
    expect(readTemplateFields({ name: "Odd", asks: "files" })).toBeNull();
    expect(readTemplateFields(null)).toBeNull();
  });

  it("throws every value away and cleans the labels of the fields", () => {
    const read = readTemplateFields({
      name: "Bank",
      asks: ["note"],
      note: {
        v: 1,
        blocks: [
          { type: "password", entries: [{ label: "PIN‮", value: "4711" }] },
          { type: "text", format: "plain", text: "Send it to me", label: "Notes" },
        ],
      },
    });
    expect(templateBlocks(read!)).toEqual([
      { type: "password", entries: [{ label: "PIN", value: "" }] },
      { type: "text", format: "plain", text: "", label: "Notes" },
    ]);
  });

  it("drops a note template of a template that asks for files only, and one that does not read", () => {
    expect(readTemplateFields({ ...access, asks: ["files"] })?.note).toBeUndefined();
    expect(readTemplateFields({ ...access, note: { v: 1, blocks: [] } })?.note).toBeUndefined();
  });

  it("cleans the title and drops one longer than a request takes", () => {
    expect(readTemplateFields({ ...access, title: "  Access\u0007  now " })?.title).toBe(
      "Access now",
    );
    expect(readTemplateFields({ ...access, title: "x".repeat(1000) })?.title).toBeUndefined();
  });

  it("refuses a template whose brief would not fit into a request", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      label: `${i}`.padEnd(100, "x"),
      value: "",
    }));
    const read = readTemplateFields({
      name: "Huge",
      asks: ["note"],
      note: { v: 1, blocks: [{ type: "password", entries }] },
    });
    expect(read).toBeNull();
  });

  it("refuses limits a request could never have", () => {
    expect(
      readTemplateFields({ ...access, limits: { expireSec: 0, sends: 5, maxSize: 1 } }),
    ).toBeNull();
    expect(
      readTemplateFields({ ...access, limits: { expireSec: 60, sends: 1.5, maxSize: 1 } }),
    ).toBeNull();
  });
});

describe("readStoredTemplate", () => {
  it("needs an ID and a date of its own", () => {
    const template = kept(access, "00000000-0000-4000-8000-000000000001");
    expect(readStoredTemplate(template)).toEqual(template);
    expect(readStoredTemplate({ ...template, id: "../x" })).toBeNull();
    expect(readStoredTemplate({ ...template, createdAt: "yesterday" })).toBeNull();
  });
});

describe("names", () => {
  it("counts two names as the same when only their case differs", () => {
    expect(sameName("WLAN", "wlan")).toBe(true);
    expect(sameName("WLAN", "WLAN 2")).toBe(false);
  });

  it("numbers a name that is taken, and keeps it within the label length", () => {
    expect(freeName("WLAN", ["Other"])).toBe("WLAN");
    expect(freeName("WLAN", ["wlan", "WLAN (2)"])).toBe("WLAN (3)");
    const long = "x".repeat(MAX_LABEL_LENGTH);
    const free = freeName(long, [long]);
    expect(Array.from(free)).toHaveLength(MAX_LABEL_LENGTH);
    expect(free.endsWith(" (2)")).toBe(true);
  });

  it("pairs every imported template with a kept one of the same name", () => {
    const wlan = kept({ name: "WLAN", asks: ["note"] }, "00000000-0000-4000-8000-000000000001");
    const plan = planImport(
      [
        { name: "wlan", asks: ["note"] },
        { name: "New", asks: ["files"] },
      ],
      [wlan],
    );
    expect(plan.map((item) => item.existing?.id ?? null)).toEqual([wlan.id, null]);
  });

  it("leaves out what only this browser knows of a template", () => {
    expect(fieldsOf(kept(access, "00000000-0000-4000-8000-000000000001"))).toEqual(access);
  });
});

describe("built-in templates", () => {
  it("shows an address, a username and the like in clear, and masks only secrets", () => {
    const [credentials] = templateBlocks(builtInTemplate("credentials", (k) => k));
    expect(credentials).toEqual({
      type: "password",
      label: "templates.builtIn.credentials.name",
      entries: [
        { label: "templates.builtIn.credentials.address", value: "", secret: false },
        { label: "templates.builtIn.credentials.username", value: "", secret: false },
        { label: "templates.builtIn.credentials.password", value: "" },
      ],
    });
  });

  it("lays out each one in the language of the page, as a template that reads back", () => {
    for (const key of BUILT_IN_KEYS) {
      const fields = builtInTemplate(key, (k) => `<${k}>`);
      expect(fields.name).toBe(`<templates.builtIn.${key}.name>`);
      expect(fields.asks).toEqual(["note"]);
      expect(readTemplateFields(fields)).toEqual(fields);
      expect(templateBlocks(fields).length).toBeGreaterThan(0);
    }
  });
});

describe("export and import", () => {
  it("exports templates without what only this browser knows, and reads them back", async () => {
    const json = await exportTemplates([kept(access, "00000000-0000-4000-8000-000000000001")]);
    expect(json).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(json).not.toContain("usedAt");
    expect(readTemplateExport(json)).toEqual({ sealed: false, templates: [access], skipped: 0 });
  });

  it("seals an export with a password that only the same password opens", async () => {
    const json = await exportTemplates([access], { password: "horse", argon2id: fakeArgon2 });
    expect(json).not.toContain("Server access");
    const read = readTemplateExport(json);
    if (!read.sealed) throw new Error("expected a sealed export");
    expect(await openTemplateExport(read.box, "horse", fakeArgon2)).toEqual({
      templates: [access],
      skipped: 0,
    });
    expect(await refusal(() => openTemplateExport(read.box, "Horse", fakeArgon2))).toBe("password");
  });

  it("skips the templates of an export it cannot read and keeps the rest", () => {
    const json = JSON.stringify({
      kind: "skysend-request-templates",
      v: 1,
      templates: [access, { name: "", asks: ["files"] }, "nonsense"],
    });
    expect(readTemplateExport(json)).toMatchObject({ sealed: false, skipped: 2 });
  });

  it("refuses what is no export, a newer one and one that is too large", async () => {
    expect(await refusal(() => readTemplateExport("not json"))).toBe("invalid");
    expect(await refusal(() => readTemplateExport('{"kind":"other","v":1,"templates":[]}'))).toBe(
      "invalid",
    );
    expect(
      await refusal(() =>
        readTemplateExport('{"kind":"skysend-request-templates","v":2,"templates":[]}'),
      ),
    ).toBe("invalid");
    const many = JSON.stringify({
      kind: "skysend-request-templates",
      v: 1,
      templates: Array.from({ length: MAX_TEMPLATES_PER_EXPORT + 1 }, () => access),
    });
    expect(await refusal(() => readTemplateExport(many))).toBe("tooLarge");
    expect(await refusal(() => readTemplateExport(" ".repeat(MAX_EXPORT_BYTES + 1)))).toBe(
      "tooLarge",
    );
  });

  it("refuses a sealed export with a salt or a nonce of the wrong length", async () => {
    const sealed = JSON.parse(
      await exportTemplates([access], { password: "pw", argon2id: fakeArgon2 }),
    );
    sealed.sealed.salt = toBase64url(new Uint8Array(8));
    expect(await refusal(() => readTemplateExport(JSON.stringify(sealed)))).toBe("invalid");
  });

  it("refuses a sealed export inside a sealed export", async () => {
    const inner = await exportTemplates([access], { password: "pw", argon2id: fakeArgon2 });
    const { sealWithPassword } = await import("@skysend/crypto");
    const box = await sealWithPassword(
      new TextEncoder().encode(inner),
      "pw",
      "skysend-request-templates-v1",
      fakeArgon2,
    );
    const outer = JSON.stringify({
      kind: "skysend-request-templates",
      v: 1,
      sealed: {
        salt: toBase64url(box.salt),
        nonce: toBase64url(box.nonce),
        ciphertext: toBase64url(box.ciphertext),
      },
    });
    const read = readTemplateExport(outer);
    if (!read.sealed) throw new Error("expected a sealed export");
    expect(await refusal(() => openTemplateExport(read.box, "pw", fakeArgon2))).toBe("invalid");
  });

  it("carries an export in the fragment of a link and reads it back", async () => {
    const json = await exportTemplates([{ ...access, name: "Zugang für Ümlaute" }]);
    const link = templatesLink(json, "https://send.example");
    const url = new URL(link);
    expect(url.pathname).toBe("/templates");
    expect(url.search).toBe("");
    expect(readTemplatesLink(url.hash.slice(1))).toBe(json);
  });

  it("refuses a link whose fragment is no export", async () => {
    expect(await refusal(() => readTemplatesLink("not base64!"))).toBe("invalid");
    expect(await refusal(() => readTemplatesLink(toBase64url(new Uint8Array([0xff, 0xfe]))))).toBe(
      "invalid",
    );
    expect(await refusal(() => readTemplatesLink("A".repeat(MAX_EXPORT_BYTES * 2)))).toBe(
      "tooLarge",
    );
  });
});

describe("exports made by v3.0", () => {
  const { password, plain, sealed, templates } = frozen.templateExport;

  it("still reads a plain export", () => {
    expect(readTemplateExport(plain)).toEqual({ sealed: false, templates, skipped: 0 });
  });

  it("still opens a sealed export with its password and the real Argon2id", async () => {
    const read = readTemplateExport(sealed);
    if (!read.sealed) throw new Error("expected a sealed export");
    expect(await openTemplateExport(read.box, password, hashWasmArgon2)).toEqual({
      templates,
      skipped: 0,
    });
  }, 30_000);
});

describe("export limits", () => {
  it("makes no export with more templates than an import takes", async () => {
    const many = Array.from({ length: MAX_TEMPLATES_PER_EXPORT + 1 }, () => access);
    expect(await refusal(() => exportTemplates(many))).toBe("tooLarge");
    expect(await refusal(() => exportTemplates(many.slice(1)))).toBeUndefined();
  });

  it("makes no export larger than an import takes, sealed ones included", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      label: `${i}`.padEnd(99, "x"),
      value: "",
    }));
    const wide: TemplateFields = {
      name: "Wide",
      asks: ["note"],
      note: { v: 1, blocks: [{ type: "password", entries }] },
    };
    const plain = await exportTemplates(Array.from({ length: 120 }, () => wide));
    expect(new TextEncoder().encode(plain).length).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
    // Sealing makes it a third larger, which no longer fits.
    expect(
      await refusal(() =>
        exportTemplates(
          Array.from({ length: 120 }, () => wide),
          {
            password: "pw",
            argon2id: fakeArgon2,
          },
        ),
      ),
    ).toBe("tooLarge");
  });
});

describe("templateSummary", () => {
  const translate = (key: string, options?: Record<string, unknown>) =>
    options ? `${key}(${Object.values(options).join(",")})` : key;

  it("names the kind, the fields and the limits of a template", () => {
    expect(templateSummary(access, translate)).toBe(
      `request.asksBoth · Username · request.submissionsCount(5) · ${formatBytes(1024 ** 3)} · ${formatDuration(259_200)}`,
    );
    expect(templateSummary({ name: "Free", asks: ["note"] }, translate)).toBe(
      "request.asksNote · templates.freeNote",
    );
    expect(
      templateSummary(
        { name: "Tax", asks: ["files"], limits: { expireSec: 86_400, sends: 3, maxSize: 1024 } },
        translate,
      ),
    ).toBe(
      `request.asksFiles · templates.uploadsUpTo(3,${formatBytes(1024)}) · ${formatDuration(86_400)}`,
    );
  });

  it("counts the fields it does not show", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ label: `F${i}`, value: "" }));
    const summary = templateSummary(
      { name: "Many", asks: ["note"], note: { v: 1, blocks: [{ type: "password", entries }] } },
      translate,
    );
    expect(summary).toBe("request.asksNote · F0, F1, F2, F3 +2");
  });
});

describe("link import handover", () => {
  it("holds the export of a link in memory until it is cleared", () => {
    setLinkImport('{"kind":"skysend-request-templates"}');
    expect(peekLinkImport()).toBe('{"kind":"skysend-request-templates"}');
    setLinkImport(null);
    expect(peekLinkImport()).toBeNull();
  });
});
