import React, { useState } from "react";
import { Box, Text } from "ink";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { getServers, addServer } from "../../lib/config.js";
import { useAccent } from "../theme.js";

interface ServerSelectProps {
  onSelect: (url: string, name: string) => void;
  onExit: () => void;
}

type Phase = "list" | "add-url" | "add-name";

export function ServerSelect({ onSelect, onExit }: ServerSelectProps): React.ReactElement {
  const accent = useAccent();
  const [phase, setPhase] = useState<Phase>("list");
  const [newUrl, setNewUrl] = useState("");
  const servers = getServers();

  if (phase === "add-url") {
    return (
      <TextPrompt
        label="Server URL"
        placeholder="https://send.example.com"
        onSubmit={(url) => {
          setNewUrl(url.replace(/\/+$/, ""));
          setPhase("add-name");
        }}
        onCancel={() => setPhase("list")}
        validate={(val) => {
          try {
            new URL(val);
            return true;
          } catch {
            return "Invalid URL";
          }
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
          try {
            addServer(name, newUrl);
          } catch { /* already exists is fine */ }
          onSelect(newUrl, name);
        }}
        onCancel={() => setPhase("list")}
      />
    );
  }

  // List phase
  const items: Array<SelectItem<string>> = servers.map((s) => ({
    label: s.name,
    value: s.url,
    description: s.url,
  }));
  items.push({ label: "+ Add server", value: "__add__" });
  items.push({ label: "Exit", value: "__exit__" });

  return (
    <Box flexDirection="column">
      <Box marginY={1} marginX={2}>
        <Text bold color={accent}>SkySend</Text>
        <Text dimColor> - Select a server</Text>
      </Box>
      <SelectList
        items={items}
        onSelect={(value) => {
          if (value === "__add__") {
            setPhase("add-url");
          } else if (value === "__exit__") {
            onExit();
          } else {
            const entry = servers.find((s) => s.url === value);
            onSelect(value, entry?.name ?? value);
          }
        }}
      />
    </Box>
  );
}
