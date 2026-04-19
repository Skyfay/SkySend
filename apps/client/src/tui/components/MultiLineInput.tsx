import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAccent } from "../theme.js";

interface MultiLineInputProps {
  label: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
}

export function MultiLineInput({
  label, onSubmit, onCancel, placeholder,
}: MultiLineInputProps): React.ReactElement {
  const accent = useAccent();
  const [lines, setLines] = useState<string[]>([""]);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);

  useInput((input, key) => {
    if (key.escape && onCancel) {
      onCancel();
      return;
    }

    // Ctrl+D to submit
    if (key.ctrl && input === "d") {
      const content = lines.join("\n").trimEnd();
      if (content.length > 0) onSubmit(content);
      return;
    }

    if (key.return) {
      setLines((prev) => {
        const next = [...prev];
        const line = next[row] ?? "";
        next[row] = line.slice(0, col);
        next.splice(row + 1, 0, line.slice(col));
        return next;
      });
      setRow((r) => r + 1);
      setCol(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (col > 0) {
        setLines((prev) => {
          const next = [...prev];
          const line = next[row] ?? "";
          next[row] = line.slice(0, col - 1) + line.slice(col);
          return next;
        });
        setCol((c) => c - 1);
      } else if (row > 0) {
        const prevLen = (lines[row - 1] ?? "").length;
        setLines((prev) => {
          const next = [...prev];
          next[row - 1] = (next[row - 1] ?? "") + (next[row] ?? "");
          next.splice(row, 1);
          return next;
        });
        setRow((r) => r - 1);
        setCol(prevLen);
      }
      return;
    }

    if (key.upArrow) {
      if (row > 0) {
        const newRow = row - 1;
        setRow(newRow);
        setCol(Math.min(col, (lines[newRow] ?? "").length));
      }
      return;
    }

    if (key.downArrow) {
      if (row < lines.length - 1) {
        const newRow = row + 1;
        setRow(newRow);
        setCol(Math.min(col, (lines[newRow] ?? "").length));
      }
      return;
    }

    if (key.leftArrow) {
      if (col > 0) {
        setCol((c) => c - 1);
      } else if (row > 0) {
        setRow((r) => r - 1);
        setCol((lines[row - 1] ?? "").length);
      }
      return;
    }

    if (key.rightArrow) {
      const lineLen = (lines[row] ?? "").length;
      if (col < lineLen) {
        setCol((c) => c + 1);
      } else if (row < lines.length - 1) {
        setRow((r) => r + 1);
        setCol(0);
      }
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setLines((prev) => {
        const next = [...prev];
        const line = next[row] ?? "";
        next[row] = line.slice(0, col) + input + line.slice(col);
        return next;
      });
      setCol((c) => c + input.length);
    }
  });

  const isEmpty = lines.length === 1 && lines[0] === "";
  const maxVisible = 20;
  const startLine = Math.max(0, Math.min(row - Math.floor(maxVisible / 2), lines.length - maxVisible));
  const visibleLines = lines.slice(startLine, startLine + maxVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={accent}>{label}</Text>
        {isEmpty && placeholder && <Text dimColor>  {placeholder}</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {visibleLines.map((line, vi) => {
          const lineIdx = startLine + vi;
          const isCursorLine = lineIdx === row;
          return (
            <Box key={lineIdx}>
              <Text dimColor>{String(lineIdx + 1).padStart(3)} </Text>
              {isCursorLine ? (
                <Text>
                  {line.slice(0, col)}
                  <Text inverse>{line[col] ?? " "}</Text>
                  {line.slice(col + 1)}
                </Text>
              ) : (
                <Text>{line || " "}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {lines.length > maxVisible && (
        <Text dimColor>  Line {row + 1}/{lines.length}</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>Enter newline  Ctrl+D submit  Esc cancel</Text>
      </Box>
    </Box>
  );
}
