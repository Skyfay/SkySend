import React from "react";
import { Box, Text } from "ink";
import type { View } from "../types.js";

interface StatusBarProps {
  view: View;
}

const HINTS: Record<View, string> = {
  "server-select": "↑↓ navigate  Enter select  Ctrl+C exit",
  "menu": "↑↓ navigate  Enter select  Ctrl+C exit",
  "upload": "↑↓ navigate  Space toggle  Enter confirm  Esc back",
  "download": "Enter confirm  Esc back",
  "note-create": "Enter confirm  Esc back",
  "note-view": "Enter confirm  Esc back",
  "my-uploads": "↑↓ navigate  Enter select  Esc back",
  "settings": "↑↓ navigate  Enter select  Esc back",
};

export function StatusBar({ view }: StatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text dimColor>{HINTS[view]}</Text>
    </Box>
  );
}
