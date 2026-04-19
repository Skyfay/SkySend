import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import QRCode from "qrcode";

interface QRCodeDisplayProps {
  url: string;
}

export function QRCodeDisplay({ url }: QRCodeDisplayProps): React.ReactElement {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const code = QRCode.create(url, { errorCorrectionLevel: "L" });
      const size = code.modules.size;
      const data = code.modules.data;
      const margin = 1;
      const result: string[] = [];

      const get = (x: number, y: number): boolean =>
        x >= 0 && x < size && y >= 0 && y < size && data[y * size + x] === 1;

      // Half-block characters: each text row = 2 QR rows
      for (let y = -margin; y < size + margin; y += 2) {
        let row = "";
        for (let x = -margin; x < size + margin; x++) {
          const top = get(x, y);
          const bottom = get(x, y + 1);
          if (top && bottom) row += "█";
          else if (top) row += "▀";
          else if (bottom) row += "▄";
          else row += " ";
        }
        result.push(row);
      }
      setLines(result);
    } catch {
      setLines(null);
    }
  }, [url]);

  if (!lines) return <Box />;

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
