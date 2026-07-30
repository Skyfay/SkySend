# Web SPA

React 19 + Vite 8 + TypeScript, Tailwind CSS v4, **Shadcn UI** (Radix + cva under the hood), react-router 8, i18next, Sonner. Package name `@skysend/web`.

This app owns **all** encryption and decryption. The server is a dumb blob store, so a bug here is a privacy bug, not a rendering bug.

## The boundary

The 32-byte secret lives in the URL fragment and nowhere else that leaves the machine:

```
https://host/file/<id>#<secret>          window.location.hash.slice(1)
https://host/note/<id>#<secret>
```

- Never put the secret, a derived key, a filename, or note content into a request path, query string, header, or body.
- Never log any of them, including in `catch` blocks. `console.warn` for a browser capability probe is fine, a value is not.
- `upload-store.ts` persists `{ id, ownerToken, secret, fileNames, name }` in IndexedDB via `idb-keyval` for the "My Uploads" page. That store is local-only, and the optional `name` never leaves the browser.
- Filenames and MIME types are encrypted client-side into `encryptedMeta` before the `POST /api/meta/:id` call.

## Layout

```
src/main.tsx        Entry, imports i18n before rendering
src/App.tsx         Router + provider stack (ErrorBoundary > Theme > Tooltip > ServerConfig)
src/pages/          Upload, Download, NoteView, MyUploads, NotFound
src/components/     Feature components (PascalCase)
src/components/ui/  Radix + cva primitives, 15 of them
src/hooks/          One hook per flow: useUpload, useDownload, useNoteUpload, useNoteView, ...
src/lib/            api client, crypto glue, workers, toast helpers, utils
src/i18n/           i18next setup + 13 locale JSON files
```

Routes: `/` upload, `/file/:id` download, `/note/:id` note, `/uploads` local history, `/d/:id` legacy redirect that manually forwards the hash because `<Navigate>` drops it.

## Server config

`ServerConfigProvider` fetches `/api/config` once and exposes it through `useServerConfig()`. Everything the operator can configure - enabled services, size and expiry options, forced passwords, default tab, custom branding, OIDC flags - arrives that way.

Never hardcode a limit or an option list that the server already sends. When the server gains a config field, add it to `configResponseSchema` in `src/lib/api.ts` as well, with `.optional().default(...)` so an older server does not break a newer SPA.

The provider also applies `defaultTheme` (only when the user has no stored preference) and injects `customColor` as a style element.

## API client

`src/lib/api.ts` is the only place that talks to the server. Every response is parsed with a Zod schema before it reaches a component - a raw `await res.json()` in a hook or component is a bug. Failures throw `ApiError` carrying the HTTP status.

## Crypto pipeline

All of it comes from `@skysend/crypto`. Do not reimplement key derivation or stream framing here.

**Upload** (`hooks/useUpload.ts` + `lib/upload-worker.ts`): the hook generates the secret and salt on the main thread, builds the metadata from `File` objects, then hands the work to a Web Worker that derives keys, encrypts, and uploads. Multi-file uploads are zipped first via `lib/zip.ts` (fflate). Transport is WebSocket when the server advertises `fileUploadWs`, with an HTTP chunk fallback - `debugInfo.transport` records which one ran.

**Download** (`hooks/useDownload.ts` + `lib/opfs-download.ts` + `public/download-sw.js`): three tiers, selected by capability, recorded in `debugInfo.tier`.

| Tier | `tier` | Path | Used for |
| :--- | :--- | :--- | :--- |
| 1 | `sw` | The Service Worker does everything inside `respondWith()`: fetch, HKDF, ECE decrypt, streaming `Response` to the download manager | All modern browsers except Safari |
| 2 | `file-picker` | `showSaveFilePicker` plus a streaming write on the main thread | Chrome and Edge, when tier 1 fails |
| 3 | `blob` | Full file assembled in memory | Last resort, and Safari by default |

Tier 1 is the only shape that gets real backpressure in Firefox, which is why `download-sw.js` reimplements the ECE constants instead of importing them. Those constants must stay in sync with `@skysend/crypto`.

Safari is excluded from tier 1 deliberately - it terminates Service Workers early and buffers stream responses in RAM. A Safari download over `SAFARI_BIG_SIZE` shows a warning first. Firefox with DevTools open gets its own warning because the network panel buffers the response.

`useDownload` only imports `ensureSwController` and `streamDownloadViaSw` from `lib/opfs-download.ts`. The OPFS-worker pipeline in that file (`checkOpfsSupport`, `startOpfsDownload`, `triggerSwDownload`, `triggerBlobDownload`, and all of `lib/opfs-worker.ts`) is not reachable from the app today - read the hook, not those functions, when reasoning about what actually runs.

