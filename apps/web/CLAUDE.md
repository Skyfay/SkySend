# Web SPA

React 19 + Vite 8 + TypeScript, Tailwind CSS v4, **Shadcn UI** (Radix + cva under the hood), react-router 8, i18next, Sonner. Package name `@skysend/web`.

This app owns **all** encryption and decryption. The server is a dumb blob store, so a bug here is a privacy bug, not a rendering bug.

## The boundary

The 32-byte secret lives in the URL fragment and nowhere else that leaves the machine:

```
https://host/file/<id>#<secret>          window.location.hash.slice(1)
https://host/note/<id>#<secret>
https://host/request/<id>#<pk+linkSecret>  upload link of a file request, for the sender
https://host/inbox/<id>#<inboxSecret>      inbox link of a file request, for the requester
```

- Never put the secret, a derived key, a filename, or note content into a request path, query string, header, or body.
- Never log any of them, including in `catch` blocks. `console.warn` for a browser capability probe is fine, a value is not.
- `upload-store.ts` persists `{ id, ownerToken, secret, fileNames, name }` in IndexedDB via `idb-keyval` for the "My Links" page. That store is local-only, and the optional `name` never leaves the browser.
- It also keeps the file requests made in this browser, `{ id, inboxFragment, uploadFragment, hasPassword, title, asks, closesAt, createdAt, seenUploads }`. For a request with a password it keeps no token beside the fragment, since a token next to a protected secret would let anyone with the store test passwords offline.
- `lib/defaults.ts` keeps what the forms start with in `localStorage` (`skysend-defaults`), read through Zod like any stored text: expiry, limit and whether a password starts on for files and notes, and expiry, sends, size, downloads and password for requests. A value the server no longer offers falls back to the server's default (`pickOption`), and a forced password always wins. It never holds a password itself.
- And the request templates of this browser under `template:`, `{ id, name, asks, title?, note?, limits?, createdAt, usedAt? }`. Every read goes through `readStoredTemplate` in `lib/request-templates.ts`, the same check an import gets, so a template never holds a value.
- The public key of a request only ever comes from the upload link. Never take it from the server, which could swap in its own.
- Filenames and MIME types are encrypted client-side into `encryptedMeta` before the `POST /api/meta/:id` call.

## Layout

```
src/main.tsx        Entry, imports i18n before rendering
src/App.tsx         Router + provider stack (ErrorBoundary > Theme > Tooltip > ServerConfig)
src/pages/          Upload, Download, NoteView, MyUploads, Requests, Inbox, RequestUpload, TemplatesLink, Settings, HowItWorks, NotFound
src/components/     Feature components (PascalCase)
src/components/ui/  Radix + cva primitives, 21 of them
src/hooks/          One hook per flow: useUpload, useDownload, useNoteUpload, useNoteView, ...
src/lib/            api client, crypto glue, workers, toast helpers, utils
src/i18n/           i18next setup + 13 locale JSON files
```

Routes: `/` upload, `/file/:id` download, `/note/:id` note, `/uploads` My Links, the local history with a Shared and a Requests tab (`?tab=requests`), `/settings` the settings of this browser with a Defaults and a Templates tab (`?tab=templates`), `/requests` the form for a new file request (`?template=<id>` starts from a template, `?edit=<id>` edits one), `/templates#<export>` a templates link that goes on to the import, `/inbox/:id` the inbox of a request, `/request/:id` the upload page for a sender, `/how` the How it works page, `/d/:id` legacy redirect that manually forwards the hash because `<Navigate>` drops it.

`/api/config` reports file requests as `fileRequestsEnabled`, apart from `enabledServices`, which stays `file` and `note` for older CLI clients. An instance with only requests enabled sends `/` on to `/requests`.

## Server config

`ServerConfigProvider` fetches `/api/config` once and exposes it through `useServerConfig()`. Everything the operator can configure - enabled services, size and expiry options, forced passwords, default tab, custom branding, OIDC flags - arrives that way.

Never hardcode a limit or an option list that the server already sends. When the server gains a config field, add it to `configResponseSchema` in `packages/transfer/src/api.ts`, with `.optional().default(...)` so an older server does not break a newer SPA.

