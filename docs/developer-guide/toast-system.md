# Toast Notification System

SkySend uses [Sonner](https://sonner.emilkowal.ski/) for in-app toast notifications. The `apps/web/src/lib/toast.tsx` module wraps Sonner with two layers:

1. **`showToast()`** - general-purpose helper supporting optional Copy and Docs action buttons.
2. **`showKnownErrorToast()`** - error-specific helper that detects known error patterns and automatically enriches them with a docs link and copy button.

## showToast()

Use `showToast()` when a toast needs action buttons (Copy or Docs). For simple toasts without buttons, call Sonner directly (`toast.error()`, `toast.success()`, etc.) - the overhead is not worth it.

```ts
import { showToast } from "@/lib/toast";

// Simple error (no buttons - use Sonner directly instead):
toast.error(t("upload.failed"));

// Error with a docs link and copy button:
showToast(t("errors.insecureContext"), {
  type: "error",
  description: rawErrorMessage,
  copyText: rawErrorMessage,
  docsUrl: "https://docs.skysend.app/user-guide/troubleshooting#...",
});
```

### Options

| Option | Type | Description |
| --- | --- | --- |
| `type` | `"error" \| "warning" \| "info" \| "success" \| "default"` | Sets the icon and color. Defaults to `"default"`. |
| `description` | `string` | Secondary text shown below the title in smaller type. |
| `copyText` | `string` | If set, a Copy button is shown that copies this text to the clipboard. |
| `docsUrl` | `string` | If set, a Docs button is shown that opens this URL in a new tab. |
| `duration` | `number` | Override the auto-dismiss timeout in milliseconds. |
| `id` | `string` | Deduplication key - a second call with the same ID updates the existing toast instead of opening a new one. |

When neither `copyText` nor `docsUrl` is provided, `showToast()` delegates to the native Sonner helpers so the toast benefits from Sonner's built-in animations. When action buttons are needed, it uses Sonner's native `toast.error()` (or the matching type variant) and passes a `ToastActionButtons` component as the `description` node. This keeps Sonner's native layout, close button, and animations intact.

## showKnownErrorToast()

Use `showKnownErrorToast()` anywhere a raw error message from the crypto pipeline is shown as a toast. It checks the message against a list of known patterns and enriches matching errors with a docs link and copy button.

```ts
import { showKnownErrorToast } from "@/lib/toast";

useEffect(() => {
  if (hook.phase === "error" && hook.error) {
    showKnownErrorToast(hook.error);
  }
}, [hook.phase, hook.error]);
```

For unknown errors it falls back to `toast.error(message)`.

### Known error patterns

| Pattern | i18n title | Docs link |
| --- | --- | --- |
| `importKey` / `crypto.subtle` / `subtle is undefined` | `errors.insecureContext` | [Troubleshooting - HTTPS required](https://docs.skysend.app/user-guide/troubleshooting#crypto-subtle-is-undefined-cannot-read-properties-of-undefined-reading-importkey) |
| `Origin not allowed` | `errors.originNotAllowed` | [Troubleshooting - Origin not allowed](https://docs.skysend.app/user-guide/troubleshooting#upload-fails-with-origin-not-allowed) |

### Adding a new known error

1. Add a detector in `isInsecureContextError()` or create a new `isXxxError()` function in `lib/toast.tsx`.
2. Add the corresponding i18n key to `en.json` and `de.json`, then to all other language files with AI-generated values (see [i18n rules](#i18n)).
3. Call `showToast()` with the `docsUrl` pointing to the relevant docs article.
4. Add a row to the table above.

## ToastActionButtons component

The action buttons (Copy, Docs) live in `apps/web/src/components/ui/custom-toast.tsx` as the exported `ToastActionButtons` component. It is only used indirectly through `showToast()` and is not meant to be rendered directly.

The component handles clipboard writes with a `navigator.clipboard` primary path and a `document.execCommand` fallback for HTTP contexts where the Clipboard API is unavailable.

## Toaster placement

The `<Toaster />` component is rendered once in `App.tsx` outside the router. It is configured via `apps/web/src/components/ui/sonner.tsx`:

- **Position**: `top-center`
- **Close button**: enabled (Sonner's native close button, positioned top-right)
- **Theme**: follows the user's current theme (dark / light / system) via `useTheme()`
- **Icons**: custom Lucide icons (`AlertCircle`, `AlertTriangle`, `CheckCircle2`, `Info`) replace Sonner's built-in icons to match the app's design
- **Colors**: overridden via CSS in `index.css` to use the app's card tokens (`--color-card`, `--color-border`, `--color-card-foreground`) in both light and dark mode

## i18n

Action button labels (`Copy`, `Copied!`, `Docs`) are looked up via `common.copy`, `common.copied`, and `common.docs` in the translation files. Error titles use keys in the `errors.*` namespace.

When adding a new key, follow the [i18n rules in the Copilot instructions](https://github.com/Skyfay/SkySend/blob/main/.github/copilot-instructions.md): add it to `en.json` and `de.json` first, then add AI-translated values to all other language files and track them in `__meta.aiGeneratedKeys`.
