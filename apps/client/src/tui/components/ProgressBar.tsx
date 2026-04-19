import React from "react";
import { Box, Text } from "ink";
import { useAccent } from "../theme.js";

interface ProgressBarProps {
  percent: number;
  width?: number;
  label?: string;
  detail?: string;
}

export function ProgressBar({ percent, width = 40, label, detail }: ProgressBarProps): React.ReactElement {
  const accent = useAccent();
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);

  return (
    <Box flexDirection="column">
      {label && <Text>{label}</Text>}
      <Box>
        <Text color={accent}>{bar}</Text>
        <Text> {clamped.toFixed(1)}%</Text>
      </Box>
      {detail && <Text dimColor>{detail}</Text>}
    </Box>
  );
}
