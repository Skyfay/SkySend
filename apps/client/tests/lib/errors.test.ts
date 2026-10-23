import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFor } from "../../src/lib/api.js";
import { ApiError } from "../../src/lib/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every request gets this error back from the server. */
function serverSays(status: number, error: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

describe("ApiError", () => {
  it("carries the status and the message of the server", async () => {
    serverSays(404, "Not found");
    const err = await apiFor("https://send.example.com")
      .fetchInfo("abc")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect((err as ApiError).name).toBe("ApiError");
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("Not found");
  });

  it("disarms escape sequences a server puts into its error message", async () => {
    serverSays(403, "Denied\x1b]52;c;Y3VybCBldmlsLnNofHNo\x07\r\x1b[2KAll good");
    const err = await apiFor("https://send.example.com")
      .deleteUpload("abc", "owner")
      .catch((e: unknown) => e as ApiError);

    // eslint-disable-next-line no-control-regex
    expect(err.message).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
    expect(err.message).toBe("Denied�]52;c;Y3VybCBldmlsLnNofHNo���[2KAll good");
  });
});
