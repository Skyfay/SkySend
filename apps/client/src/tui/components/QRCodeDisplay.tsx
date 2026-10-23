import React from "react";
import { Box, Text } from "ink";
import QRCode from "qrcode";
import { COLORS } from "../theme.js";

/**
 * A QR code in half blocks, two modules per line, with a quiet zone of two modules. Null when
 * the text is too long for a QR code.
 */
export function qrLines(text: string): string[] | null {
  try {
    const code = QRCode.create(text, { errorCorrectionLevel: "L" });
    const size = code.modules.size;
    const data = code.modules.data;
    const margin = 2;
    const dark = (x: number, y: number): boolean =>
      x >= 0 && x < size && y >= 0 && y < size && data[y * size + x] === 1;
    const lines: string[] = [];
    for (let y = -margin; y < size + margin; y += 2) {
      let line = "";
      for (let x = -margin; x < size + margin; x++) {
        const top = dark(x, y);
        const bottom = dark(x, y + 1);
        line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      }
      lines.push(line);
    }
    return lines;
  } catch {
    return null;
  }
}

/** Dark modules on a light ground whatever the terminal's colors, so every phone can read it. */
export function QRCodeDisplay({ url, lines }: { url?: string; lines?: string[] | null }): React.ReactElement {
  const rows = React.useMemo(() => lines ?? (url ? qrLines(url) : null), [url, lines]);
  if (!rows) return <Box />;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((line, i) => (
        <Text key={i} color={COLORS.well} backgroundColor={COLORS.text}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