`docs/developer-guide/download-modes.md` is the long-form version and has to be updated whenever the tier logic changes.

**Passwords**: Argon2id via `hash-wasm`, wired up in `lib/argon2.ts` and passed into the crypto package as an `Argon2idHashFn`. This is why the CSP allows `wasm-unsafe-eval`.

Workers are plain modules under `src/lib/` loaded with Vite's worker syntax. They cannot touch the DOM and they must not import from `src/components/`.

## Toasts

Helpers live in `src/lib/toast.tsx`. Never call `alert()` or `confirm()`.

**Simple toasts** - call Sonner directly:

```ts
import { toast } from "sonner";
toast.success(t("myUploads.deleteSuccess"));
toast.error(t("download.wrongPassword"), { id: "password-error" });
```

**Toasts with a Copy or Docs button** - use `showToast()`:

```ts
import { showToast } from "@/lib/toast";
showToast(t("errors.insecureContext"), {
  type: "error",
  description: rawErrorMessage,
  copyText: rawErrorMessage,
  docsUrl: "https://docs.skysend.app/user-guide/troubleshooting#...",
});
```

**Raw errors from the crypto pipeline** - always `showKnownErrorToast()`, never `toast.error()`:

```ts
import { showKnownErrorToast } from "@/lib/toast";
showKnownErrorToast(hook.error);   // string, not an Error object
```

It matches the message against the known patterns and enriches those with a docs link and a copy button, falling back to `toast.error()` otherwise. Currently recognised: insecure context (`crypto.subtle` missing over HTTP), `Origin not allowed` from the WebSocket upload, and S3 CORS failures.

Adding a pattern means five edits, in this order: a troubleshooting section in `docs/user-guide/troubleshooting.md`, an `errors.*` key in `en.json` and `de.json` plus the 11 AI locales, a detector and a branch in `showKnownErrorToast()`, a row in the table in `docs/developer-guide/toast-system.md`, and a changelog entry. The `/add-known-error-toast` skill walks through it.

Architecturally, `showToast()` always goes through Sonner's own `toast.error()` / `toast.warning()` / etc. When `copyText` or `docsUrl` is set it passes a `ToastActionButtons` node as the `description`, so Sonner keeps its close button, animation, and layout. There is no `toast.custom()` call.

## i18n

Files in `src/i18n/`. `en.json` and `de.json` are the source of truth - add every new key to both by hand. The other 11 locales (`es`, `fr`, `fi`, `it`, `ja`, `nb`, `nl`, `pl`, `pt-BR`, `sv`, `zh`) are AI-translated.

JSON has no comments, so each non-EN/DE file carries a top-level `__meta` block:

- `"aiGenerated": true` - the whole file is AI-generated and unreviewed. Adding a key needs no extra bookkeeping.
- `"aiGeneratedKeys": [...]` - only these dot-notation keys are AI-generated, the rest came from a human. A new AI translation must be appended to that array.

Never remove a `__meta` block and never set `aiGenerated: false` yourself. Only a native speaker who reviewed the whole file may clear the flag, via pull request.

Detection order is `navigator` then `htmlTag`, with `en` as the fallback, so `de-CH` resolves to `de` through the fallback chain. A user's explicit choice is stored in the `skysend-lang` cookie and applied after init - browser detection never overrides it.

No user-facing string is hardcoded in a component. Errors that surface as toasts are keys too.

## UI and design system

### Always reach for the Shadcn primitive first

`src/components/ui/` holds the Shadcn UI components. **Use them instead of the browser-native element, and instead of a hand-rolled div.** This is the single most important rule in this section - a native control looks fine on your machine and wrong on Windows, in dark mode, or against the operator's `CUSTOM_COLOR`.

The 15 available primitives:

`button` · `card` · `custom-toast` · `dialog` · `input` · `label` · `progress` · `scroll-area` · `select` · `skeleton` · `sonner` · `switch` · `textarea` · `toast` · `tooltip`

Never hand-roll what already exists:

| Do not use | Use |
| :--- | :--- |
| a raw `overflow-y-auto` / `overflow-auto` div | `<ScrollArea>` |
| the native `title="..."` attribute | `<Tooltip>` |
| `<select>` | `<Select>` |
| an unstyled `<button>` for a real action | `<Button>` |
| a styled `<div>` acting as a card or panel | `<Card>` |
| `alert()`, `confirm()`, `window.prompt()` | a `<Dialog>` or a toast |
| a bare centered spinner while content loads | `<Skeleton>` shaped like the content |