The server writes `DEFAULT_THEME` (`data-theme`) and `DEFAULT_COLOR_SCHEME` (`data-default-color-scheme`) into `index.html`, and `public/theme-init.js` applies them before the first paint, so the provider does not touch either. It injects the accent derived from `customColor` as a style element.

## API client

`src/lib/api.ts` is the only place that talks to the server. It binds the shared client of `@skysend/transfer` (`createApiClient`, schemas, `ApiError`) to the page's own origin and keeps the function names the hooks use. Every response is parsed with a Zod schema before it reaches a component - a raw `await res.json()` in a hook or component is a bug. Failures throw `ApiError` carrying the HTTP status.

## Crypto pipeline

All of it comes from `@skysend/crypto`. Do not reimplement key derivation or stream framing here.

**Upload** (`hooks/useUpload.ts` + `lib/upload-worker.ts`): the hook generates the secret and salt on the main thread, builds the metadata from `File` objects, then hands the work to a Web Worker that derives keys, encrypts, and uploads. Several files go up as one zip that `zipStream` from `@skysend/transfer` writes while the upload reads it: stored without compression, so its size is known before the first byte, ZIP64 from 4 GiB on, CRC-32 sliced by 8 bytes at about 1.4 GiB/s. The names in the zip come from the metadata, because WebKit drops `webkitRelativePath` when it posts a File to a worker, which flattened folders in WebKit before. `lib/archive.ts` builds that metadata through `archiveMetadata` of `@skysend/transfer`, naming each File by its `webkitRelativePath`, and the pages and `useUpload` check it against `MAX_ENCRYPTED_METADATA_BYTES` before an upload, since the server only gets the metadata at the end. Do not go back to packing before the upload: fflate's deflate held a zip of 3 GiB in memory for a minute (51 MiB/s, 3.5 GiB more RAM in Chromium) where the stream takes 15 s and 180 MiB, and it wrote no ZIP64. Transport is WebSocket when the server advertises `fileUploadWs`, with an HTTP chunk fallback - `debugInfo.transport` records which one ran. The worker is an adapter around `uploadEncrypted` of `@skysend/transfer`, which the CLI runs too: key derivation, encryption, both transports and the chunk window live there, the worker turns its events into `postMessage` and keeps the `[upload-worker] transport=` console line that the E2E fixture `uploadTransports` reads. The HTTP transport never sends more than `CHUNK_WINDOW` chunks past the oldest open one, so a chunk a proxy holds back makes it wait instead of running into the server's 64 pending chunks and a 429.

**File requests** (`lib/file-request.ts`, `hooks/useFileRequests.ts`, `hooks/useInbox.ts`, `hooks/useRequestUpload.ts`): the requester's browser creates the key pair, the sealed vault and the encrypted brief, and the server gets only those and three derived tokens. The brief says whether files, a note or both are asked for, and carries the note template the form lays out with `BlockListEditor` in `template` mode. A sender fills it in with the same editors in `fill` mode (`RequestNoteForm`), and `useRequestUpload` sends the note through `useUpload` as one padded upload with metadata `{ type: "note" }`. A request for both takes files and a note in one send: two uploads, files first, whose metadata share a random `submission`, so the inbox lists them together. Every other upload into a request gets a random `submission` of its own, so metadata lengths match. A submission takes two uploads of the request, which the form and the counters show as one. The files reserve both at init (`reserveNext`), and their finalize returns a `hold` for the note's slot, which `useRequestUpload` keeps for the note, a retry included. The inbox opens a note in memory only (`readInboxNote`, `InboxNoteDialog`), after checking its size against `noteMaxSize`, and renders it with `NoteBlocks`. A sender uploads through `useUpload` with a `request` option, which makes the worker take the same transports as a normal upload into `/api/request/:id/upload/*`, WebSocket first and chunked HTTP as the fallback, wrap the file secret to the request's public key at finalize, and skip the share link and My Links. The inbox opens every upload on its own, so a damaged or crafted one does not hide the others, every name from a sender goes through `sanitizeFilename` before it is shown or saved, and the title goes through `sanitizeTitle` before a sender sees it. Request templates (`lib/request-templates.ts`, `hooks/useRequestTemplates.ts`) keep the setup of the form, never a password or a value. `RequestForm` starts from one, saves one (`SaveTemplateDialog`) and edits one, and the Templates tab of the settings (`TemplateList`) exports and imports them as a file or a `/templates#` link, sealed with `sealWithPassword` when a password is set. An import is untrusted input: Zod, then `parseTemplate`, `cleanLabel` and `sanitizeTitle`, then the brief limit. `useUnseenUploads` in the layout checks up to the 20 newest stored requests without a password that are open or closed less than a day ago, every 5 minutes while the page is visible, and feeds `lib/unseen-uploads.ts`, the counts behind the dot beside My Links and its Requests tab. A 404 for a stored request forgets it only once `requestOutlived` says every upload in it ran out, judged by `fileRequestRetention`, since the stored inbox link is often the only copy. An inbox password and the password of a template export need `meetsPasswordMinimum`, like a file password. Opening an inbox writes the IDs it listed to `seenUploads`, only for the link this browser stored.

