import React, { useState } from "react";
import { Text } from "ink";
import {
  getServers, removeServer, setDefaultServer, getDefaultServer, getWebSocket, setWebSocket,
} from "../../lib/config.js";
import { forTerminal } from "../../lib/terminal.js";
import type { AppState } from "../types.js";
import { COLORS } from "../theme.js";
import { useFocus, useRoom } from "../shell.js";
import { Faint, Gap, Panel } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";

interface SettingsViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
  onServerChange: () => void;
}

/** The Settings tab: the server, the one to start with, WebSocket uploads, the saved servers. */
export function SettingsView({ appState, onServerChange }: SettingsViewProps): React.ReactElement {
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const [, setVersion] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const servers = getServers();
  const defaultUrl = getDefaultServer();
  const serverWs = appState.config.fileUploadWs;
  const clientWs = getWebSocket(appState.server);
  const refresh = () => setVersion((v) => v + 1);
  const host = new URL(appState.server).host;

  const rows: FormRow[] = [
    { kind: "section", label: `Connected to ${host}` },
    { kind: "button", id: "switch", label: "Switch to another server", onPress: onServerChange },
    {
      kind: "choice",
      id: "start",
      label: "Start with",
      value: forTerminal(servers.find((s) => s.url === defaultUrl)?.name ?? defaultUrl ?? "the first one you pick"),
      onChange: (by) => {
        if (servers.length === 0) return;
        const now = Math.max(0, servers.findIndex((s) => s.url === defaultUrl));
        setDefaultServer(servers[(now + by + servers.length) % servers.length]!.url);
        refresh();
      },
    },
    {
      kind: "choice",
      id: "ws",
      label: "Fast uploads",
      value: !serverWs ? "not offered by this server" : clientWs ? "on, over WebSocket" : "off, over plain HTTP",
      onChange: () => {
        if (!serverWs) {
          setNote("This server does not offer WebSocket uploads.");
          return;
        }
        setWebSocket(appState.server, !clientWs);
        refresh();
      },
    },
    { kind: "note", content: <Faint>Turn fast uploads off when a proxy in between breaks them. Only for {forTerminal(host)}.</Faint> },
    { kind: "section", label: "Saved servers" },
    ...servers.map((s): FormRow => ({
      kind: "item",
      id: `server:${s.url}`,
      onRemove: () => {
        if (s.url === appState.server) {
          setNote("That is the server you are connected to. Switch to another one first.");
          return;
        }
        removeServer(s.url);
        setNote(null);
        refresh();
      },
      removeHint: "forget it",
      render: (focused) => (
        <Text wrap="truncate-end">
          <Text color={COLORS.text} bold={focused}>{forTerminal(s.name)}</Text>
          <Text color={COLORS.muted}>   {forTerminal(s.url)}</Text>
          <Text color={COLORS.faint}>{s.url === appState.server ? "   connected" : ""}{s.url === defaultUrl ? "   starts with" : ""}</Text>
        </Text>
      ),
    })),
    ...(servers.length === 0 ? [{ kind: "note" as const, content: <Faint>None yet. A server you pick is saved here.</Faint> }] : []),
    ...(note ? [{ kind: "note" as const, content: <Text color={COLORS.danger}>{note}</Text> }] : []),
  ];

  return (
    <Panel width={width}>
      <Gap />
      <Form rows={rows} active={active} height={Math.max(6, height - 4)} onExit={toTabs} exitHint="tabs" labelWidth={14} />
      <Gap />
    </Panel>
  );
}
