import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { decryptNoteContent } from "@skysend/crypto";
import { fetchNoteInfo, viewNote, verifyNotePassword } from "../../lib/api.js";
import { prepareDownload } from "../../lib/auth.js";
import { parseShareUrl } from "../../lib/url.js";
import { TextPrompt } from "../components/TextPrompt.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";

type Phase = "url-input" | "password" | "loading" | "display" | "save-path" | "error";

interface PasswordEntry {
  label: string;
  value: string;
}

interface SSHKeyParts {
  publicKey?: string;
  privateKey?: string;
  passphrase?: string;
}

function parsePasswordContent(raw: string): PasswordEntry[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0].value === "string") {
      return parsed as PasswordEntry[];
    }
  } catch { /* not JSON */ }
  // Legacy: split by double newline
  const blocks = raw.split("\n\n").filter(Boolean);
  if (blocks.length > 0) {
    return blocks.map((b) => ({ label: "", value: b }));
  }
  return null;
}

function parseSSHKeyContent(raw: string): SSHKeyParts {
  const parts: SSHKeyParts = {};
  const passphraseMatch = raw.match(/^Passphrase: (.+)$/m);
  if (passphraseMatch) {
    parts.passphrase = passphraseMatch[1];
  }
  const privateKeyMatch = raw.match(/(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/);
  if (privateKeyMatch) {
    parts.privateKey = privateKeyMatch[1];
  }
  let pubKey = raw;
  if (parts.passphrase) pubKey = pubKey.replace(`Passphrase: ${parts.passphrase}`, "");
  if (parts.privateKey) pubKey = pubKey.replace(parts.privateKey, "");
  pubKey = pubKey.trim();
  if (pubKey) parts.publicKey = pubKey;
  return parts;
}

interface NoteViewViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
  initialUrl?: string;
}

export function NoteViewView({ onBack, initialUrl }: NoteViewViewProps): React.ReactElement {
  const accent = useAccent();
  const [phase, setPhase] = useState<Phase>(initialUrl ? "loading" : "url-input");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("");
  const [viewCount, setViewCount] = useState(0);
  const [maxViews, setMaxViews] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [revealedPasswords, setRevealedPasswords] = useState<Set<number>>(new Set());

  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseShareUrl> | null>(null);
  const [noteInfo, setNoteInfo] = useState<Awaited<ReturnType<typeof fetchNoteInfo>> | null>(null);
  const didAutoLoad = React.useRef(false);

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

  // Auto-load when initialUrl is provided
  React.useEffect(() => {
    if (initialUrl && !didAutoLoad.current) {
      didAutoLoad.current = true;
      void handleUrl(initialUrl);
    }
  }, [initialUrl, handleUrl]);

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

  const handleSave = useCallback((filePath: string) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      setErrorMsg("");
      onBack();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [content, onBack]);

  // Toggle password reveal
  const toggleReveal = useCallback((idx: number) => {
    setRevealedPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  useInput((input, key) => {
    if (phase === "display") {
      if (key.escape) { onBack(); return; }
      if (input === "s") { setPhase("save-path"); return; }
      // Toggle password with number keys
      if (contentType === "password") {
        const idx = parseInt(input, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= 9) {
          toggleReveal(idx - 1);
        }
      }
    }
    if (phase === "error" && (key.return || key.escape)) {
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

  if (phase === "save-path") {
    const ext = contentType === "sshkey" ? "key" : "txt";
    const defaultName = `note-${contentType}.${ext}`;
    return (
      <TextPrompt
        label="Save to"
        defaultValue={path.join(process.cwd(), defaultName)}
        onSubmit={handleSave}
        onCancel={() => setPhase("display")}
      />
    );
  }

  if (phase === "display") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold color={accent}>Note ({contentType})</Text>
          <Text dimColor>View {viewCount} / {maxViews}</Text>
        </Box>

        {contentType === "password" && renderPasswordContent(content, revealedPasswords, accent)}
        {contentType === "sshkey" && renderSSHKeyContent(content, accent)}
        {contentType !== "password" && contentType !== "sshkey" && (
          <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column">
            <Text>{content}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>s save to file  Esc back</Text>
          {contentType === "password" && <Text dimColor>  1-9 toggle reveal</Text>}
        </Box>
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

function renderPasswordContent(
  raw: string,
  revealed: Set<number>,
  accent: string,
): React.ReactElement {
  const entries = parsePasswordContent(raw);
  if (!entries) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text>{raw}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {entries.map((entry, i) => {
        const isRevealed = revealed.has(i);
        const label = entry.label || `Password ${i + 1}`;
        return (
          <Box key={i} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            <Box justifyContent="space-between">
              <Text bold color={accent}>{label}</Text>
              <Text dimColor>[{i + 1}] {isRevealed ? "visible" : "hidden"}</Text>
            </Box>
            <Text>{isRevealed ? entry.value : "\u2022".repeat(Math.min(entry.value.length, 32))}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function renderSSHKeyContent(raw: string, accent: string): React.ReactElement {
  const parts = parseSSHKeyContent(raw);

  return (
    <Box flexDirection="column" gap={1}>
      {parts.publicKey && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold color={accent}>Public Key</Text>
          <Text wrap="wrap">{parts.publicKey}</Text>
        </Box>
      )}
      {parts.privateKey && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold color={accent}>Private Key</Text>
          <Text>{parts.privateKey}</Text>
        </Box>
      )}
      {parts.passphrase && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold color={accent}>Passphrase</Text>
          <Text>{parts.passphrase}</Text>
        </Box>
      )}
    </Box>
  );
}
