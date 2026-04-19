import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import { encryptNoteContent, toBase64url, type NoteContentType } from "@skysend/crypto";
import { createNote } from "../../lib/api.js";
import { prepareUpload } from "../../lib/auth.js";
import { buildShareUrl } from "../../lib/url.js";
import { addNote } from "../../lib/history.js";
import { formatBytes, formatExpiry } from "../../lib/progress.js";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";

type Phase = "type" | "content" | "expiry" | "views" | "password-ask" | "password-input" | "creating" | "done" | "error";

interface NoteCreateViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function NoteCreateView({ appState, onBack }: NoteCreateViewProps): React.ReactElement {
  const accent = useAccent();
  const { server, config } = appState;
  const [phase, setPhase] = useState<Phase>("type");
  const [contentType, setContentType] = useState<NoteContentType>("text");
  const [content, setContent] = useState("");
  const [expireSec, setExpireSec] = useState(config.noteDefaultExpire);
  const [maxViews, setMaxViews] = useState(config.noteDefaultViews);
  const [password, setPassword] = useState<string | undefined>();
  const [shareUrl, setShareUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const doCreate = useCallback(async () => {
    try {
      setPhase("creating");
      const creds = await prepareUpload(password);
      const encrypted = await encryptNoteContent(content, creds.keys.metaKey);

      const result = await createNote(server, {
        encryptedContent: Buffer.from(encrypted.ciphertext).toString("base64"),
        nonce: Buffer.from(encrypted.nonce).toString("base64"),
        salt: toBase64url(creds.salt),
        ownerToken: creds.ownerTokenB64,
        authToken: creds.authTokenB64,
        contentType, maxViews, expireSec,
        hasPassword: creds.hasPassword,
        ...(creds.hasPassword && creds.passwordSalt && creds.passwordAlgo
          ? { passwordSalt: toBase64url(creds.passwordSalt), passwordAlgo: creds.passwordAlgo }
          : {}),
      });

      const url = buildShareUrl(server, "note", result.id, creds.effectiveSecretB64);
      setShareUrl(url);

      addNote({
        id: result.id, server, url,
        ownerToken: creds.ownerTokenB64,
        contentType, hasPassword: creds.hasPassword,
        createdAt: new Date().toISOString(), expireSec,
      });

      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [content, contentType, maxViews, expireSec, password, server]);

  useInput((_input, key) => {
    if ((phase === "done" || phase === "error") && (key.return || key.escape)) {
      onBack();
    }
  }, { isActive: phase === "done" || phase === "error" });

  if (phase === "type") {
    const items: Array<SelectItem<NoteContentType>> = [
      { label: "Text", value: "text" },
      { label: "Password", value: "password" },
      { label: "Code", value: "code" },
      { label: "Markdown", value: "markdown" },
      { label: "SSH Key", value: "sshkey" },
    ];
    return (
      <SelectList
        items={items}
        title="Note type"
        onSelect={(val) => { setContentType(val); setPhase("content"); }}
        onCancel={onBack}
      />
    );
  }

  if (phase === "content") {
    const label = contentType === "sshkey" ? "Path to SSH key file" : "Content (or @filepath)";
    return (
      <TextPrompt
        label={label}
        onSubmit={(val) => {
          let noteContent: string;
          if (contentType === "sshkey") {
            const resolved = path.resolve(val.trim());
            if (!fs.existsSync(resolved)) { setErrorMsg(`File not found: ${resolved}`); setPhase("error"); return; }
            noteContent = fs.readFileSync(resolved, "utf-8");
          } else if (val.startsWith("@")) {
            const resolved = path.resolve(val.slice(1).trim());
            if (!fs.existsSync(resolved)) { setErrorMsg(`File not found: ${resolved}`); setPhase("error"); return; }
            noteContent = fs.readFileSync(resolved, "utf-8");
          } else {
            noteContent = val;
          }
          if (new TextEncoder().encode(noteContent).byteLength > config.noteMaxSize) {
            setErrorMsg(`Note too large (max ${formatBytes(config.noteMaxSize)})`);
            setPhase("error");
            return;
          }
          setContent(noteContent);
          setPhase("expiry");
        }}
        onCancel={onBack}
        validate={(val) => val.trim().length > 0 ? true : "Content cannot be empty"}
      />
    );
  }

  if (phase === "expiry") {
    const items: Array<SelectItem<number>> = config.noteExpireOptions.map((s) => ({
      label: formatExpiry(s), value: s,
    }));
    return (
      <SelectList items={items} title="Expiry time" onSelect={(val) => { setExpireSec(val); setPhase("views"); }} onCancel={() => setPhase("content")} />
    );
  }

  if (phase === "views") {
    const items: Array<SelectItem<number>> = config.noteViewOptions.map((v) => ({
      label: String(v), value: v,
    }));
    return (
      <SelectList items={items} title="Max views" onSelect={(val) => { setMaxViews(val); setPhase("password-ask"); }} onCancel={() => setPhase("expiry")} />
    );
  }

  if (phase === "password-ask") {
    return (
      <SelectList
        items={[{ label: "No", value: "no" }, { label: "Yes", value: "yes" }]}
        title="Password protect?"
        onSelect={(val) => {
          if (val === "yes") setPhase("password-input");
          else { setPassword(undefined); void doCreate(); }
        }}
        onCancel={() => setPhase("views")}
      />
    );
  }

  if (phase === "password-input") {
    return (
      <TextPrompt
        label="Password"
        mask="*"
        onSubmit={(val) => { setPassword(val); void doCreate(); }}
        onCancel={() => setPhase("password-ask")}
        validate={(val) => val.length > 0 ? true : "Password cannot be empty"}
      />
    );
  }

  if (phase === "creating") {
    return (
      <Box paddingX={1}><Text>Creating note...</Text></Box>
    );
  }

  if (phase === "done") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="green">Note created!</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text><Text dimColor>Share URL: </Text><Text color={accent}>{shareUrl}</Text></Text>
          <Text><Text dimColor>Type:      </Text>{contentType}</Text>
          <Text><Text dimColor>Expires:   </Text>{formatExpiry(expireSec)}</Text>
          <Text><Text dimColor>Views:     </Text>{maxViews}</Text>
          {password && <Text><Text dimColor>Password:  </Text>yes</Text>}
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
