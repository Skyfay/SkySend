import { toast } from "sonner";
import { CustomToast, type ToastType } from "@/components/ui/custom-toast";

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

  if (copyText === undefined && !docsUrl) {
    const opts = { description, duration, id };
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

  return toast.custom(
    (toastId) => (
      <CustomToast
        id={toastId}
        type={type}
        message={message}
        description={description}
        copyText={copyText}
        docsUrl={docsUrl}
      />
    ),
    { duration, id },
  );
}
