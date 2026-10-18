import { createContext, useContext, useEffect } from "react";
import type { OpenRequest } from "../lib/upload-job.js";

/** One key of the bar at the bottom, like `{ key: "enter", label: "send" }`. */
export interface KeyHint {
  key: string;
  label: string;
}

/** A file request opened from its upload link, the link kept to ask it again later. */
export type HandedRequest = OpenRequest & { link: string };

export interface ShellState {
  hints: KeyHint[];
  /** A field takes the keys, so q is text and quits nothing. */
  typing: boolean;
}

interface ShellApi {
  set: (state: ShellState) => void;
  toast: (message: string) => void;
  /** Moves the cursor up into the tab bar. */
  toTabs: () => void;
  /** Hands an opened file request to the Send tab, which sends into it. */
  sendInto: (request: HandedRequest) => void;
  /** The cursor is in the tab, not in the tab bar. */
  active: boolean;
  /** The room a tab has below the header and above the key bar. */
  width: number;
  height: number;
}

export const ShellContext = createContext<ShellApi>({
  set: () => {},
  toast: () => {},
  toTabs: () => {},
  sendInto: () => {},
  active: true,
  width: 100,
  height: 30,
});

/**
 * Declares the keys of the current screen and whether a field takes the input. Only the
 * screen that has the cursor declares, the others pass `active: false`.
 */
export function useShell(hints: KeyHint[], options: { typing?: boolean; active?: boolean } = {}): void {
  const { set } = useContext(ShellContext);
  const typing = options.typing ?? false;
  const active = options.active ?? true;
  const signature = JSON.stringify(hints);
  useEffect(() => {
    if (active) set({ hints: JSON.parse(signature) as KeyHint[], typing });
  }, [set, signature, typing, active]);
}

/** Shows a short message at the top right, like "Link copied". */
export function useToast(): (message: string) => void {
  return useContext(ShellContext).toast;
}

/** Width and height a tab may fill. */
export function useRoom(): { width: number; height: number } {
  const { width, height } = useContext(ShellContext);
  return { width, height };
}

/** Whether the tab has the cursor, and how to hand it up to the tab bar. */
export function useFocus(): { active: boolean; toTabs: () => void } {
  const { active, toTabs } = useContext(ShellContext);
  return { active, toTabs };
}

/** Hands an opened file request to the Send tab. */
export function useSendInto(): (request: HandedRequest) => void {
  return useContext(ShellContext).sendInto;
}
