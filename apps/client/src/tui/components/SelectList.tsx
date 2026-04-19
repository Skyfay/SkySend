import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAccent } from "../theme.js";

export interface SelectItem<T = string> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

interface SelectListProps<T = string> {
  items: Array<SelectItem<T>>;
  onSelect: (value: T) => void;
  onCancel?: () => void;
  title?: string;
  maxVisible?: number;
}

export function SelectList<T = string>({
  items, onSelect, onCancel, title, maxVisible = 15,
}: SelectListProps<T>): React.ReactElement {
  const accent = useAccent();
  const [cursor, setCursor] = useState(0);
  const activeItems = items.filter((i) => !i.disabled);

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === "p")) {
      setCursor((c) => (c > 0 ? c - 1 : activeItems.length - 1));
    } else if (key.downArrow || (key.ctrl && input === "n")) {
      setCursor((c) => (c < activeItems.length - 1 ? c + 1 : 0));
    } else if (key.return) {
      const item = activeItems[cursor];
      if (item) onSelect(item.value);
    } else if (key.escape && onCancel) {
      onCancel();
    }
  });

  // Scrolling window
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), activeItems.length - maxVisible));
  const visible = activeItems.slice(start, start + maxVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}
      {visible.map((item, i) => {
        const realIdx = start + i;
        const isSelected = realIdx === cursor;
        return (
          <Box key={String(i)}>
            <Text color={isSelected ? accent : undefined}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text color={isSelected ? accent : undefined} bold={isSelected}>
              {item.label}
            </Text>
            {item.description && (
              <Text dimColor> {item.description}</Text>
            )}
          </Box>
        );
      })}
      {activeItems.length > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor>
            {start > 0 ? "↑ " : "  "}
            {cursor + 1}/{activeItems.length}
            {start + maxVisible < activeItems.length ? " ↓" : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}
