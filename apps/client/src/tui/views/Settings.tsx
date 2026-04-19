import React, { useState } from "react";
import { Box } from "ink";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import {
  getServers, addServer, setDefaultServer, getDefaultServer,
} from "../../lib/config.js";

interface SettingsViewProps {
  onBack: () => void;
  onServerChange: () => void;
}

type Phase = "menu" | "add-url" | "add-name" | "manage";

export function SettingsView({ onBack }: SettingsViewProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("menu");
  const [newUrl, setNewUrl] = useState("");
  const [, setRefreshKey] = useState(0);
  const servers = getServers();
  const defaultUrl = getDefaultServer();

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
    items.push({ label: "Back", value: "__back__" });

    return (
      <Box flexDirection="column">
        <SelectList
          items={items}
          title="Manage servers - Select to set as default, or remove"
          onSelect={(url) => {
            if (url === "__back__") { setPhase("menu"); return; }
            // Show sub-actions
            setPhase("menu"); // For now, just set default
            setDefaultServer(url);
            setRefreshKey((k) => k + 1);
          }}
          onCancel={() => setPhase("menu")}
        />
      </Box>
    );
  }

  // Menu
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
    </Box>
  );
}
