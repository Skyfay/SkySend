import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { encryptNoteContent, toBase64url, type NoteContentType } from "@skysend/crypto";
import { createNote } from "../../lib/api.js";
import { prepareUpload } from "../../lib/auth.js";
import { buildShareUrl } from "../../lib/url.js";
import { addNote } from "../../lib/history.js";
import { formatBytes, formatExpiry } from "../../lib/progress.js";
import { generatePassword } from "../../lib/password-generator.js";
import { generateEd25519KeyPair, generateRSAKeyPair, type SSHKeyPair } from "../../lib/ssh-keygen.js";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { MultiLineInput } from "../components/MultiLineInput.js";
import { FileExplorer } from "../components/FileExplorer.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";

type Phase =
  // Common
  | "type" | "expiry" | "views" | "password-ask" | "password-input"
  | "creating" | "done" | "error"
  // Text/Code/Markdown
  | "text-source" | "text-editor" | "text-file"
  // Password note
  | "pw-list" | "pw-label" | "pw-value-choice" | "pw-value-input" | "pw-gen-length"
  // SSH Key
  | "ssh-source" | "ssh-algo" | "ssh-comment" | "ssh-passphrase" | "ssh-generating" | "ssh-file" | "ssh-share";

interface PasswordEntry {
  label: string;
  value: string;
}

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

  // Password note state
  const [pwEntries, setPwEntries] = useState<PasswordEntry[]>([]);
  const [pwCurrentLabel, setPwCurrentLabel] = useState("");

  // SSH key state
  const [sshAlgo, setSshAlgo] = useState<"ed25519" | "rsa">("ed25519");
  const [sshParts, setSshParts] = useState<{ publicKey: string; privateKey: string; passphrase?: string }>({ publicKey: "", privateKey: "" });
  const [sshShare, setSshShare] = useState<{ pub: boolean; priv: boolean; pass: boolean }>({ pub: true, priv: true, pass: true });

  const setContentAndProceed = useCallback((noteContent: string) => {
    if (new TextEncoder().encode(noteContent).byteLength > config.noteMaxSize) {
      setErrorMsg(`Note too large (max ${formatBytes(config.noteMaxSize)})`);
      setPhase("error");
      return;
    }
    setContent(noteContent);
    setPhase("expiry");
  }, [config.noteMaxSize]);

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

  // ─── Type selection ───────────────────────────────────────────────────

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
        onSelect={(val) => {
          setContentType(val);
          if (val === "password") setPhase("pw-list");
          else if (val === "sshkey") setPhase("ssh-source");
          else setPhase("text-source");
        }}
        onCancel={onBack}
      />
    );
  }

  // ─── Text / Code / Markdown ───────────────────────────────────────────

  if (phase === "text-source") {
    return (
      <SelectList
        items={[
          { label: "Write manually", value: "write" },
          { label: "Select file", value: "file" },
        ]}
        title={`${contentType} - Content source`}
        onSelect={(val) => setPhase(val === "write" ? "text-editor" : "text-file")}
        onCancel={() => setPhase("type")}
      />
    );
  }

  if (phase === "text-editor") {
    return (
      <MultiLineInput
        label={`${contentType} content`}
        placeholder="Start typing..."
        onSubmit={(val) => setContentAndProceed(val)}
        onCancel={() => setPhase("text-source")}
      />
    );
  }

  if (phase === "text-file") {
    return (
      <FileExplorer
        maxFiles={1}
        onConfirm={(files) => {
          const filePath = files[0]!;
          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            setContentAndProceed(fileContent);
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setPhase("error");
          }
        }}
        onCancel={() => setPhase("text-source")}
      />
    );
  }

  // ─── Password note ────────────────────────────────────────────────────

  if (phase === "pw-list") {
    const listItems: Array<SelectItem<string>> = [
      { label: "Add entry", value: "add" },
      ...(pwEntries.length > 0
        ? [{ label: "Remove last entry", value: "remove" }]
        : []),
      ...(pwEntries.length > 0
        ? [{ label: "Done", value: "done" }]
        : []),
    ];

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}><Text bold>Password entries</Text></Box>
        {pwEntries.length === 0 ? (
          <Box marginLeft={2} marginBottom={1}><Text dimColor>No entries yet</Text></Box>
        ) : (
          <Box flexDirection="column" marginBottom={1}>
            {pwEntries.map((entry, i) => (
              <Box key={i} marginLeft={2}>
                <Text dimColor>{i + 1}. </Text>
                <Text bold>{entry.label || `Password ${i + 1}`}</Text>
                <Text dimColor>  {"\u2022".repeat(Math.min(entry.value.length, 20))}</Text>
              </Box>
            ))}
          </Box>
        )}
        <SelectList
          items={listItems}
          onSelect={(val) => {
            if (val === "add") {
              setPwCurrentLabel("");
              setPhase("pw-label");
            } else if (val === "remove") {
              setPwEntries((prev) => prev.slice(0, -1));
            } else if (val === "done") {
              const serialized = JSON.stringify(
                pwEntries.map((e) => ({ label: e.label, value: e.value })),
              );
              setContentAndProceed(serialized);
            }
          }}
          onCancel={() => {
            setPwEntries([]);
            setPhase("type");
          }}
        />
      </Box>
    );
  }

  if (phase === "pw-label") {
    return (
      <TextPrompt
        label="Label (optional)"
        placeholder="e.g. Email, WiFi, API key"
        onSubmit={(val) => {
          setPwCurrentLabel(val.trim());
          setPhase("pw-value-choice");
        }}
        onCancel={() => setPhase("pw-list")}
      />
    );
  }

  if (phase === "pw-value-choice") {
    return (
      <SelectList
        items={[
          { label: "Type password", value: "type" },
          { label: "Generate password", value: "generate" },
        ]}
        title="Password value"
        onSelect={(val) => setPhase(val === "type" ? "pw-value-input" : "pw-gen-length")}
        onCancel={() => setPhase("pw-label")}
      />
    );
  }

  if (phase === "pw-value-input") {
    return (
      <TextPrompt
        label="Password"
        onSubmit={(val) => {
          setPwEntries((prev) => [...prev, { label: pwCurrentLabel, value: val }]);
          setPhase("pw-list");
        }}
        onCancel={() => setPhase("pw-value-choice")}
        validate={(val) => val.length > 0 ? true : "Password cannot be empty"}
      />
    );
  }

  if (phase === "pw-gen-length") {
    return (
      <TextPrompt
        label="Password length"
        defaultValue="20"
        onSubmit={(val) => {
          const len = parseInt(val, 10);
          if (isNaN(len) || len < 8 || len > 128) return;
          const generated = generatePassword({
            length: len,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
          });
          setPwEntries((prev) => [...prev, { label: pwCurrentLabel, value: generated }]);
          setPhase("pw-list");
        }}
        onCancel={() => setPhase("pw-value-choice")}
        validate={(val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 8 || n > 128) return "Length must be 8-128";
          return true;
        }}
      />
    );
  }

  // ─── SSH Key ──────────────────────────────────────────────────────────

  if (phase === "ssh-source") {
    return (
      <SelectList
        items={[
          { label: "Generate new key pair", value: "generate" },
          { label: "Select key file", value: "file" },
        ]}
        title="SSH Key - Source"
        onSelect={(val) => setPhase(val === "generate" ? "ssh-algo" : "ssh-file")}
        onCancel={() => setPhase("type")}
      />
    );
  }

  if (phase === "ssh-algo") {
    return (
      <SelectList
        items={[
          { label: "Ed25519 (recommended)", value: "ed25519" as const },
          { label: "RSA 4096", value: "rsa" as const },
        ]}
        title="Algorithm"
        onSelect={(val) => { setSshAlgo(val); setPhase("ssh-comment"); }}
        onCancel={() => setPhase("ssh-source")}
      />
    );
  }

  if (phase === "ssh-comment") {
    return (
      <TextPrompt
        label="Comment (optional)"
        placeholder="e.g. user@hostname"
        onSubmit={(val) => {
          // Store comment temporarily in content field
          setContent(val.trim());
          setPhase("ssh-passphrase");
        }}
        onCancel={() => setPhase("ssh-algo")}
      />
    );
  }

  if (phase === "ssh-passphrase") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Leave empty for no passphrase</Text>
        <TextPrompt
          label="Key passphrase (optional)"
          mask="*"
          onSubmit={(val) => {
            const comment = content; // stored from previous phase
            const passphrase = val.trim() || undefined;
            setPhase("ssh-generating");
            void (async () => {
              try {
                let keyPair: SSHKeyPair;
                if (sshAlgo === "ed25519") {
                  keyPair = await generateEd25519KeyPair(comment || undefined, passphrase);
                } else {
                  keyPair = await generateRSAKeyPair(4096, comment || undefined, passphrase);
                }
                setSshParts({ publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, passphrase });
                setSshShare({ pub: true, priv: true, pass: !!passphrase });
                setPhase("ssh-share");
              } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : String(err));
                setPhase("error");
              }
            })();
          }}
          onCancel={() => setPhase("ssh-comment")}
        />
      </Box>
    );
  }

  if (phase === "ssh-generating") {
    return (
      <Box paddingX={1}><Text>Generating {sshAlgo.toUpperCase()} key pair...</Text></Box>
    );
  }

  if (phase === "ssh-file") {
    return (
      <FileExplorer
        maxFiles={1}
        onConfirm={(files) => {
          const filePath = files[0]!;
          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            // Basic validation: should look like an SSH key
            if (!fileContent.includes("ssh-") && !fileContent.includes("BEGIN") && !fileContent.includes("PRIVATE KEY")) {
              setErrorMsg("File does not appear to be an SSH key");
              setPhase("error");
              return;
            }
            // Parse parts from file
            const privMatch = fileContent.match(/(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/);
            const passMatch = fileContent.match(/^Passphrase: (.+)$/m);
            let pubKey = fileContent;
            if (privMatch?.[1]) pubKey = pubKey.replace(privMatch[1], "");
            if (passMatch?.[1]) pubKey = pubKey.replace(`Passphrase: ${passMatch[1]}`, "");
            pubKey = pubKey.trim();
            setSshParts({ publicKey: pubKey, privateKey: privMatch?.[1] ?? "", passphrase: passMatch?.[1] });
            setSshShare({ pub: !!pubKey, priv: !!privMatch, pass: !!passMatch });
            setPhase("ssh-share");
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setPhase("error");
          }
        }}
        onCancel={() => setPhase("ssh-source")}
      />
    );
  }

  if (phase === "ssh-share") {
    const hasPub = sshParts.publicKey.length > 0;
    const hasPriv = sshParts.privateKey.length > 0;
    const hasPass = !!sshParts.passphrase;
    const anySelected = (hasPub && sshShare.pub) || (hasPriv && sshShare.priv) || (hasPass && sshShare.pass);

    const items: Array<SelectItem<string>> = [];
    if (hasPub) items.push({ label: `[${sshShare.pub ? "x" : " "}] Public Key`, value: "pub" });
    if (hasPriv) items.push({ label: `[${sshShare.priv ? "x" : " "}] Private Key`, value: "priv" });
    if (hasPass) items.push({ label: `[${sshShare.pass ? "x" : " "}] Passphrase`, value: "pass" });
    if (anySelected) items.push({ label: "Done", value: "done" });

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}><Text bold>Share selection</Text></Box>
        <Text dimColor>Toggle which parts to include in the note</Text>
        <Box marginTop={1}>
          <SelectList
            items={items}
            onSelect={(val) => {
              if (val === "pub") { setSshShare((s) => ({ ...s, pub: !s.pub })); return; }
              if (val === "priv") { setSshShare((s) => ({ ...s, priv: !s.priv })); return; }
              if (val === "pass") { setSshShare((s) => ({ ...s, pass: !s.pass })); return; }
              if (val === "done") {
                const parts: string[] = [];
                if (sshShare.pub && hasPub) parts.push(sshParts.publicKey);
                if (sshShare.priv && hasPriv) parts.push(sshParts.privateKey);
                if (sshShare.pass && hasPass) parts.push(`Passphrase: ${sshParts.passphrase}`);
                if (parts.length === 0) return;
                setContentAndProceed(parts.join("\n\n"));
              }
            }}
            onCancel={() => setPhase("ssh-source")}
          />
        </Box>
      </Box>
    );
  }

  // ─── Common: Expiry, Views, Password, Create, Done ────────────────────

  if (phase === "expiry") {
    const items: Array<SelectItem<number>> = config.noteExpireOptions.map((s) => ({
      label: formatExpiry(s), value: s,
    }));
    return (
      <SelectList items={items} title="Expiry time" onSelect={(val) => { setExpireSec(val); setPhase("views"); }} onCancel={() => {
        // Go back to appropriate content phase
        if (contentType === "password") setPhase("pw-list");
        else if (contentType === "sshkey") setPhase("ssh-source");
        else setPhase("text-source");
      }} />
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
