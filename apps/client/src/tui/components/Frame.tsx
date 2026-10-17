import React from "react";
import { Box, Text } from "ink";
import { forTerminal } from "../../lib/terminal.js";
import { COLORS, useAccent, useTint } from "../theme.js";
import type { KeyHint } from "../shell.js";

/**
 * A filled card. Its top and bottom edge are half a row of the card's color and its sides a
 * full column, which are about the same thickness since a cell is twice as tall as it is wide.
 * The corners are quarter blocks, so they come out cut, as round as a grid of cells gets.
 */
const CARD_EDGE = {
  topLeft: "▗",
  top: "▄",
  topRight: "▖",
  left: "█",
  right: "█",
  bottomLeft: "▝",
  bottom: "▀",
  bottomRight: "▘",
};

interface PanelProps {
  children: React.ReactNode;
  width?: number | string;
  height?: number;
  flexGrow?: number;
  paddingX?: number;
  /** The color the card sits on, which fills the open halves of its edge. */
  on?: string;
  fill?: string;
}

export function Panel({
  children, width, height, flexGrow, paddingX = 1, on = COLORS.page, fill = COLORS.card,
}: PanelProps): React.ReactElement {
  return (
    <Box
      borderStyle={CARD_EDGE}
      borderColor={fill}
      borderBackgroundColor={on}
      backgroundColor={fill}
      flexDirection="column"
      paddingX={paddingX}
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
      {...(flexGrow !== undefined ? { flexGrow } : {})}
    >
      {children}
    </Box>
  );
}

/** Text in the colors of the theme: plain, muted for labels, faint for hints. */
export function T({ children, bold }: { children: React.ReactNode; bold?: boolean }): React.ReactElement {
  return <Text color={COLORS.text} bold={bold}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={COLORS.muted}>{children}</Text>;
}

export function Faint({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={COLORS.faint}>{children}</Text>;
}

/** An empty line. */
export function Gap(): React.ReactElement {
  return <Text> </Text>;
}

/**
 * A link the terminal opens as a whole, also where it wraps: every line carries the full URL as
 * an OSC 8 hyperlink. Terminals without OSC 8 show the text as it is.
 */
export function LinkText({ url, width, bold }: { url: string; width: number; bold?: boolean }): React.ReactElement {
  const clean = forTerminal(url);
  const size = Math.max(10, width);
  const lines: string[] = [];
  for (let at = 0; at < clean.length; at += size) lines.push(clean.slice(at, at + size));
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} color={COLORS.text} bold={bold}>
          {`\x1b]8;;${clean}\x1b\\${line}\x1b]8;;\x1b\\`}
        </Text>
      ))}
    </Box>
  );
}

export interface Tab<T extends string> {
  id: T;
  label: string;
}

interface HeaderProps<T extends string> {
  title: string;
  tabs: readonly Tab<T>[];
  active: T;
  /** The cursor is in the tab bar: the active tab shows ‹ › like a value to change. */
  focused: boolean;
  host: string;
  width: number;
}

/** The bar at the top: the brand, the tabs and the server. */
export function Header<T extends string>({ title, tabs, active, focused, host, width }: HeaderProps<T>): React.ReactElement {
  const accent = useAccent();
  const tint = useTint();
  return (
    <Panel width={width}>
      <Box justifyContent="space-between" {...(focused ? { backgroundColor: tint } : {})}>
        <Text wrap="truncate-end">
          <Text color={accent}>{focused ? "▌" : " "}</Text>
          <Text color={accent} bold>◆ {title}</Text>
          <Text>   </Text>
          {tabs.map((tab) => (
            <Text key={tab.id}>
              {tab.id === active ? (
                <Text color={focused ? COLORS.onAccent : accent} backgroundColor={focused ? accent : tint} bold>
                  {focused ? `‹ ${tab.label} ›` : `  ${tab.label}  `}
                </Text>
              ) : (
                <Text color={focused ? COLORS.text : COLORS.muted}>  {tab.label}  </Text>
              )}
              <Text> </Text>
            </Text>
          ))}
        </Text>
        {/* Below 96 columns the tabs need the room, the server stands in Settings. */}
        {width >= 96 && (
          <Box marginLeft={2} flexShrink={1}>
            <Text wrap="truncate-start">
              <Text color={accent}>●</Text>
              <Text color={COLORS.muted}> {host}</Text>
            </Text>
          </Box>
        )}
      </Box>
    </Panel>
  );
}

/** The one line of keys at the bottom. */
export function KeyBar({ hints, right, width }: { hints: KeyHint[]; right: KeyHint[]; width: number }): React.ReactElement {
  const render = (list: KeyHint[]) =>
    list.map((hint, i) => (
      <Text key={`${hint.key}-${i}`}>
        {i > 0 && <Text color={COLORS.faint}>   </Text>}
        <Text color={COLORS.text} bold>{hint.key}</Text>
        <Text color={COLORS.muted}> {hint.label}</Text>
      </Text>
    ));
  return (
    <Box width={width} paddingX={2}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{render(hints)}</Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        <Text>{render(right)}</Text>
      </Box>
    </Box>
  );
}

/** A message at the top right that goes away by itself. */
export function Toast({ message }: { message: string }): React.ReactElement {
  const accent = useAccent();
  return (
    <Box position="absolute" marginTop={3} width="100%" justifyContent="flex-end">
      <Panel fill={COLORS.button}>
        <Text color={COLORS.text}>
          <Text color={accent}>✓</Text> {message}
        </Text>
      </Panel>
    </Box>
  );
}