The native elements that remain are deliberate and narrow: icon-only affordances and segmented tab bars use a plain `<button>`, and `<input>` survives only for the types the `Input` primitive does not cover (`type="file"` in `UploadZone`, `type="range"` in `PasswordGenerator`, the search field in `LanguageSwitcher`, task-list checkboxes in `markdownComponents`). Those are the exceptions, not the pattern to copy.

Before writing a new primitive, check whether an existing one plus a variant covers it.

### Adding or updating a primitive

There is **no `components.json` in `apps/web`**, so the `npx shadcn add` CLI is not wired up here (only `website/` has it). A new primitive is copied in from the Shadcn source by hand and adapted to this codebase: `@/lib/utils` for `cn`, the semantic tokens below, and the project's import style. Add the matching `@radix-ui/*` package to `apps/web/package.json` in the same change.

Some primitives are deliberately forked from stock Shadcn. **Never overwrite one with a fresh upstream copy** - `scroll-area.tsx` is the clearest case, it adds a `viewportClassName` prop that does not exist upstream and that half the app depends on.

### ScrollArea

Any container that can overflow uses `<ScrollArea>` from `@/components/ui/scroll-area`. A raw `overflow-y-auto` div renders the native OS scrollbar right next to the styled Radix one everywhere else.

A max-height goes on the **viewport**, through this wrapper's own `viewportClassName` prop, not on the root:

```tsx
<ScrollArea viewportClassName="max-h-60">…</ScrollArea>
<ScrollArea className="mt-1" viewportClassName="max-h-40">…</ScrollArea>
```

The viewport is `h-full`, and a percentage height cannot resolve against an auto-height parent, so a `max-h-*` on the root only clips and never enables scrolling. A fixed `h-*` on the root (`<ScrollArea className="h-60">`) works either way. Inside a flex parent, use `className="flex-1 min-h-0"` - without `min-h-0` the child refuses to shrink and the page grows instead of scrolling.

A handful of `prose` and `<pre>` blocks still use plain `overflow-auto` with the `scrollbar-thin` class. That is the deliberate exception for rendered markdown and code, not a precedent for new panels.

### Colors

Use the semantic tokens from `src/index.css`: `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-destructive`, `bg-success`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`. They are defined in oklch for light and overridden under `.dark`, so they are already theme-aware. `--color-primary` is what `CUSTOM_COLOR` overrides at runtime, which is another reason not to hardcode a brand color.

A raw palette color (`text-green-600`, `bg-red-100`) always needs a `dark:` variant. Verify in dark mode before finishing.

### Styling conventions

- `Button` variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`, `icon`. Extend the `cva` config rather than passing a wall of overriding classes.
- Compose conditional classes with `cn()` from `@/lib/utils`, never template strings.
- Icons come from `lucide-react`. `h-4 w-4` inline with text, `h-5 w-5` standalone.
- Tailwind is mobile-first: unprefixed classes are the small screen, `sm:` and up widen.
- No inline `style` except genuinely computed values. The two that exist (a computed line-number width and the progress transform) are the reason the CSP still allows `unsafe-inline` styles, so do not add a third.
- `formatBytes`, `formatDuration`, and `formatTimeRemaining` live in `@/lib/utils`. Check there before writing a new formatter.

### Before finishing UI work

1. Every overflowing container is a `ScrollArea`, with the cap on `viewportClassName` and `min-h-0` on flex children.
2. No native element where a primitive exists - no `title=`, no `<select>`, no `alert()` or `confirm()`.
3. Raw palette colors carry a `dark:` variant, and the screen was actually checked in dark mode.
4. Nothing hardcodes the brand color, so `CUSTOM_COLOR` still works.
5. Every user-facing string is an i18n key, present in `en.json` and `de.json`.

## Testing

Vitest, files in `apps/web/tests/`, run with `pnpm --filter @skysend/web test`. There is no global jsdom environment - a test that needs the DOM starts with `// @vitest-environment jsdom` on line 1.

Hooks are the test surface. `vite.config.ts` scopes coverage to `src/lib/**` and `src/hooks/**` and excludes the browser-only modules (workers, OPFS, argon2, ssh-keygen, zip, and the HTTP client).

- Mock `Worker`, `fetch`, and OPFS. The existing `MockWorker` in `tests/hooks/useUpload.test.ts` is the pattern to copy.
- A mocked API response must match the real Zod schema. A mock that returns a looser shape passes the test and lies about production.
- Name the case, not the function: `it("falls back to HTTP when the WebSocket upgrade fails")`.
- Never put a real secret, token, or instance URL into a test, not even commented out.
