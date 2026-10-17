import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { getWebSocket } from "../../lib/config.js";
import { addUpload } from "../../lib/history.js";
import { formatBytes, formatExpiry, formatSpeed } from "../../lib/progress.js";
import { runUpload } from "../../lib/upload-job.js";
import { FileExplorer } from "../components/FileExplorer.js";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { ProgressBar } from "../components/ProgressBar.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";
import { QRCodeDisplay } from "../components/QRCodeDisplay.js";
import { ensureOidcAuth } from "../../lib/oidc.js";
import { forTerminal } from "../../lib/terminal.js";
import { checkNewPassword } from "../../lib/input.js";

type Phase =
  | "file-select"
  | "expiry"
  | "downloads"
  | "password-ask"
  | "password-input"
  | "confirm"
  | "authenticating"
  | "uploading"
  | "done"
  | "error";

interface UploadViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function UploadView({ appState, onBack }: UploadViewProps): React.ReactElement {
  const accent = useAccent();
  const { server, config } = appState;
  const [phase, setPhase] = useState<Phase>("file-select");
  const [files, setFiles] = useState<string[]>([]);
  const [expireSec, setExpireSec] = useState(config.fileDefaultExpire);
  const [maxDownloads, setMaxDownloads] = useState(config.fileDefaultDownload);
  const [password, setPassword] = useState<string | undefined>();
  const [progress, setProgress] = useState({ percent: 0, speed: "", loaded: 0, total: 0 });
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [avgSpeed, setAvgSpeed] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [transport, setTransport] = useState<"WebSocket" | "HTTP chunked">("HTTP chunked");

