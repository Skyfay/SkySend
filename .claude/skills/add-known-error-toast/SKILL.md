---
name: add-known-error-toast
description: Add a new known error pattern to showKnownErrorToast() in the SkySend web app, with its troubleshooting docs section, i18n keys, detector, and changelog entry. Use when a raw error message should surface as an enriched toast with Copy and Docs buttons, or when the user types /add-known-error-toast.
---

# Add a known error toast

`showKnownErrorToast()` in `apps/web/src/lib/toast.tsx` matches a raw error message against known patterns and enriches the matching ones with a docs link and a copy button. Adding a pattern touches five places, and skipping one leaves either a broken link or an untranslated toast.

## Collect first

Ask for anything that is missing before editing:

1. **Match string** - what the raw error message contains, for example `"Origin not allowed"`. Prefer a stable substring the browser or server actually produces, not a full sentence that varies.
2. **i18n key** - the `errors.*` name, for example `errors.originNotAllowed`.
3. **English title** - the short user-facing line shown as the toast title.
4. **German title** - the same in German.
5. **Docs anchor** - the troubleshooting section that explains the fix.

If the user only describes a symptom, find the real message in the code first (`grep` the throw site) rather than guessing at the substring.

## Step 1 - Troubleshooting section

File: `docs/user-guide/troubleshooting.md`

Add a `##` section with the symptom, the cause, and the fix, matching the surrounding entries. The anchor is the heading lowercased with spaces as hyphens - confirm it, because step 3 hardcodes it.

## Step 2 - i18n keys

Add the key inside the `"errors"` object of `apps/web/src/i18n/en.json` and `de.json` by hand:

```json
"errors": {
  "insecureContext": "...",
  "originNotAllowed": "...",
  "yourNewKey": "Your title here"
}
```

Then add an AI translation to the other 11 locales: `es`, `fi`, `fr`, `it`, `ja`, `nb`, `nl`, `pl`, `pt-BR`, `sv`, `zh`.

Check each file's `__meta` block. A file with `"aiGenerated": true` needs no extra bookkeeping. A file with `"aiGeneratedKeys": [...]` needs the new dot-notation key appended to that array.

## Step 3 - Detector and handler

File: `apps/web/src/lib/toast.tsx`

Add the docs URL constant alongside the existing ones:

```ts
const YOUR_ERROR_DOCS_URL =
  "https://docs.skysend.app/user-guide/troubleshooting#your-anchor-here";
```

Add an exported detector after the existing ones:

```ts
/**
 * Returns true when ...
 */
export function isYourNewError(message: string): boolean {
  return message.includes("your match string");
}
```

Add a branch in `showKnownErrorToast()` before the final `toast.error(message)` fallback:

```ts
if (isYourNewError(message)) {
  showToast(i18n.t("errors.yourNewKey"), {
    type: "error",
    description: message,
    copyText: message,
    docsUrl: YOUR_ERROR_DOCS_URL,
  });
  return;
}
```

Order matters - a broader pattern placed above a narrower one swallows it. Put the new branch where its match string cannot shadow an existing one.

## Step 4 - Developer docs table

File: `docs/developer-guide/toast-system.md`

Add a row to the known error patterns table under `## showKnownErrorToast()`:

```md
| `your match string` | `errors.yourNewKey` | [Troubleshooting - Your Title](https://docs.skysend.app/user-guide/troubleshooting#your-anchor) |
```

## Step 5 - Changelog

File: `docs/changelog.md`, active version block (`## vNEXT` or the topmost `*Release: In Progress*`).

One line under `### 🎨 Improvements`, describing what the user now sees. Do not name the detector function - entries before v2.11 did, the current style does not.

```md
- **web**: [What triggers the error] now shows a clear message with a link to the fix.
```

## Step 6 - Verify

```bash
pnpm --filter @skysend/web build
```

Then confirm by hand:

- The docs anchor in `toast.tsx` matches the heading you actually wrote.
- `en.json` and `de.json` have the key, and every other locale has it too.
- No existing detector matches your test message first.
