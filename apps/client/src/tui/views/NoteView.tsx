import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { decryptNoteContent } from "@skysend/crypto";
import { noteToText, type ReadBlock } from "@skysend/note-format";
import { fetchNoteInfo, viewNote, verifyNotePassword } from "../../lib/api.js";
import { prepareDownload } from "../../lib/auth.js";
import { forTerminal, noteFileName, readReceivedNote } from "../../lib/note.js";
import { parseShareUrl } from "../../lib/url.js";
import { TextPrompt } from "../components/TextPrompt.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";

type Phase = "url-input" | "password" | "loading" | "display" | "save-path" | "error";

function Frame({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
      <Text bold color={accent}>{title}</Text>
      {children}
    </Box>
  );
}

/**
 * The blocks of a note, one frame each. Passwords are numbered across the whole note, so
 * the number keys reveal them wherever they are.
 */
function renderBlocks(blocks: readonly ReadBlock[], revealed: ReadonlySet<number>, accent: string): React.ReactElement {
  const firstEntry: number[] = [];
  let entries = 0;
  for (const block of blocks) {
    firstEntry.push(entries);
    if (block.type === "password") entries += block.entries.length;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <Frame key={i} title={block.format === "markdown" ? "Markdown" : "Text"} accent={accent}>
                <Text>{forTerminal(block.text)}</Text>
              </Frame>
            );
          case "password":
            return (
              <Box key={i} flexDirection="column" gap={1}>
                {block.entries.map((entry, j) => {
                  const number = firstEntry[i]! + j + 1;
                  // An entry that is no secret, like a username, is shown without a reveal.
                  const plain = entry.secret === false;
                  const shown = plain || revealed.has(number);
                  return (
                    <Box key={j} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
                      <Box justifyContent="space-between">
                        <Text bold color={accent}>{entry.label ? forTerminal(entry.label) : `Password ${number}`}</Text>
                        <Text dimColor>{plain ? "" : `[${number}] ${shown ? "visible" : "hidden"}`}</Text>
                      </Box>
                      <Text>{shown ? forTerminal(entry.value) : "•".repeat(Math.min(entry.value.length, 32))}</Text>
                    </Box>
                  );
                })}
              </Box>
            );
          case "code":
            return (
              <Frame key={i} title={forTerminal(`${block.title || "Code"}${block.language === "auto" ? "" : ` (${block.language})`}`)} accent={accent}>
                <Text>{forTerminal(block.code)}</Text>
              </Frame>
            );
          case "sshkey":
            return (
              <Box key={i} flexDirection="column" gap={1}>
                {block.publicKey && (
                  <Frame title="Public Key" accent={accent}>
                    <Text wrap="wrap">{forTerminal(block.publicKey)}</Text>
                  </Frame>
                )}
                {block.privateKey && (
                  <Frame title="Private Key" accent={accent}>
                    <Text>{forTerminal(block.privateKey)}</Text>
                  </Frame>
                )}
                {block.passphrase && (
                  <Frame title="Passphrase" accent={accent}>
                    <Text>{forTerminal(block.passphrase)}</Text>
                  </Frame>
                )}
              </Box>
            );
          case "unsupported":
            return (
              <Text key={i} dimColor>
                This part of the note needs a newer version of SkySend.
              </Text>
            );
        }
      })}
    </Box>
  );
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
  const [blocks, setBlocks] = useState<ReadBlock[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [viewCount, setViewCount] = useState(0);
  const [maxViews, setMaxViews] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [revealedPasswords, setRevealedPasswords] = useState<Set<number>>(new Set());

  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseShareUrl> | null>(null);
  const [noteInfo, setNoteInfo] = useState<Awaited<ReturnType<typeof fetchNoteInfo>> | null>(null);
  const didAutoLoad = React.useRef(false);

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

    // Notes from before v3 are read in their legacy format.
    const read = readReceivedNote(info.contentType, decrypted);
    setBlocks(read.blocks);
    setUnreadable(read.unreadable);
    setViewCount(response.viewCount);
    setMaxViews(response.maxViews);
    setPhase("display");
  }, []);

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

      if (info.hasPassword) {
        setPhase("password");
        return;
      }

      await loadNote(parsed, info);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [loadNote]);

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
      // Only the owner may read it: the note can hold passwords and private keys.
      fs.writeFileSync(filePath, noteToText(blocks), { encoding: "utf-8", mode: 0o600 });
      setErrorMsg("");
      onBack();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [blocks, onBack]);

  const passwordCount = blocks.reduce((sum, block) => sum + (block.type === "password" ? block.entries.length : 0), 0);
  const hasPasswords = passwordCount > 0;

  // Toggle password reveal
  const toggleReveal = useCallback((number: number) => {
    setRevealedPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number); else next.add(number);
      return next;
    });
  }, []);

  useInput((input, key) => {
    if (phase === "display") {
      if (key.escape) { onBack(); return; }
      if (input === "s") { setPhase("save-path"); return; }
      // A note made of blocks can hold more than nine passwords, so a reveals or hides all.
      if (hasPasswords && input === "a") {
        setRevealedPasswords((prev) =>
          prev.size === passwordCount ? new Set() : new Set(Array.from({ length: passwordCount }, (_, i) => i + 1)),
        );
        return;
      }
      // Toggle password with number keys
      if (hasPasswords) {
        const number = parseInt(input, 10);
        if (!isNaN(number) && number >= 1 && number <= 9) {
          toggleReveal(number);
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
    return (
      <TextPrompt
        label="Save to"
        defaultValue={path.join(process.cwd(), noteFileName(blocks))}
        onSubmit={handleSave}
        onCancel={() => setPhase("display")}
      />
    );
  }

  if (phase === "display") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold color={accent}>Note ({blocks.length === 1 ? "1 block" : `${blocks.length} blocks`})</Text>
          <Text dimColor>{maxViews === 0 ? `View ${viewCount} (unlimited)` : `View ${viewCount} / ${maxViews}`}</Text>
        </Box>

        {unreadable && (
          <Box marginBottom={1}>
            <Text color="yellow">This note could not be read as usual, so it is shown exactly as it arrived.</Text>
          </Box>
        )}

        {renderBlocks(blocks, revealedPasswords, accent)}

        <Box marginTop={1}>
          <Text dimColor>s save to file  Esc back</Text>
          {hasPasswords && <Text dimColor>  1-9 toggle reveal  a all</Text>}
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