  const totalSize = files.reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);

  const doUpload = useCallback(async () => {
    try {
      // Authenticate with OIDC before uploading if the server requires it.
      let oidcToken: string | undefined;
      if (config.oidcProtectFiles) {
        setPhase("authenticating");
        oidcToken = await ensureOidcAuth(server);
      }

      setPhase("uploading");
      setIsFinalizing(false);
      setAvgSpeed("");
      const startTime = Date.now();
      let uploadEndTime = 0;
      let lastTotal = 0;
      const result = await runUpload(
        {
          server,
          paths: files,
          config,
          expireSec,
          maxDownloads,
          ...(password !== undefined ? { password } : {}),
          ...(oidcToken ? { oidcToken } : {}),
          webSocket: getWebSocket(server),
        },
        {
          onTransport: (used) => setTransport(used === "ws" ? "WebSocket" : "HTTP chunked"),
          onProgress: (loaded, total) => {
            lastTotal = total;
            const elapsed = (Date.now() - startTime) / 1000;
            setProgress({
              percent: total > 0 ? (loaded / total) * 100 : 0,
              speed: formatSpeed(elapsed > 0 ? loaded / elapsed : 0),
              loaded,
              total,
            });
          },
          onPhase: (next) => {
            if (next !== "saving-meta" || uploadEndTime > 0) return;
            uploadEndTime = Date.now();
            setIsFinalizing(true);
          },
        },
      );
      setShareUrl(result.url);

      const elapsedSec = ((uploadEndTime || Date.now()) - startTime) / 1000;
      if (elapsedSec > 0 && lastTotal > 0) setAvgSpeed(formatSpeed(lastTotal / elapsedSec));

      addUpload({
        id: result.id, server, url: result.url,
        ownerToken: result.ownerToken,
        fileNames: result.names,
        totalSize: result.totalSize, hasPassword: result.hasPassword,
        createdAt: new Date().toISOString(), expireSec,
      });

      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [files, password, maxDownloads, expireSec, server, config]);

  // Done / Error view - press any key to go back
  useInput((input, key) => {
    if (phase === "done" && input === "q") {
      setShowQR((v) => !v);
      return;
    }
    if ((phase === "done" || phase === "error") && (key.return || key.escape)) {
      onBack();
    }
  }, { isActive: phase === "done" || phase === "error" });

  // File select
  if (phase === "file-select") {
    return (
      <FileExplorer
        onConfirm={(selected) => {
          setFiles(selected);
          setPhase("expiry");
        }}
        onCancel={onBack}
        maxFiles={config.fileMaxFilesPerUpload}
        maxSize={config.fileMaxSize}
      />
    );
  }

  // Expiry selection
  if (phase === "expiry") {
    const items: Array<SelectItem<number>> = config.fileExpireOptions.map((s) => ({
      label: formatExpiry(s),
      value: s,
    }));
    return (
      <SelectList
        key="expiry"
        items={items}
        initialValue={expireSec}
        title={`Expiry time (${files.length} file${files.length !== 1 ? "s" : ""}, ${formatBytes(totalSize)})`}
        onSelect={(val) => { setExpireSec(val); setPhase("downloads"); }}
        onCancel={onBack}
      />
    );
  }

  // Download count
  if (phase === "downloads") {
    const items: Array<SelectItem<number>> = config.fileDownloadOptions.map((d) => ({
      label: String(d),
      value: d,
    }));
    return (
      <SelectList
        key="downloads"
        items={items}
        initialValue={maxDownloads}
        title="Max downloads"
        onSelect={(val) => { setMaxDownloads(val); setPhase("password-ask"); }}
        onCancel={() => setPhase("expiry")}
      />
    );
  }

  // Password ask
  if (phase === "password-ask") {
    if (config.forceFilePassword) {
      // Skip the Yes/No question - password is required
      return (
        <TextPrompt
          label="Password (required by server policy)"
          mask="*"
          onSubmit={(val) => { setPassword(val); setPhase("confirm"); }}
          onCancel={() => setPhase("downloads")}
          validate={checkNewPassword}
        />
      );
    }
    return (
      <SelectList
        key="password-ask"
        items={[
          { label: "No", value: "no" },
          { label: "Yes", value: "yes" },
        ]}
        title="Password protect?"
        onSelect={(val) => {
          if (val === "yes") setPhase("password-input");
          else { setPassword(undefined); setPhase("confirm"); }
        }}
        onCancel={() => setPhase("downloads")}
      />
    );
  }

  // Password input
  if (phase === "password-input") {
    return (
      <TextPrompt
        label="Password"
        mask="*"
        onSubmit={(val) => { setPassword(val); setPhase("confirm"); }}
        onCancel={() => setPhase("password-ask")}
        validate={checkNewPassword}
      />
    );
  }

  // Confirm
  if (phase === "confirm") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Upload summary</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>Files:     </Text>{files.length} ({formatBytes(totalSize)})</Text>
          <Text><Text dimColor>Names:     </Text>{files.map((f) => path.basename(f)).join(", ")}</Text>
          <Text><Text dimColor>Expires:   </Text>{formatExpiry(expireSec)}</Text>
          <Text><Text dimColor>Downloads: </Text>{maxDownloads}</Text>
          <Text><Text dimColor>Password:  </Text>{password ? "yes" : "no"}</Text>
        </Box>
        <Box marginTop={1}>
          <SelectList
            key="confirm"
            items={[
              { label: "Start upload", value: "go" },
              { label: "Cancel", value: "cancel" },
            ]}
            onSelect={(val) => {
              if (val === "go") void doUpload();
              else onBack();
            }}
          />
        </Box>
      </Box>
    );
  }

  // Authenticating (browser OIDC flow)
  if (phase === "authenticating") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Waiting for browser login...</Text>
        </Box>
        <Text dimColor>A browser window has been opened for authentication.</Text>
        <Text dimColor>Complete the login and return here.</Text>
      </Box>
    );
  }

  // Uploading
  if (phase === "uploading") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>{isFinalizing ? "Finalizing..." : "Uploading..."}</Text>
        </Box>
        <ProgressBar
          percent={progress.percent}
          detail={isFinalizing
            ? "Waiting for server confirmation..."
            : `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}  ${progress.speed}`}
        />
      </Box>
    );
  }

  // Done
  if (phase === "done") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="green">Upload complete!</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>Share URL: </Text><Text color={accent}>{shareUrl}</Text></Text>
          <Text><Text dimColor>Files:     </Text>{files.length} ({formatBytes(totalSize)})</Text>
          <Text><Text dimColor>Expires:   </Text>{formatExpiry(expireSec)}</Text>
          <Text><Text dimColor>Downloads: </Text>{maxDownloads}</Text>
          <Text><Text dimColor>Transport: </Text>{transport}</Text>
          {avgSpeed !== "" && <Text><Text dimColor>Avg speed: </Text>{avgSpeed}</Text>}
          {password && <Text><Text dimColor>Password:  </Text>yes</Text>}
        </Box>
        {showQR && (
          <Box marginTop={1}>
            <QRCodeDisplay url={shareUrl} />
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>q QR code  Enter/Esc back</Text>
        </Box>
      </Box>
    );
  }

  // Error
  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>Upload failed</Text>
        <Text color="red">{forTerminal(errorMsg)}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