**Download** (`hooks/useDownload.ts` + `lib/download-tiers.ts` + `lib/sw-download.ts` + `lib/opfs-file.ts` + `public/download-sw.js`): four tiers, selected by capability, recorded in `debugInfo.tier`. `saveDecryptedDownload` in `lib/download-tiers.ts` runs them for a normal download and for a file in an inbox alike. The two differ only in the endpoint and the token header, which the Service Worker takes from an allowlist of `X-Auth-Token` and `X-Inbox-Token`.

| Tier | `tier` | Path | Used for |
| :--- | :--- | :--- | :--- |
| 1 | `sw` | The Service Worker does everything inside `respondWith()`: fetch, HKDF, ECE decrypt, streaming `Response` to the download manager | All modern browsers except Safari |
| 2 | `file-picker` | `showSaveFilePicker` plus a streaming write on the main thread | Chrome and Edge, when tier 1 fails |
| 3 | `opfs` | Plaintext written to an OPFS file by a worker (`lib/opfs-file-worker.ts`), then handed over as a download from disk | Safari, and any browser without tiers 1 and 2 |
| 4 | `blob` | Full file assembled in memory | Last resort, like Safari in a private window |

The page hands the download config to the Service Worker with `postMessage` on the worker, since that starts a worker the browser stopped after half a minute without work. A BroadcastChannel message alone never reaches a stopped worker, which made Firefox fall back from tier 1 whenever the page had sat open that long, v3.0.1 included. `service-worker.spec.ts` checks it in Firefox with a one second idle timeout. The worker is registered as `/download-sw.js?v=<version>` (`DOWNLOAD_SW_URL`): a browser looks for a new worker only when it navigates into the scope, which here is the download, so an old worker that failed tier 1 was never replaced after a release, while a new URL in `register()` makes it fetch the script. A build between releases keeps the URL, which matters only to whoever tests it. The config is sent again over the BroadcastChannel every 250 ms until a worker answers, which a worker of the release before needs. Tier 1 is the only shape that gets real backpressure in Firefox, which is why `download-sw.js` reimplements the ECE constants instead of importing them. Those constants must stay in sync with `@skysend/crypto`.

The Service Worker is registered for the scope `/__skysend_download__/` alone (`DOWNLOAD_SW_SCOPE` in `lib/sw-download.ts`), so it controls no page and sees no upload, and `ensureSwController()` waits for its active worker, never for `navigator.serviceWorker.controller`. Do not widen the scope: registered for the whole origin, its fetch handler held the Blob bodies of chunked uploads until Chromium ran out of blob memory at 1 to 2 GiB in an incognito window.

