import React, { useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
import { forTerminal } from "../../lib/terminal.js";
import { COLORS } from "../theme.js";

interface EditorProps {
  /** The text it starts with. A new `key` on the editor starts it over with another text. */
  initial: string;
  onChange: (text: string) => void;
  /** Only a focused editor takes keys and pastes. */
  focused: boolean;
  /** Rows of text it shows, it scrolls to keep the cursor in view. */
  height: number;
  placeholder?: string;
  /** ↑ on the first line or ↓ on the last one leaves the editor. */
  onLeave: (direction: "up" | "down") => void;
}

/**
 * Text over several lines: typing, enter for a new line, backspace, the arrows and pastes of
 * several lines. Tab and esc are left to the form around it.
 */
export function Editor({ initial, onChange, focused, height, placeholder, onLeave }: EditorProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>(() => initial.split("\n"));
  const [row, setRow] = useState(() => initial.split("\n").length - 1);
  const [col, setCol] = useState(() => initial.split("\n").at(-1)!.length);

  const commit = (next: string[], nextRow: number, nextCol: number) => {
    setLines(next);
    setRow(nextRow);
    setCol(nextCol);
    onChange(next.join("\n"));
  };

  const insert = (text: string) => {
    const parts = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");
    const line = lines[row] ?? "";
    const before = line.slice(0, col);
    const after = line.slice(col);
    const next = [...lines];
    if (parts.length === 1) {
      next[row] = before + parts[0] + after;
      commit(next, row, col + parts[0]!.length);
      return;
    }
    const last = parts.at(-1)!;
    next.splice(row, 1, before + parts[0], ...parts.slice(1, -1), last + after);
    commit(next, row + parts.length - 1, last.length);
  };

  useInput((input, key) => {
    const line = lines[row] ?? "";
    if (key.tab || key.escape) return;
    if (key.return) insert("\n");
    else if (key.backspace || key.delete) {
      if (col > 0) {
        const next = [...lines];
        next[row] = line.slice(0, col - 1) + line.slice(col);
        commit(next, row, col - 1);
      } else if (row > 0) {
        const next = [...lines];
        const above = next[row - 1] ?? "";
        next.splice(row - 1, 2, above + line);
        commit(next, row - 1, above.length);
      }
    } else if (key.upArrow) {
      if (row === 0) onLeave("up");
      else {
        setRow(row - 1);
        setCol(Math.min(col, (lines[row - 1] ?? "").length));
      }
    } else if (key.downArrow) {
      if (row === lines.length - 1) onLeave("down");
      else {
        setRow(row + 1);
        setCol(Math.min(col, (lines[row + 1] ?? "").length));
      }
    } else if (key.leftArrow) {
      if (col > 0) setCol(col - 1);
      else if (row > 0) {
        setRow(row - 1);
        setCol((lines[row - 1] ?? "").length);
      }
    } else if (key.rightArrow) {
      if (col < line.length) setCol(col + 1);
      else if (row < lines.length - 1) {
        setRow(row + 1);
        setCol(0);
      }
    } else if (input && !key.ctrl && !key.meta) {
      insert(input);
    }
  }, { isActive: focused });

  usePaste((text) => insert(text), { isActive: focused });

  const empty = lines.length === 1 && lines[0] === "";
  const rows = Math.max(3, height);
  const start = Math.max(0, Math.min(row - Math.floor(rows / 2), lines.length - rows));
  const shown = lines.slice(start, start + rows);

  return (
    <Box flexDirection="column" backgroundColor={COLORS.well} height={rows} paddingX={1} flexGrow={1}>
      {empty ? (
        <Text>
          {focused && <Text inverse> </Text>}
          <Text color={COLORS.faint}>{placeholder ?? ""}</Text>
        </Text>
      ) : (
        shown.map((text, i) => {
          const at = start + i;
          if (!focused || at !== row) {
            return <Text key={at} color={COLORS.text} wrap="truncate-end">{forTerminal(text) || " "}</Text>;
          }
          return (
            <Text key={at} color={COLORS.text} wrap="truncate-start">
              {forTerminal(text.slice(0, col))}
              <Text inverse>{forTerminal(text.slice(col, col + 1)) || " "}</Text>
              {forTerminal(text.slice(col + 1))}
            </Text>
          );
        })
      )}
    </Box>
  );
}
