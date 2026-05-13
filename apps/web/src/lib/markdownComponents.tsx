import type { Components } from "react-markdown";

/**
 * Custom react-markdown component overrides.
 * Replaces native <input type="checkbox"> (task list items) with a styled
 * span so Tailwind's preflight reset does not strip their appearance.
 * Uses CSS variables so CUSTOM_COLOR is automatically respected.
 */
export const markdownComponents: Components = {
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return (
      <span
        role="checkbox"
        aria-checked={checked ?? false}
        className={`inline-flex h-[0.85em] w-[0.85em] shrink-0 items-center justify-center rounded-sm border align-middle mr-1.5 ${
          checked ? "border-primary bg-primary" : "border-border"
        }`}
      >
        {checked && (
          <svg
            className="h-[0.65em] w-[0.65em] text-primary-foreground"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1.5 5L4 7.5L8.5 2.5" />
          </svg>
        )}
      </span>
    );
  },
};
