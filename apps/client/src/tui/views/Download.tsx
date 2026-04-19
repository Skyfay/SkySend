import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { createDecryptStream, decryptMetadata, type FileMetadata } from "@skysend/crypto";
import { fetchInfo, downloadFile, verifyPassword } from "../../lib/api.js";
import { prepareDownload } from "../../lib/auth.js";
import { parseShareUrl } from "../../lib/url.js";
import { formatBytes, formatSpeed } from "../../lib/progress.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { ProgressBar } from "../components/ProgressBar.js";
import type { AppState } from "../types.js";

type Phase = "url-input" | "password" | "save-path" | "downloading" | "done" | "error";

interface DownloadViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function DownloadView({ onBack }: DownloadViewProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("url-input");
  const [password, setPassword] = useState<string | undefined>();
  const [savePath, setSavePath] = useState("");
  const [metadata, setMetadata] = useState<FileMetadata | undefined>();
  const [progress, setProgress] = useState({ percent: 0, speed: "", loaded: 0, total: 0 });
  const [resultPath, setResultPath] = useState("");
  const [resultSize, setResultSize] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Stored parsed values
  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseShareUrl> | null>(null);
  const [fileInfo, setFileInfo] = useState<Awaited<ReturnType<typeof fetchInfo>> | null>(null);

  const handleUrl = useCallback(async (inputUrl: string) => {
    try {
      const parsed = parseShareUrl(inputUrl.trim());
      if (parsed.type !== "file") {
        setErrorMsg("This URL is a note, not a file. Use 'View note' instead.");
        setPhase("error");
        return;
      }
      setParsedUrl(parsed);

      const info = await fetchInfo(parsed.server, parsed.id);
      setFileInfo(info);

      if (info.hasPassword) {
        setPhase("password");
        return;
      }

      // Derive keys and get metadata for filename
      const creds = await prepareDownload(parsed.secret, info.salt);
      let meta: FileMetadata | undefined;
      if (info.encryptedMeta && info.nonce) {
        const ct = new Uint8Array(Buffer.from(info.encryptedMeta, "base64")) as Uint8Array<ArrayBuffer>;
        const iv = new Uint8Array(Buffer.from(info.nonce, "base64")) as Uint8Array<ArrayBuffer>;
        meta = await decryptMetadata(ct, iv, creds.keys.metaKey);
      }
      setMetadata(meta);
      const name = meta?.type === "single" ? meta.name : meta?.type === "archive" ? "archive.zip" : `download-${parsed.id}`;
      setSavePath(path.join(process.cwd(), name));
      setPhase("save-path");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  const handlePassword = useCallback(async (pw: string) => {
    try {
      if (!parsedUrl || !fileInfo) return;
      setPassword(pw);
      const creds = await prepareDownload(
        parsedUrl.secret, fileInfo.salt, pw, fileInfo.passwordSalt, fileInfo.passwordAlgo,
      );
      const valid = await verifyPassword(parsedUrl.server, parsedUrl.id, creds.authTokenB64);
      if (!valid) {
        setErrorMsg("Invalid password");
        setPhase("error");
        return;
      }
      let meta: FileMetadata | undefined;
      if (fileInfo.encryptedMeta && fileInfo.nonce) {
        const ct = new Uint8Array(Buffer.from(fileInfo.encryptedMeta, "base64")) as Uint8Array<ArrayBuffer>;
        const iv = new Uint8Array(Buffer.from(fileInfo.nonce, "base64")) as Uint8Array<ArrayBuffer>;
        meta = await decryptMetadata(ct, iv, creds.keys.metaKey);
      }
      setMetadata(meta);
      const name = meta?.type === "single" ? meta.name : meta?.type === "archive" ? "archive.zip" : `download-${parsedUrl.id}`;
      setSavePath(path.join(process.cwd(), name));
      setPhase("save-path");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [parsedUrl, fileInfo]);

  const doDownload = useCallback(async () => {
    try {
      if (!parsedUrl || !fileInfo) return;
      setPhase("downloading");

      const creds = await prepareDownload(
        parsedUrl.secret, fileInfo.salt, password, fileInfo.passwordSalt, fileInfo.passwordAlgo,
      );

      const outputPath = path.resolve(savePath);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const { stream } = await downloadFile(parsedUrl.server, parsedUrl.id, creds.authTokenB64);
      const decryptedStream = stream.pipeThrough(createDecryptStream(creds.keys.fileKey));

      const writer = fs.createWriteStream(outputPath);
      const reader = decryptedStream.getReader();
      const startTime = Date.now();
      let totalWritten = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value);
        totalWritten += value.byteLength;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? totalWritten / elapsed : 0;
        setProgress({
          percent: fileInfo.size > 0 ? (totalWritten / fileInfo.size) * 100 : 0,
          speed: formatSpeed(speed),
          loaded: totalWritten,
          total: fileInfo.size,
        });
      }

      await new Promise<void>((resolve, reject) => {
        writer.end(() => resolve());
        writer.on("error", reject);
      });

      setResultPath(outputPath);
      setResultSize(totalWritten);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [parsedUrl, fileInfo, password, savePath]);

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
        onSubmit={(val) => { setSavePath(val); void doDownload(); }}
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
          <Text><Text dimColor>Saved: </Text>{resultPath}</Text>
          <Text><Text dimColor>Size:  </Text>{formatBytes(resultSize)}</Text>
          {metadata?.type === "archive" && (
            <Text><Text dimColor>Archive contains </Text>{metadata.files.length} files</Text>
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
        <Text color="red">{errorMsg}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