Safari is excluded from tier 1 deliberately: it never streams a Service Worker response into a download, a test on Safari 27 stayed at zero bytes. It takes tier 3 instead, which brought down 2.5 GB at 124 MB/s with Safari at about 300 MB of memory, where tier 4 crashed the tab. Tier 3 checks before anything is fetched that OPFS works from end to end and that the quota holds the file (`opfsFits`), since a fetch uses up a download of a limited share and a failure after it must not fall through. WebKit on Linux reads back an empty OPFS file, so the end-to-end tests see WebKit on tier 4, not Safari's tier 3. A Safari download over `SAFARI_BIG_SIZE` shows a warning first only when `opfsFits` says no. Brave reports a quota of exactly 2 GiB whatever it allows, so `opfsFits` does not hold that number against a file: a normal Brave profile took 3.2 GB in a test. Every tier that is passed over leaves its reason in the timeline of the debug panel (`pass()` in `download-tiers.ts`), which is how a Service Worker stopped by a certificate error shows up in a report. The OPFS file holds plaintext, so keep its removal: after the handover, and the files older than an hour at the next download. Firefox with DevTools open gets its own warning because the network panel buffers the response.

An earlier OPFS pipeline that handed its file to the Service Worker is gone, since Safari cannot take a download from a Service Worker. Do not bring that handover back.

Name and type of a download are the sender's word. `useDownload` and `useInbox` clean the name with `sanitizeFilename` before it is saved, and `DownloadCard` shows it cleaned, so a right-to-left override cannot dress an exe up as a pdf. Tier 4 makes its Blob `application/octet-stream` whatever the type: a `blob:` URL belongs to the origin, and a browser that ignores the `download` attribute opens it as a page of the instance. The page's CSP blocks scripts there, a test in Chromium, Firefox and WebKit showed it (2026-10-14), but the HTML still shows. The Service Worker's response carries `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, since a response it builds gets no CSP from the server. Keep all three.

`docs/developer-guide/download-modes.md` is the long-form version and has to be updated whenever the tier logic changes.

**Notes** (`components/NoteComposer.tsx` + `hooks/useNoteUpload.ts`, `hooks/useNoteView.ts`): a note is a list of blocks. The composer edits them, `useNoteUpload` turns them into one document with `serializeNote` from `@skysend/note-format` and hands it to `createEncryptedNote` of `@skysend/transfer`, which the CLI runs too. `useNoteView` opens a note through `openNote`, which checks a password before the view is used up. The server only ever gets `contentType: "blocks"`, so never send a block type, a block count or anything else about the content alongside it. Reading goes through `readNote` inside `openNote`, which also opens notes from before v3. Every block comes from someone else's note, so the renderers in `components/NoteBlocks.tsx` show text as text, Markdown through `rehype-sanitize` and code through the sanitized highlighter in `lib/highlight.ts`. The kinds of a note are kept in IndexedDB for "My Links" only.

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

The look lives in `components/ui/sonner.tsx`: Sonner's own styling is off (`unstyled`), the toasts carry the app's classes, and an `offset` keeps them below the sticky header. Change the look there, not with CSS against Sonner's `data-*` attributes.

## i18n

Files in `src/i18n/`. `en.json` and `de.json` are the source of truth - add every new key to both by hand. The other 11 locales (`es`, `fr`, `fi`, `it`, `ja`, `nb`, `nl`, `pl`, `pt-BR`, `sv`, `zh`) are AI-translated.

JSON has no comments, so each non-EN/DE file carries a top-level `__meta` block:

- `"aiGenerated": true` - the whole file is AI-generated and unreviewed. Adding a key needs no extra bookkeeping.
- `"aiGeneratedKeys": [...]` - only these dot-notation keys are AI-generated, the rest came from a human. A new AI translation must be appended to that array.

Never remove a `__meta` block and never set `aiGenerated: false` yourself. Only a native speaker who reviewed the whole file may clear the flag, via pull request.

Detection order is `navigator` then `htmlTag`, with `en` as the fallback, so `de-CH` resolves to `de` through the fallback chain. A user's explicit choice is stored under the `skysend-lang` localStorage key and applied after init - browser detection never overrides it.

No user-facing string is hardcoded in a component. Errors that surface as toasts are keys too.

## UI and design system

### Always reach for the Shadcn primitive first

