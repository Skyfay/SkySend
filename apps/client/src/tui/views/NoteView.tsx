import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { decryptNoteContent } from "@skysend/crypto";
import { fetchNoteInfo, viewNote, verifyNotePassword } from "../../lib/api.js";
import { prepareDownload } from "../../lib/auth.js";
import { parseShareUrl } from "../../lib/url.js";
import { TextPrompt } from "../components/TextPrompt.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";

type Phase = "url-input" | "password" | "loading" | "display" | "error";

interface NoteViewViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function NoteViewView({ onBack }: NoteViewViewProps): React.ReactElement {
  const accent = useAccent();
  const [phase, setPhase] = useState<Phase>("url-input");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("");
  const [viewCount, setViewCount] = useState(0);
  const [maxViews, setMaxViews] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseShareUrl> | null>(null);
  const [noteInfo, setNoteInfo] = useState<Awaited<ReturnType<typeof fetchNoteInfo>> | null>(null);

  const handleUrl = useCallback(async (inputUrl: string) => {
    try {
      const parsed = parseShareUrl(inputUrl.trim());
      if (parsed.type !== "note") {
        setErrorMsg("This URL is a file, not a note. Use 'Download file' instead.");
        setPhase("error");
        return;
      }
      setParsedUrl(parsed);

      const info = await fetchNoteInfo(parsed.server, parsed.id);
      setNoteInfo(info);
      setContentType(info.contentType);

      if (info.hasPassword) {
        setPhase("password");
        return;
      }

      await loadNote(parsed, info);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  const loadNote = useCallback(async (
    parsed: ReturnType<typeof parseShareUrl>,
    info: Awaited<ReturnType<typeof fetchNoteInfo>>,
    pw?: string,
  ) => {
    setPhase("loading");
    const creds = await prepareDownload(
      parsed.secret, info.salt, pw, info.passwordSalt, info.passwordAlgo,
    );

    const response = await viewNote(parsed.server, parsed.id, creds.authTokenB64);

    const ct = new Uint8Array(Buffer.from(response.encryptedContent, "base64")) as Uint8Array<ArrayBuffer>;
    const nonce = new Uint8Array(Buffer.from(response.nonce, "base64")) as Uint8Array<ArrayBuffer>;
    const decrypted = await decryptNoteContent(ct, nonce, creds.keys.metaKey);

    setContent(decrypted);
    setViewCount(response.viewCount);
    setMaxViews(response.maxViews);
    setPhase("display");
  }, []);

  const handlePassword = useCallback(async (pw: string) => {
    try {
      if (!parsedUrl || !noteInfo) return;

      const creds = await prepareDownload(
        parsedUrl.secret, noteInfo.salt, pw, noteInfo.passwordSalt, noteInfo.passwordAlgo,
      );
      const valid = await verifyNotePassword(parsedUrl.server, parsedUrl.id, creds.authTokenB64);
      if (!valid) {
        setErrorMsg("Invalid password");
        setPhase("error");
        return;
      }

      await loadNote(parsedUrl, noteInfo, pw);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [parsedUrl, noteInfo, loadNote]);

  useInput((_input, key) => {
    if ((phase === "display" || phase === "error") && (key.return || key.escape)) {
      onBack();
    }
  }, { isActive: phase === "display" || phase === "error" });

  if (phase === "url-input") {
    return (
      <TextPrompt
        label="Note URL"
        placeholder="https://send.example.com/note/abc123#secret"
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
        <Text dimColor>This note is password protected.</Text>
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

  if (phase === "loading") {
    return (
      <Box paddingX={1}><Text>Decrypting note...</Text></Box>
    );
  }

  if (phase === "display") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold color={accent}>Note ({contentType})</Text>
          <Text dimColor>View {viewCount} / {maxViews}</Text>
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column">
          <Text>{content}</Text>
        </Box>
        <Box marginTop={1}><Text dimColor>Press Enter or Esc to go back</Text></Box>
      </Box>
    );
  }

  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>Error</Text>
        <Text color="red">{errorMsg}</Text>
        <Box marginTop={1}><Text dimColor>Press Enter or Esc to go back</Text></Box>
      </Box>
    );
  }

  return <Box />;
}
