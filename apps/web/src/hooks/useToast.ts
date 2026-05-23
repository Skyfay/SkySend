// Re-export Sonner's toast function as a drop-in replacement.
// Callers should migrate to importing directly from "sonner" or
// using toast.success / toast.error / toast.warning / toast.info.
export { toast } from "sonner";

// Keep a no-op useToast export so legacy callers compile without changes.
export function useToast() {
  return {};
}
