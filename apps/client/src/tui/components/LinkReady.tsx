import React, { useState } from "react";
import { Box, Text } from "ink";
import { copyToClipboard } from "../../lib/clipboard.js";
import { openBrowser } from "../../lib/oidc.js";
import { COLORS, useAccent } from "../theme.js";
import { useRoom, useToast } from "../shell.js";
import { Gap, LinkText, Muted, Panel } from "./Frame.js";
import { Form, type FormRow } from "./Form.js";
import { qrLines, QRCodeDisplay } from "./QRCodeDisplay.js";

interface LinkReadyProps {
  url: string;
  title: string;
  /** A ✓ before the title, for a link just made. */
  fresh?: boolean;
  /** What was shared, a few muted lines under the link. */
  children?: React.ReactNode;
  /** More buttons below copy and open, like "Send more files". */
  actions?: Array<{ id: string; label: string; onPress: () => void }>;
  active: boolean;
  onExit?: () => void;
  exitHint?: string;
}

/**
 * A link ready to share: the QR code when it fits, the link as one clickable hyperlink, and
 * buttons to copy it, open it and show or hide the QR code.
 */
export function LinkReady({ url, title, fresh = true, children, actions = [], active, onExit, exitHint }: LinkReadyProps): React.ReactElement {
  const accent = useAccent();
  const toast = useToast();
  const { width, height } = useRoom();
  const qr = qrLines(url);
  const buttonRows = 3 + actions.length;
  const fits = qr !== null && width >= 90 && height >= qr.length + buttonRows + 4;
  const [showQr, setShowQr] = useState<boolean | null>(null);
  const withQr = qr !== null && (showQr ?? fits);
  const textWidth = width - 8 - (withQr && qr ? qr[0]!.length + 4 : 0);

  const rows: FormRow[] = [
    {
      kind: "button",
      id: "copy",
      label: "Copy the link",
      primary: true,
      onPress: () =>
        toast(copyToClipboard(url) === "system" ? "Link copied to the clipboard" : "Link sent to the terminal's clipboard"),
    },
    { kind: "button", id: "open", label: "Open it in the browser", onPress: () => openBrowser(url) },
    ...actions.map((a) => ({ kind: "button" as const, ...a })),
    ...(qr ? [{ kind: "button" as const, id: "qr", label: withQr ? "Hide the QR code" : "Show the QR code", onPress: () => setShowQr(!withQr) }] : []),
  ];

  return (
    <Panel width={width}>
      <Box gap={3}>
        {withQr && <QRCodeDisplay lines={qr} />}
        <Box flexDirection="column" flexGrow={1}>
          <Gap />
          <Text color={accent} bold>{fresh ? "✓ " : ""}{title}</Text>
          <Gap />
          <Box backgroundColor={COLORS.well} paddingX={1}>
            <LinkText url={url} width={textWidth} bold />
          </Box>
          <Muted>Click the link to open it, or copy it below.</Muted>
          <Gap />
          {children}
          <Gap />
          <Form
            rows={rows}
            active={active}
            height={buttonRows + 1}
            {...(onExit ? { onExit } : {})}
            {...(exitHint ? { exitHint } : {})}
          />
        </Box>
      </Box>
    </Panel>
  );
}
