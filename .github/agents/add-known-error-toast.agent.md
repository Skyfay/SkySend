---
name: "Add Known Error Toast"
description: "Step-by-step agent for adding a new known error pattern to showKnownErrorToast(). Use when adding a new enriched error toast with Copy and Docs buttons to the SkySend web app."
---

You are helping add a new known error toast pattern to SkySend. Follow these steps exactly and in order.

## Required Information

Before starting, collect from the user:
1. **Error message pattern** - what string does the raw error message contain? (e.g. `"Origin not allowed"`)
2. **i18n key** - what should the `errors.*` key be called? (e.g. `errors.originNotAllowed`)
3. **English title** - the short user-friendly title shown in the toast (e.g. `"Origin not allowed"`)
4. **German title** - the German translation of the title
5. **Docs anchor** - the `#anchor` of the troubleshooting section that explains the fix

If any of these are missing, ask before proceeding.

## Step 1 - Add the troubleshooting docs section

File: `docs/user-guide/troubleshooting.md`

Add a new `##` section that explains:
- **Symptom** - what the user sees
- **Cause** - why it happens
- **Fix** - how to resolve it

The anchor is derived from the heading text (lowercase, spaces to hyphens). Confirm the anchor matches what you will use in Step 3.

## Step 2 - Add the i18n key

Files: `apps/web/src/i18n/en.json` and `apps/web/src/i18n/de.json`

Add the new key inside the `"errors"` object:
```json
"errors": {
  "insecureContext": "...",
  "originNotAllowed": "...",
  "yourNewKey": "Your title here"
}
```

Then add AI-translated values to all 11 other language files (`fr`, `es`, `it`, `pt-BR`, `nl`, `pl`, `sv`, `nb`, `fi`, `zh`, `ja`). All of those files have `"aiGenerated": true` in their `__meta` block, so no additional tracking is needed.

## Step 3 - Add the detector and handler in toast.tsx

File: `apps/web/src/lib/toast.tsx`

**3a.** Add a docs URL constant near the top (after the existing constants):
```ts
const YOUR_ERROR_DOCS_URL =
  "https://docs.skysend.app/user-guide/troubleshooting#your-anchor-here";
```

**3b.** Add an exported detector function after `isOriginNotAllowedError`:
```ts
export function isYourNewError(message: string): boolean {
  return message.includes("your match string");
}
```

**3c.** Add a case in `showKnownErrorToast()` before the final `toast.error(message)` fallback:
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

## Step 4 - Update the known errors table in developer docs

File: `docs/developer-guide/toast-system.md`

Add a row to the "Known error patterns" table under `## showKnownErrorToast()`:
```md
| `your match string` | `errors.yourNewKey` | [Troubleshooting - Your Title](https://docs.skysend.app/user-guide/troubleshooting#your-anchor) |
```

## Step 5 - Update the changelog

File: `docs/changelog.md`

Add an entry in the active `*Release: In Progress*` version block under `### ✨ Features`:
```md
- **web**: Added `isYourNewError()` pattern to `showKnownErrorToast()`. [One sentence describing what triggers it and what the toast shows.]
```

## Step 6 - Verify the build

Run:
```bash
pnpm --filter @skysend/web build
```

Confirm no TypeScript errors before finishing.
