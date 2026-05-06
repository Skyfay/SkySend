import React, { useState } from "react";
import { Box, Text } from "ink";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import {
  getServers, addServer, removeServer, setDefaultServer, getDefaultServer,
  getWebSocket,
} from "../../lib/config.js";
import type { AppState } from "../types.js";

interface SettingsViewProps {
  appState: AppState;
  onBack: () => void;
  onServerChange: () => void;
}

type Phase = "menu" | "add-url" | "add-name" | "manage" | "server-actions";

export function SettingsView({ appState, onBack }: SettingsViewProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("menu");
  const [newUrl, setNewUrl] = useState("");
  const [, setRefreshKey] = useState(0);
  const [selectedServerUrl, setSelectedServerUrl] = useState<string | null>(null);
  const servers = getServers();
  const defaultUrl = getDefaultServer();

  const serverWsEnabled = appState.config.fileUploadWs;
  // getWebSocket is always false while WebSocket uploads are globally disabled
  const clientWsEnabled = getWebSocket(appState.server);

  if (phase === "add-url") {
    return (
      <TextPrompt
        label="Server URL"
        placeholder="https://send.example.com"
        onSubmit={(url) => {
          setNewUrl(url.replace(/\/+$/, ""));
          setPhase("add-name");
        }}
        onCancel={() => setPhase("menu")}
        validate={(val) => {
          try { new URL(val); return true; } catch { return "Invalid URL"; }
        }}
      />
    );
  }

  if (phase === "add-name") {
    const urlObj = new URL(newUrl);
    return (
      <TextPrompt
        label="Server name"
        defaultValue={urlObj.hostname}
        onSubmit={(name) => {
          try { addServer(name, newUrl); } catch { /* exists */ }
          setRefreshKey((k) => k + 1);
          setPhase("menu");
        }}
        onCancel={() => setPhase("menu")}
      />
    );
  }

  if (phase === "manage") {
    const items: Array<SelectItem<string>> = servers.map((s) => ({
      label: `${s.name}${s.url === defaultUrl ? " (default)" : ""}`,
      value: s.url,
      description: s.url,
    }));
    items.push({ label: "Add server", value: "__add__" });
    items.push({ label: "Back", value: "__back__" });

    return (
      <Box flexDirection="column">
        <SelectList
          items={items}
          title="Manage servers"
          onSelect={(url) => {
            if (url === "__back__") { setPhase("menu"); return; }
            if (url === "__add__") { setPhase("add-url"); return; }
            setSelectedServerUrl(url);
            setPhase("server-actions");
          }}
          onCancel={() => setPhase("menu")}
        />
      </Box>
    );
  }

  if (phase === "server-actions" && selectedServerUrl) {
    const entry = servers.find((s) => s.url === selectedServerUrl);
    const isDefault = selectedServerUrl === defaultUrl;
    const isActive = selectedServerUrl === appState.server;

    const items: Array<SelectItem<string>> = [];
    if (!isDefault) {
      items.push({ label: "Set as default", value: "set-default" });
    }
    items.push({
      label: "Delete server",
      value: "delete",
      description: isActive ? "Currently connected" : undefined,
    });
    items.push({ label: "Back", value: "__back__" });

    return (
      <Box flexDirection="column">
        <SelectList
          items={items}
          title={`Server: ${entry?.name ?? selectedServerUrl}`}
          onSelect={(action) => {
            if (action === "__back__") { setPhase("manage"); return; }
            if (action === "set-default") {
              setDefaultServer(selectedServerUrl);
              setRefreshKey((k) => k + 1);
              setPhase("manage");
            } else if (action === "delete") {
              removeServer(selectedServerUrl);
              setSelectedServerUrl(null);
              setRefreshKey((k) => k + 1);
              setPhase("manage");
            }
          }}
          onCancel={() => setPhase("manage")}
        />
      </Box>
    );
  }

  // serverWsEnabled and clientWsEnabled are kept for future use once the
  // WebSocket issue is resolved.
  void serverWsEnabled;
  void clientWsEnabled;

  const items: Array<SelectItem<string>> = [
    { label: "Add server", value: "add" },
    { label: "Manage servers", value: "manage", description: `${servers.length} server(s)` },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <SelectList
        items={items}
        title="Settings"
        onSelect={(val) => {
          if (val === "add") setPhase("add-url");
          else if (val === "manage") setPhase("manage");
          else onBack();
        }}
        onCancel={onBack}
      />
      {/* WebSocket uploads are globally disabled due to known connection issues
          with HTTPS servers - large file transfers fail mid-transfer.
          HTTP chunked upload is used instead until the root cause is fixed. */}
      <Box marginX={2} marginTop={1}>
        <Text dimColor>WebSocket upload: Off (globally disabled - HTTP chunked upload is used)</Text>
      </Box>
    </Box>
  );
}