`src/components/ui/` holds the Shadcn UI components. **Use them instead of the browser-native element, and instead of a hand-rolled div.** This is the single most important rule in this section - a native control looks fine on your machine and wrong on Windows, in dark mode, or against the operator's `CUSTOM_COLOR`.

The 21 available primitives:

`badge` · `button` · `card` · `checkbox` · `custom-toast` · `dialog` · `dropdown-menu` · `input` · `label` · `popover` · `progress` · `scroll-area` · `select` · `sheet` · `skeleton` · `sonner` · `switch` · `tabs` · `textarea` · `toggle-group` · `tooltip`

`popover` holds a choice at its trigger, `sheet` is a dialog that slides up from the bottom on a phone. `OptionPill` combines them: a setting that shows its value and opens its options in a popover, or in a sheet below the `sm` breakpoint, the way the settings of `ShareOptions`, `RequestForm` and `DefaultsSettings` work. `useMediaQuery` decides which.

`toggle-group` has three variants: `chips` for a short list of options like the expiry times, `segmented` for a switch between two or three modes like Plain and Markdown, and `cards` for two or three choices with a line of explanation each that open no panel, like the format of a template export. Reach for it before writing another row of hand-styled buttons. `tabs` has `segmented` too, plus `cards` for a few big choices with a line of explanation each, like Datei and Notiz.

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

The native elements that remain are deliberate and narrow: icon-only affordances and segmented tab bars use a plain `<button>`, and `<input>` survives only for the types the `Input` primitive does not cover (`type="file"` in `UploadZone`, `type="range"` in `PasswordGenerator`, the search field in `LanguageSwitcher`, task-list checkboxes in `markdownComponents`). The FAQ on the How it works page uses `<details>`, since there is no accordion primitive. Those are the exceptions, not the pattern to copy.

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

Use the semantic tokens from `src/index.css`: `bg-page`, `bg-background`, `bg-card`, `bg-well` (an inset area inside a card), `bg-field` (inputs, never white or black boxes), `bg-popover`, `bg-muted`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-destructive`, `bg-success`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`. They are defined in oklch for light and overridden under `.dark`, so they are already theme-aware. `--color-primary` is what `CUSTOM_COLOR` overrides at runtime, which is another reason not to hardcode a brand color.

A raw palette color (`text-green-600`, `bg-red-100`) always needs a `dark:` variant. Verify in dark mode before finishing.

### Styling conventions

- `Button` variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`, `icon`. Extend the `cva` config rather than passing a wall of overriding classes.
- Compose conditional classes with `cn()` from `@/lib/utils`, never template strings.
- No `blur-*` or `filter: blur()` on a large element. iOS Safari draws a blur on the main thread whenever anything near it repaints or the layers around it change, which held taps for over half a second on an iPhone, and `will-change` did not save it once a menu opened over it. A soft light is `Glow`, whose `glow` class in `index.css` blurs only where a mouse is used and draws a gradient on touch screens. The `overflow-clip` on the root of `Layout` keeps that gradient from widening the page.
- `html` carries `touch-action: manipulation` and `scrollbar-gutter: stable` in `index.css`. The first keeps iOS from holding every tap back while it waits for a double tap, the second keeps the header from moving between pages that scroll and pages that do not. Neither goes away.
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

Hooks are the test surface. `vite.config.ts` scopes coverage to `src/lib/**` and `src/hooks/**` and excludes the browser-only modules (workers, OPFS, argon2, ssh-keygen, and the HTTP client).

- Mock `Worker`, `fetch`, and OPFS. The existing `MockWorker` in `tests/hooks/useUpload.test.ts` is the pattern to copy.
- A mocked API response must match the real Zod schema. A mock that returns a looser shape passes the test and lies about production.
- Name the case, not the function: `it("falls back to HTTP when the WebSocket upgrade fails")`.
- Never put a real secret, token, or instance URL into a test, not even commented out.
- `tests/fixtures/frozen-passwords.json` holds a password protected inbox link and a sealed and a plain template export of v3.0, made with the real Argon2id. Like the fixtures of `@skysend/crypto`, never regenerate or edit it: a failing test there means links and exports people keep stop opening.
