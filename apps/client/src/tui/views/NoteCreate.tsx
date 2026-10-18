import React, { useState } from "react";
import * as fs from "node:fs";
import { Text, useAnimation } from "ink";
import { buildShareLink, createEncryptedNote } from "@skysend/transfer";
import type { NoteBlock } from "@skysend/note-format";
import { apiFor } from "../../lib/api.js";
import { hashWasmArgon2 } from "../../lib/auth.js";
import { addNote } from "../../lib/history.js";
import { formatBytes, formatExpiry } from "../../lib/progress.js";
import { generatePassword } from "../../lib/password-generator.js";
import { prepareNote, sshKeyFromText, textToBlock, type CliNoteType } from "../../lib/note.js";
import { generateEd25519KeyPair, generateRSAKeyPair } from "../../lib/ssh-keygen.js";
import { ensureOidcAuth } from "../../lib/oidc.js";
import { forTerminal } from "../../lib/terminal.js";
import { checkNewPassword } from "../../lib/input.js";
import type { AppState } from "../types.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";
import { FilePicker } from "../components/FilePicker.js";
import { LinkReady } from "../components/LinkReady.js";
import { SPINNER, plural } from "../components/Progress.js";

type Phase = "compose" | "pick" | "working" | "done" | "error";

const KINDS: Array<{ id: CliNoteType; label: string }> = [
  { id: "text", label: "Text" },
  { id: "password", label: "Passwords" },
  { id: "code", label: "Code" },
  { id: "markdown", label: "Markdown" },
  { id: "sshkey", label: "SSH key" },
];
const TEXT_KINDS: readonly CliNoteType[] = ["text", "code", "markdown"];
const SSH_SOURCES = [
  { id: "ed25519", label: "make a new Ed25519 key" },
  { id: "rsa", label: "make a new RSA 4096 key" },
  { id: "file", label: "take one from a file" },
] as const;

interface SshParts {
  publicKey: string;
  privateKey: string;
  passphrase: string;
}

interface NoteCreateViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

function step<T>(values: readonly T[], current: T, by: number): T {
  const at = Math.max(0, values.indexOf(current));
  return values[Math.min(values.length - 1, Math.max(0, at + by))]!;
}

