import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";

describe("ApiError", () => {
  it("sets status and message", () => {
    const err = new ApiError(404, "Not found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
  });

  it("has name 'ApiError'", () => {
    const err = new ApiError(500, "Internal server error");
    expect(err.name).toBe("ApiError");
  });

  it("is an instance of Error", () => {
    const err = new ApiError(401, "Unauthorized");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of ApiError", () => {
    const err = new ApiError(400, "Bad request");
    expect(err).toBeInstanceOf(ApiError);
  });
});
