import React from "react";
import { Box } from "ink";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import type { View, AppState } from "../types.js";

interface MainMenuProps {
  appState: AppState;
  onNavigate: (view: View) => void;
  onSwitchServer: () => void;
  onExit: () => void;
}

export function MainMenu({ appState, onNavigate, onSwitchServer, onExit }: MainMenuProps): React.ReactElement {
  const { config } = appState;
  const items: Array<SelectItem<string>> = [];

  if (config.enabledServices.includes("file")) {
    items.push({ label: "Upload file(s)", value: "upload", description: "Select and upload files" });
    items.push({ label: "Download file", value: "download", description: "Download from share URL" });
  }
  if (config.enabledServices.includes("note")) {
    items.push({ label: "Create note", value: "note-create", description: "Create an encrypted note" });
    items.push({ label: "View note", value: "note-view", description: "View a note from share URL" });
  }
  items.push({ label: "My uploads", value: "my-uploads", description: "View upload history" });
  items.push({ label: "Switch server", value: "switch-server", description: "Connect to another server" });
  items.push({ label: "Settings", value: "settings", description: "Manage servers" });
  items.push({ label: "Exit", value: "exit" });

  return (
    <Box flexDirection="column">
      <SelectList
        items={items}
        title="What would you like to do?"
        onSelect={(value) => {
          if (value === "exit") {
            onExit();
          } else if (value === "switch-server") {
            onSwitchServer();
          } else {
            onNavigate(value as View);
          }
        }}
      />
    </Box>
  );
}
