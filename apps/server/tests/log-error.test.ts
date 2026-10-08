import { afterEach, describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { createTestDb, insertTestUpload } from "./helpers.js";
import { uploads } from "../src/db/schema.js";
import { describeError } from "../src/lib/log-error.js";

describe("describeError", () => {
  let dbCtx: ReturnType<typeof createTestDb> | undefined;

  afterEach(() => {
    dbCtx?.cleanup();
    dbCtx = undefined;
  });

  it("logs a failed query of the better-sqlite3 driver by its cause, with no value in it", async () => {
    dbCtx = createTestDb();
    const authToken = "AUTH-TOKEN-THAT-MUST-NOT-BE-LOGGED";
    const ownerToken = "OWNER-TOKEN-THAT-MUST-NOT-BE-LOGGED";
    const row = insertTestUpload(dbCtx.db, { authToken, ownerToken });

    let thrown: unknown;
    try {
      // The same id again breaks the primary key, with both tokens among the parameters.
      await dbCtx.db.insert(uploads).values(row);
    } catch (err) {
      thrown = err;
    }
    const logged = describeError(thrown);
    expect(logged).toContain("UNIQUE constraint failed: uploads.id");
    expect(logged).not.toContain(authToken);
    expect(logged).not.toContain(ownerToken);
  });

  it("logs a query Drizzle wrapped with its parameters by the cause alone", () => {
    const authToken = "AUTH-TOKEN-THAT-MUST-NOT-BE-LOGGED";
    const cause = Object.assign(new Error("UNIQUE constraint failed: uploads.id"), {
      code: "SQLITE_CONSTRAINT_PRIMARYKEY",
    });
    // Drizzle's async drivers wrap a failure like this, parameters in the message and stack.
    const err = new DrizzleQueryError("insert into uploads values (?, ?)", [authToken, "x"], cause);
    expect(`${err.message}${err.stack}`).toContain(authToken);

    const logged = describeError(err);
    expect(logged).toBe(
      "Database query failed (SQLITE_CONSTRAINT_PRIMARYKEY): UNIQUE constraint failed: uploads.id",
    );
  });

  it("says no cause was given for a failed query that carries none, and still no value", () => {
    const authToken = "AUTH-TOKEN-THAT-MUST-NOT-BE-LOGGED";
    const err = new DrizzleQueryError("select * from uploads where id = ?", [authToken]);
    expect(describeError(err)).toBe("Database query failed: no cause given");
  });

  it("logs the cause of a failed query without a code when the database gave none", () => {
    const err = new DrizzleQueryError("select 1", [], new Error("disk I/O error"));
    expect(describeError(err)).toBe("Database query failed: disk I/O error");
  });

  it("leaves out what openid-client keeps beside the message, and keeps the OAuth error code", () => {
    const err = Object.assign(new Error("server responded with an error in the response body"), {
      name: "ResponseBodyError",
      error: "invalid_grant",
      cause: { id_token: "eyJ.secret.jwt", claims: { email: "alice@example.com", sub: "user-42" } },
    });
    const logged = describeError(err);
    expect(logged).toContain("server responded with an error");
    expect(logged).toContain("[invalid_grant]");
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain("eyJ.secret.jwt");
    expect(logged).not.toContain("user-42");
  });

  it("keeps the stack of an ordinary error for debugging", () => {
    const logged = describeError(new TypeError("boom"));
    expect(logged).toContain("TypeError: boom");
    expect(logged).toContain("log-error.test.ts");
  });

  it("falls back to the name and message of an error without a stack", () => {
    const err = new RangeError("out of range");
    err.stack = undefined;
    expect(describeError(err)).toBe("RangeError: out of range");
  });

  it("never prints an error field that is no OAuth error code", () => {
    const err = Object.assign(new Error("token request failed"), {
      error: { id_token: "eyJ.secret.jwt" },
    });
    err.stack = undefined;
    expect(describeError(err)).toBe("Error: token request failed");
  });

  it("does not print an object that is no error", () => {
    expect(describeError({ token: "secret" })).toBe("Unknown error");
    expect(describeError("plain text")).toBe("plain text");
  });
});
