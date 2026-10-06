import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps<T> {
  /** The allowed values in order, for example the download limits the server sends. */
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** How a value reads, for example "1 download" or "Unlimited". */
  format: (value: T) => string;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Steps through a fixed list of values with minus and plus. Fits lists that are too long
 * for chips, like the nine download limits.
 */
export function Stepper<T>({
  options,
  value,
  onChange,
  format,
  decreaseLabel,
  increaseLabel,
  disabled,
  className,
}: StepperProps<T>) {
  const index = Math.max(0, options.indexOf(value));
  const step = (delta: number) => {
    const next = options[index + delta];
    if (next !== undefined) onChange(next);
  };
  const buttonClass =
    "inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35";

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center rounded-full border border-border",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        className={buttonClass}
        onClick={() => step(-1)}
        disabled={disabled || index === 0}
        aria-label={decreaseLabel}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span aria-live="polite" className="min-w-32 px-1 text-center text-[13px] font-medium tabular-nums">
        {format(options[index] ?? value)}
      </span>
      <button
        type="button"
        className={buttonClass}
        onClick={() => step(1)}
        disabled={disabled || index >= options.length - 1}
        aria-label={increaseLabel}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
