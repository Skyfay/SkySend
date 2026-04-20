import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { fetchConfig, fetchQuota } from "../lib/api.js";
import type { View, AppState } from "./types.js";
import { ThemeProvider, useAccent } from "./theme.js";
import { Header } from "./components/Header.js";
import { StatusBar } from "./components/StatusBar.js";
import { ServerSelect } from "./views/ServerSelect.js";
import { MainMenu } from "./views/MainMenu.js";
import { UploadView } from "./views/Upload.js";
import { DownloadView } from "./views/Download.js";
import { NoteCreateView } from "./views/NoteCreate.js";
import { NoteViewView } from "./views/NoteView.js";
import { MyUploadsView } from "./views/MyUploads.js";
import { SettingsView } from "./views/Settings.js";

interface AppProps {
  initialServer?: string;
  initialView?: View;
  initialNoteUrl?: string;
}

export function App({ initialServer, initialView, initialNoteUrl }: AppProps): React.ReactElement {
  const [accentColor, setAccentColor] = useState<string | null>(null);
  return (
    <ThemeProvider color={accentColor}>
      <AppInner initialServer={initialServer} initialView={initialView} initialNoteUrl={initialNoteUrl} setAccentColor={setAccentColor} />
    </ThemeProvider>
  );
}

function AppInner({ initialServer, initialView, initialNoteUrl, setAccentColor }: AppProps & { setAccentColor: (c: string | null) => void }): React.ReactElement {
  const { exit } = useApp();
  const accent = useAccent();
  const didAutoConnect = useRef(false);
  const [view, setView] = useState<View>(initialServer ? (initialView ?? "menu") : "server-select");
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(initialServer ? true : false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("Loading...");

  // Connect to a server
  const connectToServer = useCallback(async (url: string, name: string, targetView?: View) => {
    setLoading(true);
    setError(null);
    setHint("Connecting to server...");
    try {
      const config = await fetchConfig(url);
      let quota;
      try { quota = await fetchQuota(url); } catch { /* optional */ }
      setAppState({ server: url, serverName: name, config, quota });
      setAccentColor(config.customColor);
      setView(targetView ?? "menu");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "fetch failed" || msg.includes("ECONNREFUSED")) {
        setError(`Server ${url} is not reachable`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [setAccentColor]);

  // Auto-connect if initialServer provided (only once)
  React.useEffect(() => {
    if (initialServer && !appState && !didAutoConnect.current) {
      didAutoConnect.current = true;
      void connectToServer(initialServer, initialServer, initialView);
    }
  }, [initialServer, initialView, appState, connectToServer]);

  const refreshQuota = useCallback(async () => {
    if (!appState) return;
    try {
      const quota = await fetchQuota(appState.server);
      setAppState((prev) => prev ? { ...prev, quota } : prev);
    } catch { /* ignore */ }
  }, [appState]);

  const navigate = useCallback((target: View) => {
    setError(null);
    setView(target);
  }, []);

  const handleBack = useCallback(() => {
    setError(null);
    setView("menu");
    void refreshQuota();
  }, [refreshQuota]);

  const switchServer = useCallback(() => {
    setAppState(null);
    setView("server-select");
  }, []);

  // Global Ctrl+C to exit
  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
    }
    // Recovery from connection error: press s for server-select, r to retry
    if (error && !appState) {
      if (_input === "s") {
        setError(null);
        setView("server-select");
      } else if (_input === "r" && initialServer) {
        setError(null);
        didAutoConnect.current = false;
        void connectToServer(initialServer, initialServer, initialView);
      }
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column">
        <Box marginY={1} marginX={2}>
          <Text color={accent}>⠋ </Text>
          <Text>{hint}</Text>
        </Box>
      </Box>
    );
  }

  if (error && !appState) {
    return (
      <Box flexDirection="column">
        <Box marginY={1} marginX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Box marginX={2} gap={2}>
          <Text dimColor>Press <Text bold>s</Text> to select server</Text>
          {initialServer && <Text dimColor>Press <Text bold>r</Text> to retry</Text>}
          <Text dimColor><Text bold>Ctrl+C</Text> exit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {appState && view !== "server-select" && (
        <Header appState={appState} />
      )}

      {error && (
        <Box marginX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {view === "server-select" && (
          <ServerSelect
            onSelect={connectToServer}
            onExit={() => exit()}
          />
        )}

        {view === "menu" && appState && (
          <MainMenu
            appState={appState}
            onNavigate={navigate}
            onSwitchServer={switchServer}
            onExit={() => exit()}
          />
        )}

        {view === "upload" && appState && (
          <UploadView
            appState={appState}
            onBack={handleBack}
            onError={setError}
          />
        )}

        {view === "download" && appState && (
          <DownloadView
            appState={appState}
            onBack={handleBack}
            onError={setError}
          />
        )}

        {view === "note-create" && appState && (
          <NoteCreateView
            appState={appState}
            onBack={handleBack}
            onError={setError}
          />
        )}

        {view === "note-view" && appState && (
          <NoteViewView
            appState={appState}
            onBack={handleBack}
            onError={setError}
            initialUrl={initialNoteUrl}
          />
        )}

        {view === "my-uploads" && appState && (
          <MyUploadsView
            appState={appState}
            onBack={handleBack}
            onError={setError}
          />
        )}

        {view === "settings" && appState && (
          <SettingsView
            appState={appState}
            onBack={handleBack}
            onServerChange={switchServer}
          />
        )}
      </Box>

      <StatusBar view={view} />
    </Box>
  );
}
