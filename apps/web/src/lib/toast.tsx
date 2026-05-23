import { toast } from "sonner";
import i18n from "i18next";
import { ToastActionButtons, type ToastType } from "@/components/ui/custom-toast";

// ---------------------------------------------------------------------------
// Known-error detection
// ---------------------------------------------------------------------------

const INSECURE_CONTEXT_DOCS_URL =
  "https://docs.skysend.app/user-guide/troubleshooting#crypto-subtle-is-undefined-cannot-read-properties-of-undefined-reading-importkey";

const ORIGIN_NOT_ALLOWED_DOCS_URL =
  "https://docs.skysend.app/user-guide/troubleshooting#upload-fails-with-origin-not-allowed";

/**
 * Returns true when the error message indicates that the Web Crypto API is
 * unavailable because the page is served over plain HTTP (insecure context).
 *
 * Matches both the Chrome variant ("Cannot read properties of undefined
 * (reading 'importKey')") and the Firefox variant
 * ("can't access property 'importKey', crypto.subtle is undefined").
 */
export function isInsecureContextError(message: string): boolean {
  return (
    message.includes("importKey") ||
    message.includes("crypto.subtle") ||
    message.includes("subtle is undefined")
  );
}

/**
 * Returns true when the server rejected the WebSocket upload connection
 * because the frontend's origin is not in the server's ALLOWED_ORIGINS list.
 */
export function isOriginNotAllowedError(message: string): boolean {
  return message.includes("Origin not allowed");
}

/**
 * Show a toast for an error, enriching known error types with a docs link
 * and a copy button. Falls back to a plain toast.error() for unrecognised
 * messages.
 *
 * Use this instead of toast.error() whenever the source is a raw Error
 * message from the crypto pipeline (upload, download, note creation, etc.).
 *
 * Example:
 *   showKnownErrorToast(uploadHook.error);
 */
export function showKnownErrorToast(message: string): void {
  if (isInsecureContextError(message)) {
    showToast(i18n.t("errors.insecureContext"), {
      type: "error",
      description: message,
      copyText: message,
      docsUrl: INSECURE_CONTEXT_DOCS_URL,
    });
    return;
  }
  if (isOriginNotAllowedError(message)) {
    showToast(i18n.t("errors.originNotAllowed"), {
      type: "error",
      description: message,
      copyText: message,
      docsUrl: ORIGIN_NOT_ALLOWED_DOCS_URL,
    });
    return;
  }
  toast.error(message);
}

export type { ToastType };

export interface ShowToastOptions {
  type?: ToastType;
  /** Subtitle shown below the main message. */
  description?: string;
  /**
   * If provided, a Copy button is shown. The button copies this text.
   * Pass the message string to copy the main toast title.
   */
  copyText?: string;
  /** If provided, a Docs button is shown linking to this URL (opens in new tab). */
  docsUrl?: string;
  duration?: number;
  id?: string;
}

/**
 * Show a toast notification.
 *
 * For simple toasts without action buttons, this delegates to the native
 * Sonner helpers (toast.error, toast.warning, etc.) so they benefit from
 * Sonner's built-in animations and styling.
 *
 * When `copyText` or `docsUrl` are provided, a fully custom toast with
 * action buttons is rendered via toast.custom().
 *
 * Example - simple error:
 *   showToast("Upload failed", { type: "error" })
 *
 * Example - error with copy + docs link:
 *   showToast("Origin not allowed", {
 *     type: "error",
 *     description: "The server rejected this origin.",
 *     copyText: "Origin not allowed",
 *     docsUrl: "https://docs.skysend.ch/configuration#origin",
 *   })
 */
export function showToast(message: string, options: ShowToastOptions = {}) {
  const { type = "default", description, copyText, docsUrl, duration, id } =
    options;

  const hasActions = copyText !== undefined || !!docsUrl;

  const descriptionNode = hasActions ? (
    <>
      {description && <span>{description}</span>}
      <ToastActionButtons copyText={copyText} docsUrl={docsUrl} />
    </>
  ) : description;

  const opts = { description: descriptionNode, duration, id };

  switch (type) {
    case "error":
      return toast.error(message, opts);
    case "warning":
      return toast.warning(message, opts);
    case "info":
      return toast.info(message, opts);
    case "success":
      return toast.success(message, opts);
    default:
      return toast(message, opts);
  }
}