/** The Note tab: a form with the kind and content of the note, its options and the button. */
export function NoteCreateView({ appState }: NoteCreateViewProps): React.ReactElement {
  const accent = useAccent();
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const { server, config } = appState;

  const [phase, setPhase] = useState<Phase>("compose");
  const [working, setWorking] = useState("");
  const [kind, setKind] = useState<CliNoteType>("text");
  const [text, setText] = useState("");
  // A new number starts the editor over, with the text of a file.
  const [editorReset, setEditorReset] = useState(0);
  const [entries, setEntries] = useState<Array<{ label: string; value: string }>>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [sshSource, setSshSource] = useState<(typeof SSH_SOURCES)[number]["id"]>("ed25519");
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [parts, setParts] = useState<SshParts | null>(null);
  const [share, setShare] = useState({ pub: true, priv: true, pass: true });
  const [expireSec, setExpireSec] = useState(config.noteDefaultExpire);
  const [maxViews, setMaxViews] = useState(config.noteDefaultViews);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focus, setFocus] = useState({ id: "kind", n: 0 });
  const [shareUrl, setShareUrl] = useState("");
  const [failure, setFailure] = useState("");
  const { frame } = useAnimation({ interval: 90, isActive: phase === "working" });
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));
  const textKind = TEXT_KINDS.includes(kind);

  /** The block of the note, or why it cannot be made yet. */
  const block = (): NoteBlock | string => {
    if (textKind) return text.trim() ? textToBlock(kind, text) : "Write the note first.";
    if (kind === "password") {
      const all = newValue ? [...entries, { label: newLabel.trim(), value: newValue }] : entries;
      return all.length > 0 ? { type: "password", entries: all } : "Add a password first.";
    }
    if (!parts) return "Make or pick a key first.";
    const chosen = {
      publicKey: share.pub ? parts.publicKey : "",
      privateKey: share.priv ? parts.privateKey : "",
      passphrase: share.pass ? parts.passphrase : "",
    };
    if (!chosen.publicKey && !chosen.privateKey && !chosen.passphrase) return "Pick at least one part of the key.";
    return { type: "sshkey", ...chosen };
  };

  const create = async () => {
    const made = block();
    if (typeof made === "string") {
      setProblem(made);
      return;
    }
    if (password && checkNewPassword(password) !== true) {
      setProblem(`Password: ${checkNewPassword(password) as string}`);
      focusOn("password");
      return;
    }
    if (config.forceNotePassword && !password) {
      setProblem("This server wants a password on every note.");
      focusOn("password");
      return;
    }
    const note = prepareNote(made, config.noteBlocks);
    if (new TextEncoder().encode(note.plaintext).byteLength > config.noteMaxSize) {
      setProblem(`The note is too large, this server takes up to ${formatBytes(config.noteMaxSize)}.`);
      return;
    }
    setProblem(null);
    try {
      let oidcToken: string | undefined;
      if (config.oidcProtectNotes) {
        setWorking("Waiting for the login in your browser");
        setPhase("working");
        oidcToken = await ensureOidcAuth(server);
      }
      setWorking("Encrypting and creating the note");
      setPhase("working");
      const shared = await createEncryptedNote({
        api: apiFor(server, oidcToken),
        plaintext: note.plaintext,
        contentType: note.contentType,
        maxViews,
        expireSec,
        password,
        argon2id: hashWasmArgon2,
      });
      const url = buildShareLink(server, "note", shared.id, shared.effectiveSecret);
      addNote({
        id: shared.id, server, url,
        ownerToken: shared.ownerToken,
        contentType: kind, hasPassword: shared.hasPassword,
        createdAt: new Date().toISOString(), expireSec,
      });
      setShareUrl(url);
      setPhase("done");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const generate = async () => {
    setWorking("Making the key");
    setPhase("working");
    try {
      const pair = sshSource === "rsa"
        ? await generateRSAKeyPair(4096, comment.trim() || undefined, passphrase.trim() || undefined)
        : await generateEd25519KeyPair(comment.trim() || undefined, passphrase.trim() || undefined);
      setParts({ publicKey: pair.publicKey, privateKey: pair.privateKey, passphrase: passphrase.trim() });
      setShare({ pub: true, priv: true, pass: true });
      setPhase("compose");
      focusOn("part:pub");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("compose");
    }
  };

  const addEntry = () => {
    if (!newValue) return;
    setEntries((prev) => [...prev, { label: newLabel.trim(), value: newValue }]);
    setNewLabel("");
    setNewValue("");
    setProblem(null);
    focusOn("newLabel");
  };

  const startOver = () => {
    setText("");
    setEditorReset((n) => n + 1);
    setEntries([]);
    setParts(null);
    setPassword("");
    setProblem(null);
    setPhase("compose");
    focusOn("kind");
  };

  // ── Screens over the form ────────────────────────────

  if (phase === "pick") {
    return (
      <FilePicker
        maxFiles={1}
        onDone={(picked) => {
          setPhase("compose");
          const file = picked[0];
          if (!file || file.folder || picked.length > 1) {
            setProblem("Pick one file, not a folder.");
            return;
          }
          try {
            const content = fs.readFileSync(file.path, "utf-8");
            if (kind === "sshkey") {
              const key = sshKeyFromText(content);
              if (!key.publicKey && !key.privateKey) {
                setProblem("That file does not look like an SSH key.");
                return;
              }
              setParts({ publicKey: key.publicKey, privateKey: key.privateKey, passphrase: key.passphrase });
              setShare({ pub: true, priv: true, pass: true });
              focusOn("part:pub");
            } else {
              setText(content);
              setEditorReset((n) => n + 1);
              focusOn("text");
            }
            setProblem(null);
          } catch (err) {
            setProblem(err instanceof Error ? err.message : String(err));
          }
        }}
        onCancel={() => setPhase("compose")}
      />
    );
  }

  if (phase === "working") {
    return (
      <Panel width={width}>
        <Gap />
        <T>  <Text color={accent}>{SPINNER[frame % SPINNER.length]}</Text> <Text bold>{working}</Text></T>
        <Gap />
      </Panel>
    );
  }

  if (phase === "done") {
    return (
      <LinkReady
        url={shareUrl}
        title="Your note is ready"
        actions={[{ id: "more", label: "Write another note", onPress: startOver }]}
        active={active}
        onExit={toTabs}
        exitHint="tabs"
      >
        <Muted>
          {KINDS.find((k) => k.id === kind)?.label}, deleted after {formatExpiry(expireSec)}
          {maxViews > 0 ? ` or ${plural(maxViews, "view")}, whichever comes first` : ""}.
        </Muted>
        <Muted>{password ? "Protected with a password. Tell it on another way than the link." : "No password."}</Muted>
        <Faint>It is in My links, where you can delete it early.</Faint>
      </LinkReady>
    );
  }

  if (phase === "error") {
    return (
      <Panel width={width}>
        <Gap />
        <Text color={COLORS.danger} bold>  The note could not be created</Text>
        <T>  {forTerminal(failure)}</T>
        <Gap />
        <Form
          rows={[{ kind: "button", id: "back", label: "Back to the note", primary: true, onPress: () => setPhase("compose") }]}
          active={active}
          height={1}
          onExit={toTabs}
          exitHint="tabs"
        />
        <Gap />
      </Panel>
    );
  }

  // ── The form ─────────────────────────────────────────

  const content: FormRow[] = [];
  if (textKind) {
    content.push({
      kind: "editor",
      id: "text",
      label: kind === "code" ? "Code" : "Text",
      value: text,
      onChange: setText,
      height: Math.max(3, height - 22),
      placeholder: "Write here. Enter makes a new line, tab goes on.",
      reset: editorReset,
    });
    content.push({ kind: "button", id: "load", label: "Load the text from a file instead", onPress: () => setPhase("pick") });
  } else if (kind === "password") {
    entries.forEach((e, i) => {
      content.push({
        kind: "item",
        id: `entry:${i}`,
        onRemove: () => setEntries((prev) => prev.filter((_, j) => j !== i)),
        removeHint: "take it out",
        render: (focused) => (
          <Text wrap="truncate-end">
            <Text color={COLORS.text} bold={focused}>{e.label ? forTerminal(e.label) : `Password ${i + 1}`}</Text>
            <Text color={COLORS.muted}>   {"•".repeat(Math.min(e.value.length, 20))}</Text>
          </Text>
        ),
      });
    });
    content.push({ kind: "input", id: "newLabel", label: "Label", value: newLabel, onChange: setNewLabel, placeholder: "like WiFi or Email, can stay empty" });
    content.push({ kind: "input", id: "newValue", label: "Password", value: newValue, onChange: setNewValue, placeholder: "type it, or make one below", submitHint: "add it", onSubmit: addEntry });
    content.push({
      kind: "button",
      id: "generate",
      label: "Make a strong password",
      onPress: () => {
        setNewValue(generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true }));
        focusOn("newValue");
      },
    });
    content.push({ kind: "button", id: "addEntry", label: entries.length ? "Add another password" : "Add this password", disabled: !newValue, onPress: addEntry });
  } else if (!parts) {
    content.push({
      kind: "choice",
      id: "sshSource",
      label: "Key",
      value: SSH_SOURCES.find((s) => s.id === sshSource)!.label,
      onChange: (by) => setSshSource((s) => step(SSH_SOURCES.map((x) => x.id), s, by)),
    });
    if (sshSource === "file") {
      content.push({ kind: "button", id: "pickKey", label: "Pick the key file", onPress: () => setPhase("pick") });
    } else {
      content.push({ kind: "input", id: "comment", label: "Comment", value: comment, onChange: setComment, placeholder: "like you@laptop, can stay empty" });
      content.push({ kind: "input", id: "passphrase", label: "Passphrase", value: passphrase, onChange: setPassphrase, mask: true, placeholder: "can stay empty" });
      content.push({ kind: "button", id: "makeKey", label: "Make the key", onPress: () => void generate() });
    }
  } else {
    const partRows: Array<{ key: "pub" | "priv" | "pass"; label: string; present: boolean }> = [
      { key: "pub", label: "Public key", present: !!parts.publicKey },
      { key: "priv", label: "Private key", present: !!parts.privateKey },
      { key: "pass", label: "Passphrase", present: !!parts.passphrase },
    ];
    for (const p of partRows.filter((x) => x.present)) {
      content.push({
        kind: "item",
        id: `part:${p.key}`,
        pressHint: share[p.key] ? "leave it out" : "put it in",
        onPress: () => setShare((prev) => ({ ...prev, [p.key]: !prev[p.key] })),
        render: (focused) => (
          <Text wrap="truncate-end">
            <Text color={share[p.key] ? accent : COLORS.faint}>{share[p.key] ? "[✓]" : "[ ]"}</Text>
            <Text color={COLORS.text} bold={focused}> {p.label}</Text>
            {p.key === "pub" && <Text color={COLORS.faint}>   {forTerminal(parts.publicKey)}</Text>}
          </Text>
        ),
      });
    }
    content.push({ kind: "button", id: "again", label: "Start over with another key", onPress: () => setParts(null) });
  }

  const rows: FormRow[] = [
    {
      kind: "choice",
      id: "kind",
      label: "Kind of note",
      value: KINDS.find((k) => k.id === kind)!.label,
      onChange: (by) => {
        setKind((k) => step(KINDS.map((x) => x.id), k, by));
        setProblem(null);
      },
    },
    { kind: "section", label: "Content" },
    ...content,
    { kind: "section", label: "Options" },
    {
      kind: "choice",
      id: "expires",
      label: "Expires after",
      value: formatExpiry(expireSec),
      onChange: (by) => setExpireSec((v) => step(config.noteExpireOptions, v, by)),
    },
    {
      kind: "choice",
      id: "views",
      label: "Views",
      value: maxViews === 0 ? "no limit" : maxViews === 1 ? "1 view" : `${maxViews} views`,
      onChange: (by) => setMaxViews((v) => step(config.noteViewOptions, v, by)),
    },
    {
      kind: "input",
      id: "password",
      label: "Password",
      value: password,
      onChange: setPassword,
      mask: true,
      placeholder: config.forceNotePassword ? "required by this server" : "none, or type one",
    },
    { kind: "section", label: "" },
    ...(problem ? [{ kind: "note" as const, content: <Text color={COLORS.danger}>{forTerminal(problem)}</Text> }] : []),
    { kind: "button", id: "create", label: "Create the note", primary: true, onPress: () => void create() },
    { kind: "note", content: <Faint>Up to {formatBytes(config.noteMaxSize)}. Encrypted on this computer before it is sent.</Faint> },
  ];

  return (
    <Panel width={width}>
      <Gap />
      <Form rows={rows} active={active} height={Math.max(8, height - 4)} focus={focus} onExit={toTabs} exitHint="tabs" />
      <Gap />
    </Panel>
  );
}
