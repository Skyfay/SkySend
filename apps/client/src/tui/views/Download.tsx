import React, { useState, useCallback } from "react";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import {
  lookUpShare,
  openShare,
  outputPathFor,
  saveShare,
  type OpenedShare,
} from "../../lib/download-job.js";
import { parseShareUrl } from "../../lib/url.js";
import { forTerminal } from "../../lib/terminal.js";
import { formatBytes, formatSpeed } from "../../lib/progress.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { ProgressBar } from "../components/ProgressBar.js";
import type { AppState } from "../types.js";
import type { UploadInfo } from "../../lib/api.js";

type Phase = "url-input" | "password" | "save-path" | "downloading" | "done" | "error";

interface DownloadViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function DownloadView({ onBack }: DownloadViewProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("url-input");
  const [savePath, setSavePath] = useState("");
  const [share, setShare] = useState<OpenedShare | null>(null);
  const [progress, setProgress] = useState({ percent: 0, speed: "", loaded: 0, total: 0 });
  const [resultPath, setResultPath] = useState("");
  const [resultSize, setResultSize] = useState(0);
  const [avgSpeed, setAvgSpeed] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  /** The link and info of a share that waits for its password. */
  const [locked, setLocked] = useState<{ link: ReturnType<typeof parseShareUrl>; info: UploadInfo } | null>(null);

  const fail = (err: unknown) => {
    setErrorMsg(err instanceof Error ? err.message : String(err));
    setPhase("error");
  };

  /** Opens the share and proposes where to save it. */
  const open = useCallback(async (link: ReturnType<typeof parseShareUrl>, info: UploadInfo, password?: string) => {
    const opened = await openShare(link, info, password);
    setShare(opened);
    setSavePath(outputPathFor(opened.metadata));
    setPhase("save-path");
  }, []);

  const handleUrl = useCallback(async (inputUrl: string) => {
    try {
      if (parseShareUrl(inputUrl.trim()).type !== "file") {
        throw new Error("This URL is a note, not a file. Use 'View note' instead.");
      }
      const { link, info } = await lookUpShare(inputUrl.trim());
      if (info.hasPassword) {
        setLocked({ link, info });
        setPhase("password");
        return;
      }
      await open(link, info);
    } catch (err) {
      fail(err);
    }
  }, [open]);

  const handlePassword = useCallback(async (pw: string) => {
    try {
      if (!locked) return;
      await open(locked.link, locked.info, pw);
    } catch (err) {
      fail(err);
    }
  }, [locked, open]);

  /** Downloads to `target`, the path the user confirmed, a directory or a file. */
  const doDownload = useCallback(async (target: string) => {
    try {
      if (!share) return;
      setPhase("downloading");
      const startTime = Date.now();
      const saved = await saveShare(
        share,
        outputPathFor(share.metadata, path.resolve(target)),
        (written, total) => {
          const elapsed = (Date.now() - startTime) / 1000;
          setProgress({
            percent: total > 0 ? (written / total) * 100 : 0,
            speed: formatSpeed(elapsed > 0 ? written / elapsed : 0),
            loaded: written,
            total,
          });
        },
      );
      setResultPath(saved.file);
      setResultSize(saved.size);
      const elapsedSec = (Date.now() - startTime) / 1000;
      if (elapsedSec > 0 && saved.size > 0) setAvgSpeed(formatSpeed(saved.size / elapsedSec));
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  }, [share]);

  useInput((_input, key) => {
    if ((phase === "done" || phase === "error") && (key.return || key.escape)) {
      onBack();
    }
  }, { isActive: phase === "done" || phase === "error" });

  if (phase === "url-input") {
    return (
      <TextPrompt
        label="Share URL"
        placeholder="https://send.example.com/file/abc123#secret"
        onSubmit={(val) => void handleUrl(val)}
        onCancel={onBack}
        validate={(val) => {
          try { parseShareUrl(val.trim()); return true; } catch { return "Invalid share URL"; }
        }}
      />
    );
  }

  if (phase === "password") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>This file is password protected.</Text>
        <TextPrompt
          label="Password"
          mask="*"
          onSubmit={(val) => void handlePassword(val)}
          onCancel={onBack}
          validate={(val) => val.length > 0 ? true : "Password required"}
        />
      </Box>
    );
  }

  if (phase === "save-path") {
    return (
      <TextPrompt
        label="Save to"
        defaultValue={savePath}
        onSubmit={(val) => { setSavePath(val); void doDownload(val); }}
        onCancel={onBack}
      />
    );
  }

  if (phase === "downloading") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Downloading...</Text>
        </Box>
        <ProgressBar
          percent={progress.percent}
          detail={`${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}  ${progress.speed}`}
        />
      </Box>
    );
  }

  if (phase === "done") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="green">Download complete!</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text><Text dimColor>Saved: </Text>{forTerminal(resultPath)}</Text>
          <Text><Text dimColor>Size:  </Text>{formatBytes(resultSize)}</Text>
          {avgSpeed && <Text><Text dimColor>Avg speed: </Text>{avgSpeed}</Text>}
          {share?.metadata.type === "archive" && (
            <Text><Text dimColor>Archive contains </Text>{share.metadata.files.length} files</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>Download failed</Text>
        <Text color="red">{forTerminal(errorMsg)}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
