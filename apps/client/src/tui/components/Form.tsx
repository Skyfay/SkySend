import React, { useEffect, useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
import { forTerminal } from "../../lib/terminal.js";
import { COLORS, useAccent, useTint } from "../theme.js";
import { useShell, type KeyHint } from "../shell.js";
import { Editor } from "./Editor.js";

/**
 * The rows a screen is made of. Every screen of the TUI is a form of these, so the keys do the
 * same everywhere: ↑ and ↓ move the cursor, ← and → change a value, enter does what the row
 * says, esc goes back, and a field takes typing while the cursor is on it.
 */
export type FormRow =
  /** A heading between groups of rows. */
  | { kind: "section"; label: string }
  /** Text that explains, the cursor skips it. */
  | { kind: "note"; content: React.ReactNode; lines?: number }
  /** A value from a list, changed with ← and →, or enter. */
  | { kind: "choice"; id: string; label: string; value: string; onChange: (by: 1 | -1) => void }
  /** A line of text, typed or pasted while the cursor is on it. */
  | {
      kind: "input";
      id: string;
      label: string;
      value: string;
      onChange: (value: string) => void;
      placeholder?: string;
      mask?: boolean;
      /** What enter does, and its word in the key bar. Without it, enter goes to the next row. */
      onSubmit?: () => void;
      submitHint?: string;
    }
  /** Something to do. A primary button is the main action of the screen. */
  | { kind: "button"; id: string; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }
  /** An entry of a list: a file, a link, a server. */
  | {
      kind: "item";
      id: string;
      render: (focused: boolean) => React.ReactNode;
      onPress?: () => void;
      pressHint?: string;
      onToggle?: () => void;
      toggleHint?: string;
      onRemove?: () => void;
      removeHint?: string;
      onLeft?: () => void;
      leftHint?: string;
      onRight?: () => void;
      rightHint?: string;
    }
  /** Text over several lines, like a note. */
  | { kind: "editor"; id: string; label: string; value: string; onChange: (value: string) => void; height: number; placeholder?: string; reset?: number };

type Focusable = Exclude<FormRow, { kind: "section" } | { kind: "note" }>;

function focusable(row: FormRow): row is Focusable {
  return row.kind !== "section" && row.kind !== "note";
}

function rowHeight(row: FormRow, index: number): number {
  if (row.kind === "section") return index === 0 ? 1 : 2;
  if (row.kind === "note") return row.lines ?? 1;
  if (row.kind === "editor") return row.height + 1;
  return 1;
}

interface FormProps {
  rows: FormRow[];
  /** The form has the cursor. Off while the tab bar or another screen has it. */
  active: boolean;
  /** Esc, and ↑ on the first row: back to the tab bar or the screen before. */
  onExit?: () => void;
  /** False in a screen over the tab, like the file picker, where only esc leaves. */
  upExits?: boolean;
  exitHint?: string;
  /** Moves the cursor to a row, again whenever `n` changes. */
  focus?: { id: string; n: number };
  /** A paste while the cursor is on no field, like paths dropped on the terminal. */
  onPaste?: (text: string) => void;
  /** Keys a screen adds to the bar, like c for copy. */
  extraHints?: KeyHint[];
  /** Rows of the terminal the form may fill, it scrolls past that. */
  height: number;
  labelWidth?: number;
}

export function Form({
  rows, active, onExit, upExits = true, exitHint = "back", focus, onPaste, extraHints = [], height, labelWidth = 16,
}: FormProps): React.ReactElement {
  const accent = useAccent();
  const tint = useTint();
  const ids = rows.filter(focusable).map((row) => row.id);
  const [focusedId, setFocusedId] = useState<string | undefined>(focus?.id);
  const [caret, setCaret] = useState(0);
  const [lastRequest, setLastRequest] = useState(focus?.n);
  if (focus && focus.n !== lastRequest) {
    setLastRequest(focus.n);
    setFocusedId(focus.id);
  }
  const currentId = focusedId && ids.includes(focusedId) ? focusedId : ids[0];
  const row = rows.find((r) => focusable(r) && r.id === currentId) as Focusable | undefined;
  const at = currentId ? ids.indexOf(currentId) : -1;

  const moveTo = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    const next = rows.find((r) => focusable(r) && r.id === id);
    if (next?.kind === "input") setCaret(next.value.length);
  };
  const up = () => (at > 0 ? moveTo(ids[at - 1]) : upExits ? onExit?.() : undefined);
  const down = () => moveTo(ids[at + 1]);

  // The caret stays inside the value when it changes from outside.
  const caretAt = row?.kind === "input" ? Math.min(caret, row.value.length) : 0;
  useEffect(() => {
    if (row?.kind === "input" && caret > row.value.length) setCaret(row.value.length);
  }, [row, caret]);

  useInput((input, key) => {
    if (!row) {
      if (key.escape || (key.upArrow && upExits)) onExit?.();
      return;
    }
    if (key.escape) return onExit?.();
    if (key.tab) return key.shift ? up() : down();
    if (row.kind === "editor") return;
    if (key.upArrow) return up();
    if (key.downArrow) return down();

    if (row.kind === "input") {
      const value = row.value;
      if (key.return) return row.onSubmit ? row.onSubmit() : down();
      if (key.leftArrow) return setCaret(Math.max(0, caretAt - 1));
      if (key.rightArrow) return setCaret(Math.min(value.length, caretAt + 1));
      if (key.backspace || key.delete) {
        if (caretAt === 0) return;
        row.onChange(value.slice(0, caretAt - 1) + value.slice(caretAt));
        setCaret(caretAt - 1);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const text = input.replace(/[\r\n]/g, "");
        row.onChange(value.slice(0, caretAt) + text + value.slice(caretAt));
        setCaret(caretAt + text.length);
      }
      return;
    }
    if (row.kind === "choice") {
      if (key.leftArrow) row.onChange(-1);
      else if (key.rightArrow || key.return || input === " ") row.onChange(1);
      return;
    }
    if (row.kind === "button") {
      if ((key.return || input === " ") && !row.disabled) row.onPress();
      return;
    }
    // An item.
    if (key.return) row.onPress?.();
    else if (input === " ") (row.onToggle ?? row.onPress)?.();
    else if ((key.backspace || key.delete) && row.onRemove) row.onRemove();
    else if (key.leftArrow) row.onLeft?.();
    else if (key.rightArrow) row.onRight?.();
  }, { isActive: active });

  usePaste((text) => {
    if (row?.kind === "input") {
      const line = (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
      row.onChange(row.value.slice(0, caretAt) + line + row.value.slice(caretAt));
      setCaret(caretAt + line.length);
    } else if (row?.kind !== "editor") {
      onPaste?.(text);
    }
  }, { isActive: active });

  const typing = row?.kind === "input" || row?.kind === "editor";
  const hints: KeyHint[] = [];
  if (row?.kind === "input") hints.push({ key: "type", label: row.mask ? "the password" : "or paste" }, { key: "enter", label: row.submitHint ?? "next" });
  else if (row?.kind === "editor") hints.push({ key: "type", label: "the text" }, { key: "tab", label: "next" });
  else if (row?.kind === "choice") hints.push({ key: "← →", label: "change" });
  else if (row?.kind === "button" && !row.disabled) {
    const text = row.label.replace(/^[^A-Za-z]+/, "");
    hints.push({ key: "enter", label: text.charAt(0).toLowerCase() + text.slice(1) });
  }
  else if (row?.kind === "item") {
    if (row.onPress) hints.push({ key: "enter", label: row.pressHint ?? "open" });
    if (row.onToggle) hints.push({ key: "space", label: row.toggleHint ?? "select" });
    if (row.onRemove) hints.push({ key: "del", label: row.removeHint ?? "remove" });
    if (row.onRight && row.rightHint) hints.push({ key: "→", label: row.rightHint });
    if (row.onLeft && row.leftHint) hints.push({ key: "←", label: row.leftHint });
  }
  useShell(
    [...hints, { key: "↑ ↓", label: "move" }, ...extraHints, ...(onExit ? [{ key: "esc", label: exitHint }] : [])],
    { typing, active },
  );

  // Scroll so the row with the cursor is in view.
  const tops: number[] = [];
  let y = 0;
  rows.forEach((r, i) => {
    tops.push(y);
    y += rowHeight(r, i);
  });
  const total = y;
  const focusIndex = rows.findIndex((r) => focusable(r) && r.id === currentId);
  const [scroll, setScroll] = useState(0);
  let top = Math.min(scroll, Math.max(0, total - height));
  if (focusIndex >= 0) {
    // A section heading right above the cursor scrolls in with it.
    const before = focusIndex > 0 && rows[focusIndex - 1]!.kind === "section" ? tops[focusIndex - 1]! : tops[focusIndex]!;
    const bottom = tops[focusIndex]! + rowHeight(rows[focusIndex]!, focusIndex);
    if (before < top) top = before;
    if (bottom > top + height) top = bottom - height;
  }
  if (top !== scroll) setScroll(top);

  const line = (focused: boolean, children: React.ReactNode, key: string) => (
    <Box key={key} {...(focused ? { backgroundColor: tint } : {})}>
      <Text color={accent}>{focused ? "▌" : " "}</Text>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
  const label = (text: string, focused: boolean) => (
    <Box width={labelWidth} flexShrink={0}>
      <Text color={focused ? COLORS.text : COLORS.muted} bold={focused}>{text}</Text>
    </Box>
  );

  const rendered = rows.map((r, i) => {
    if (r.kind === "section") {
      return (
        <Box key={`s-${i}`} flexDirection="column">
          {i > 0 && <Text> </Text>}
          <Text color={COLORS.muted} bold>{"  "}{r.label}</Text>
        </Box>
      );
    }
    if (r.kind === "note") {
      return <Box key={`n-${i}`} paddingLeft={2} flexDirection="column">{r.content}</Box>;
    }
    const focused = active && r.id === currentId;
    const marked = r.id === currentId;
    switch (r.kind) {
      case "choice":
        return line(focused, (
          <>
            {label(r.label, marked)}
            <Text color={focused ? accent : COLORS.text} bold={focused}>{focused ? `‹ ${r.value} ›` : `  ${r.value}`}</Text>
          </>
        ), r.id);
      case "input": {
        const shown = r.mask ? "•".repeat(r.value.length) : forTerminal(r.value);
        return line(focused, (
          <>
            {label(r.label, marked)}
            <Box flexGrow={1} backgroundColor={focused ? COLORS.well : COLORS.card}>
              <Text color={COLORS.text} wrap="truncate-start">
                {" "}
                {focused ? (
                  <>
                    {shown.slice(0, caretAt)}
                    <Text inverse>{shown.slice(caretAt, caretAt + 1) || " "}</Text>
                    {shown.slice(caretAt + 1)}
                    {!r.value && r.placeholder && <Text color={COLORS.faint}>{r.placeholder}</Text>}
                  </>
                ) : r.value ? (
                  shown
                ) : (
                  <Text color={COLORS.faint}>{r.placeholder ?? ""}</Text>
                )}
              </Text>
            </Box>
          </>
        ), r.id);
      }
      case "button":
        return line(focused, r.primary ? (
          <Text
            color={r.disabled ? COLORS.faint : COLORS.onAccent}
            backgroundColor={r.disabled ? COLORS.button : accent}
            bold={!r.disabled}
          >
            {`  ${r.label}  `}
          </Text>
        ) : (
          <Text color={r.disabled ? COLORS.faint : focused ? accent : COLORS.text} bold={focused}>{r.label}</Text>
        ), r.id);
      case "item":
        return line(focused, r.render(marked), r.id);
      case "editor":
        return (
          <Box key={r.id} flexDirection="column">
            {line(focused, label(r.label, marked), `${r.id}-label`)}
            <Box paddingLeft={1}>
              <Editor
                key={r.reset ?? 0}
                initial={r.value}
                onChange={r.onChange}
                focused={focused}
                height={r.height}
                {...(r.placeholder ? { placeholder: r.placeholder } : {})}
                onLeave={(direction) => (direction === "up" ? up() : down())}
              />
            </Box>
          </Box>
        );
    }
  });

  return (
    <Box height={Math.min(height, total)} overflow="hidden" flexDirection="column" contentOffsetY={top}>
      <Box flexDirection="column" flexShrink={0}>
        {rendered}
      </Box>
    </Box>
  );
}
