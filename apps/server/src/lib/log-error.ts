import { DrizzleQueryError } from "drizzle-orm";

/**
 * An error in a form that is safe to log. Nothing that identifies a user or opens an upload may
 * reach the log, see rule 8 of the root CLAUDE.md:
 *
 * - A failed Drizzle query writes its bound parameters into its message and stack, auth and
 *   owner tokens among them, so it is logged by the cause the database gave, which names the
 *   table and the constraint but no value.
 * - openid-client keeps the token response and the claims of an ID token in `cause` and other
 *   fields, so an error is logged by its name, message and stack only, plus the OAuth error code
 *   an identity provider sent.
 */
export function describeError(err: unknown): string {
  if (err instanceof DrizzleQueryError) {
    const cause = err.cause instanceof Error ? err.cause : undefined;
    const code = cause && "code" in cause ? ` (${String(cause.code)})` : "";
    return `Database query failed${code}: ${cause?.message ?? "no cause given"}`;
  }
  if (err instanceof Error) {
    const oauthError = "error" in err && typeof err.error === "string" ? ` [${err.error}]` : "";
    return `${err.stack ?? `${err.name}: ${err.message}`}${oauthError}`;
  }
  return typeof err === "string" ? err : "Unknown error";
}
