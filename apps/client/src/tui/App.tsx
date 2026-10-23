import React, { Activity, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { trimTrailingSlashes } from "@skysend/transfer";
import { apiFor } from "../lib/api.js";
import { addServer, getServers } from "../lib/config.js";
import { forTerminal } from "../lib/terminal.js";
import type { TabId, AppState } from "./types.js";
import { COLORS, ThemeProvider, useAccent } from "./theme.js";
import { ShellContext, type HandedRequest, type KeyHint, type ShellState } from "./shell.js";
import { Header, KeyBar, Panel, T, Toast, Gap, type Tab } from "./components/Frame.js";
import { WelcomeView } from "./views/Welcome.js";
import { UploadView } from "./views/Upload.js";
import { ReceiveView } from "./views/Receive.js";
import { NoteCreateView } from "./views/NoteCreate.js";
import { MyUploadsView } from "./views/MyUploads.js";
import { SettingsView } from "./views/Settings.js";

interface AppProps {
  initialServer?: string;
  /** A note link to open in the Receive tab, from `skysend note-view`. */
  initialNoteUrl?: string;
}

export function App({ initialServer, initialNoteUrl }: AppProps): React.ReactElement {
  const [accentColor, setAccentColor] = useState<string | null>(null);
  return (
    <ThemeProvider color={accentColor}>
      <Shell initialServer={initialServer} initialNoteUrl={initialNoteUrl} setAccentColor={setAccentColor} />
    </ThemeProvider>
  );
}

/** The widest the TUI gets, so a wide terminal does not stretch the cards across the screen. */
const MAX_WIDTH = 100;

/**
 * The frame of the TUI: the tab bar on top, the tab below, the keys at the bottom. The cursor is
 * in the tab bar or in the tab. In the tab bar ← and → switch tabs and ↓ goes in, in the tab
 * esc, or ↑ on its first row, comes back up.
 */
function Shell({ initialServer, initialNoteUrl, setAccentColor }: AppProps & {
  setAccentColor: (color: string | null) => void;
}): React.ReactElement {
  const { exit } = useApp();
  const accent = useAccent();
  const { columns, rows } = useWindowSize();
  const width = Math.max(40, Math.min(columns, MAX_WIDTH));
  const [appState, setAppState] = useState<AppState | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // The address last tried, so a failed one comes back into the field to correct it.
  const [lastTried, setLastTried] = useState<string | undefined>(initialServer);
  const [tab, setTab] = useState<TabId>(initialNoteUrl ? "receive" : "send");
  const [inTabs, setInTabs] = useState(false);
  // A new key starts a tab over.
  const [keys, setKeys] = useState<Record<TabId, number>>({ send: 0, receive: 0, note: 0, links: 0, settings: 0 });
  const [shell, setShell] = useState<ShellState>({ hints: [], typing: false });
  const [toast, setToast] = useState<string | null>(null);
  // An upload link of a file request, handed from another tab to the Send tab.
  const [handOver, setHandOver] = useState<{ request: HandedRequest; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didAutoConnect = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  const toTabs = useCallback(() => setInTabs(true), []);

  // The header takes 3 rows and the key bar 1, the rest is the tab's.
  const height = Math.max(10, rows - (appState ? 5 : 2));
  const sendInto = useCallback((request: HandedRequest) => {
    if (!appState?.config.enabledServices.includes("file")) {
      showToast("This server has no Send tab to send into the request from.");
      return;
    }
    setHandOver((prev) => ({ request, n: (prev?.n ?? 0) + 1 }));
    setTab("send");
    setInTabs(false);
  }, [appState, showToast]);
  const shellApi = useMemo(
    () => ({ set: setShell, toast: showToast, toTabs, sendInto, active: !inTabs, width, height }),
    [showToast, toTabs, sendInto, inTabs, width, height],
  );

  /** `remember` saves a server picked on the welcome screen, not one given with --server. */
  const connect = useCallback(async (url: string, remember: boolean) => {
    const server = trimTrailingSlashes(url);
    setConnecting(server);
    setLastTried(server);
    setConnectError(null);
    try {
      const api = apiFor(server);
      const config = await api.fetchConfig();
      const quota = await api.fetchQuota().catch(() => undefined);
      const saved = getServers().find((s) => s.url === server);
      // The first server saved becomes the default.
      if (!saved && remember) addServer(new URL(server).host, server);
      setAppState({ server, serverName: saved?.name ?? new URL(server).host, config, ...(quota ? { quota } : {}) });
      setAccentColor(config.customColor);
      setInTabs(false);
      setTab((current) => (current === "send" && !config.enabledServices.includes("file") ? "receive" : current));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnectError(
        message === "fetch failed" || message.includes("ECONNREFUSED")
          ? `${server} is not reachable`
          : message,
      );
    } finally {
      setConnecting(null);
    }
  }, [setAccentColor]);

  useEffect(() => {
    if (initialServer && !didAutoConnect.current) {
      didAutoConnect.current = true;
      void connect(initialServer, false);
    }
  }, [initialServer, connect]);

  const refreshQuota = useCallback(async () => {
    if (!appState) return;
    const quota = await apiFor(appState.server).fetchQuota().catch(() => undefined);
    if (quota) setAppState((prev) => (prev ? { ...prev, quota } : prev));
  }, [appState]);

  const tabs = useMemo<Tab<TabId>[]>(() => {
    const services = appState?.config.enabledServices ?? [];
    return [
      ...(services.includes("file") ? [{ id: "send" as const, label: "Send" }] : []),
      { id: "receive", label: "Receive" },
      ...(services.includes("note") ? [{ id: "note" as const, label: "Note" }] : []),
      { id: "links", label: "My links" },
      { id: "settings", label: "Settings" },
    ];
  }, [appState]);

  const restartTab = useCallback((id: TabId) => {
    setKeys((prev) => ({ ...prev, [id]: prev[id] + 1 }));
  }, []);

  const switchServer = useCallback(() => {
    setAppState(null);
    setAccentColor(null);
    setTab("send");
    setKeys((prev) => ({ send: prev.send + 1, receive: prev.receive + 1, note: prev.note + 1, links: prev.links + 1, settings: prev.settings + 1 }));
  }, [setAccentColor]);

  useInput((input, key) => {
    if (!appState) {
      if (input === "q" && !shell.typing) exit();
      return;
    }
    if (!inTabs) return;
    const at = tabs.findIndex((t) => t.id === tab);
    if (key.leftArrow) setTab(tabs[(at + tabs.length - 1) % tabs.length]!.id);
    else if (key.rightArrow) setTab(tabs[(at + 1) % tabs.length]!.id);
    else if (key.downArrow || key.return || key.tab) setInTabs(false);
    else if (input === "q") exit();
  });

  const hints: KeyHint[] = appState && inTabs
    ? [{ key: "← →", label: "switch tab" }, { key: "↓", label: "go into the tab" }]
    : shell.hints;
  const right: KeyHint[] = (appState && inTabs) || (!appState && !shell.typing)
    ? [{ key: "q", label: "quit" }]
    : [{ key: "ctrl+c", label: "quit" }];

  let content: React.ReactNode;
  if (!appState && connecting) {
    content = (
      <Panel width={width}>
        <Gap />
        <T><Text color={accent}>⣾</Text> Connecting to {forTerminal(new URL(connecting).host)}</T>
        <Gap />
      </Panel>
    );
  } else if (!appState) {
    content = (
      <WelcomeView
        width={width}
        height={height}
        onConnect={(url) => void connect(url, true)}
        error={connectError}
        initialUrl={lastTried}
      />
    );
  } else {
    const common = (id: TabId) => ({ appState, onBack: () => restartTab(id), onError: () => {} });
    const view = (id: TabId): React.ReactNode => {
      switch (id) {
        case "send":
          return <UploadView {...common(id)} onUploaded={() => void refreshQuota()} handOver={handOver} />;
        case "receive":
          return <ReceiveView {...common(id)} initialUrl={initialNoteUrl} />;
        case "note":
          return <NoteCreateView {...common(id)} />;
        case "links":
          return <MyUploadsView {...common(id)} />;
        case "settings":
          return <SettingsView {...common(id)} onServerChange={switchServer} />;
      }
    };
    // Every tab stays mounted, a hidden one keeps what was picked and typed and its transfer
    // runs on. Activity also drops the hidden tab's effects, so only the shown one takes keys.
    content = (
      <>
        {tabs.map((t) => (
          <Activity key={`${t.id}-${keys[t.id]}`} mode={t.id === tab ? "visible" : "hidden"}>
            <Box flexDirection="column">{view(t.id)}</Box>
          </Activity>
        ))}
      </>
    );
  }

  return (
    <ShellContext.Provider value={shellApi}>
      <Box width={columns} height={rows} backgroundColor={COLORS.page} flexDirection="column" alignItems="center">
        <Box flexDirection="column" width={width} height={rows}>
          {appState && (
            <Header
              title={forTerminal(appState.config.customTitle || "SkySend")}
              tabs={tabs}
              active={tab}
              focused={inTabs}
              host={forTerminal(new URL(appState.server).host)}
              width={width}
            />
          )}
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {!appState && <Gap />}
            {content}
          </Box>
          <KeyBar hints={hints} right={right} width={width} />
          {toast && <Toast message={toast} />}
        </Box>
      </Box>
    </ShellContext.Provider>
  );
}
