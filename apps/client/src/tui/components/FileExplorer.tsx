import React, { useState } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { formatBytes } from "../../lib/progress.js";
import { useAccent } from "../theme.js";

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

interface FileExplorerProps {
  onConfirm: (files: string[]) => void;
  onCancel: () => void;
  maxFiles?: number;
  maxSize?: number;
  initialDir?: string;
}



export function FileExplorer({
  onConfirm, onCancel, maxFiles = 100, maxSize = Infinity, initialDir,
}: FileExplorerProps): React.ReactElement {
  const accent = useAccent();
  const [cwd, setCwd] = useState(initialDir ?? process.cwd());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const entries = React.useMemo(() => readDirFull(cwd, showHidden), [cwd, showHidden]);
  const [cursor, setCursor] = useState(0);

  const maxVisible = 18;
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), entries.length + 1 - maxVisible));

  // ".." is virtual entry at index 0
  const totalItems = entries.length + 1; // +1 for ".."

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : totalItems - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < totalItems - 1 ? c + 1 : 0));
      return;
    }

    // Toggle hidden files
    if (input === "." && key.ctrl) {
      setShowHidden((h) => !h);
      setCursor(0);
      return;
    }

    // Space: toggle select (files only)
    if (input === " ") {
      if (cursor === 0) return; // ".."
      const entry = entries[cursor - 1];
      if (!entry || entry.isDirectory) return;
      const fullPath = path.join(cwd, entry.name);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(fullPath)) {
          next.delete(fullPath);
        } else {
          if (next.size >= maxFiles) return prev;
          next.add(fullPath);
        }
        return next;
      });
      // Move cursor down after toggle
      setCursor((c) => Math.min(c + 1, totalItems - 1));
      return;
    }

    // Enter: navigate into dir or confirm if on ".."
    if (key.return) {
      if (cursor === 0) {
        // Go up
        const parent = path.dirname(cwd);
        if (parent !== cwd) {
          setCwd(parent);
          setCursor(0);
        }
        return;
      }
      const entry = entries[cursor - 1];
      if (!entry) return;
      if (entry.isDirectory) {
        setCwd(path.join(cwd, entry.name));
        setCursor(0);
        return;
      }
      // Single file - select and confirm
      const fullPath = path.join(cwd, entry.name);
      if (selected.size === 0) {
        onConfirm([fullPath]);
        return;
      }
      // If already have selections, add this too and confirm
      const files = new Set(selected);
      files.add(fullPath);
      onConfirm([...files]);
      return;
    }

    // 'c' to confirm selection
    if (input === "c" && selected.size > 0) {
      onConfirm([...selected]);
      return;
    }

    // 'a' to select all files in current dir
    if (input === "a") {
      setSelected((prev) => {
        const next = new Set(prev);
        const allFiles = entries.filter((e) => !e.isDirectory);
        const allSelected = allFiles.every((e) => next.has(path.join(cwd, e.name)));
        if (allSelected) {
          // Deselect all in current dir
          for (const e of allFiles) next.delete(path.join(cwd, e.name));
        } else {
          for (const e of allFiles) {
            if (next.size < maxFiles) next.add(path.join(cwd, e.name));
          }
        }
        return next;
      });
      return;
    }
  });

  const selectedSize = [...selected].reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);

  const visible: Array<{ label: string; idx: number }> = [];
  for (let i = start; i < Math.min(start + maxVisible, totalItems); i++) {
    if (i === 0) {
      visible.push({ label: "..", idx: 0 });
    } else {
      const entry = entries[i - 1]!;
      visible.push({ label: entry.name, idx: i });
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={accent}>Select files</Text>
        <Text dimColor>  {cwd}</Text>
      </Box>

      <Box flexDirection="column">
        {visible.map(({ label, idx }) => {
          const isSelected = cursor === idx;
          const isParent = idx === 0;
          const entry = idx > 0 ? entries[idx - 1] : undefined;
          const fullPath = entry ? path.join(cwd, entry.name) : "";
          const isChecked = selected.has(fullPath);

          const icon = isParent || entry?.isDirectory ? "▸ " : isChecked ? "[x]" : "[ ]";

          return (
            <Box key={idx}>
              <Text color={isSelected ? accent : undefined}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text>{icon} </Text>
              <Text color={isSelected ? accent : undefined} bold={isSelected || isChecked}>
                {label}{entry?.isDirectory ? "/" : ""}
              </Text>
              {entry && !entry.isDirectory && (
                <Text dimColor> {formatBytes(entry.size)}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            <Text dimColor>Selected: </Text>
            <Text bold>{selected.size}</Text>
            <Text dimColor> file{selected.size !== 1 ? "s" : ""}</Text>
            {selected.size > 0 && (
              <Text dimColor> ({formatBytes(selectedSize)})</Text>
            )}
          </Text>
          {maxSize < Infinity && selectedSize > maxSize && (
            <Text color="red">Exceeds max size!</Text>
          )}
        </Box>
        <Text dimColor>
          ↑↓ navigate  Space select  Enter open/pick  a select-all  c confirm  Esc cancel
        </Text>
      </Box>
    </Box>
  );
}

function readDirFull(dirPath: string, showHidden: boolean): FileEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items: FileEntry[] = [];
    for (const entry of entries) {
      if (!showHidden && entry.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stat.size,
        });
      } catch {
        // skip
      }
    }
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  } catch {
    return [];
  }
}
