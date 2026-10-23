import React, { useState } from "react";
import * as fs from "node:fs";
import { Text, useAnimation } from "ink";
import { buildShareLink, createEncryptedNote } from "@skysend/transfer";
import { MAX_BLOCKS, type NoteBlock } from "@skysend/note-format";
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

/** One part of the note while it is written: its kind and what each kind needs. */
interface Draft {
  /** Names the rows of the part, and stays while parts before it come and go. */
  key: number;
  kind: CliNoteType;
  text: string;
  /** A new number starts the editor over, with the text of a file. */
  editorReset: number;
  entries: Array<{ label: string; value: string }>;
  newLabel: string;
  newValue: string;
  sshSource: (typeof SSH_SOURCES)[number]["id"];
  comment: string;
  passphrase: string;
  sshKey: SshParts | null;
  share: { pub: boolean; priv: boolean; pass: boolean };
}

function newDraft(key: number): Draft {
  return {
    key, kind: "text", text: "", editorReset: 0, entries: [], newLabel: "", newValue: "",
    sshSource: "ed25519", comment: "", passphrase: "", sshKey: null, share: { pub: true, priv: true, pass: true },
  };
}

/** Whether a part holds nothing yet, so removing it throws no work away. */
function isEmpty(d: Draft): boolean {
  return !d.text.trim() && d.entries.length === 0 && !d.newValue && !d.sshKey;
}

/** The block of a part, or why it cannot be made yet. */
function blockOf(d: Draft): NoteBlock | string {
  if (TEXT_KINDS.includes(d.kind)) return d.text.trim() ? textToBlock(d.kind, d.text) : "Write the note first.";
  if (d.kind === "password") {
    const all = d.newValue ? [...d.entries, { label: d.newLabel.trim(), value: d.newValue }] : d.entries;
    return all.length > 0 ? { type: "password", entries: all } : "Add a password first.";
  }
  if (!d.sshKey) return "Make or pick a key first.";
  const chosen = {
    publicKey: d.share.pub ? d.sshKey.publicKey : "",
    privateKey: d.share.priv ? d.sshKey.privateKey : "",
    passphrase: d.share.pass ? d.sshKey.passphrase : "",
  };
  if (!chosen.publicKey && !chosen.privateKey && !chosen.passphrase) return "Pick at least one part of the key.";
  return { type: "sshkey", ...chosen };
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

/**
 * The Note tab: a form with the parts of the note, each with its kind and content, then the
 * options and the button. A note of one part looks the way it always did.
 */
export function NoteCreateView({ appState }: NoteCreateViewProps): React.ReactElement {
  const accent = useAccent();
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const { server, config } = appState;

  const [phase, setPhase] = useState<Phase>("compose");
  const [working, setWorking] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft(0)]);
  const [nextKey, setNextKey] = useState(1);
  // The part the file picker fills, and the part whose removal waits for a second enter.
  const [pickFor, setPickFor] = useState(0);
  const [removeAsked, setRemoveAsked] = useState<number | null>(null);
  const [expireSec, setExpireSec] = useState(config.noteDefaultExpire);
  const [maxViews, setMaxViews] = useState(config.noteDefaultViews);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focus, setFocus] = useState({ id: "0:kind", n: 0 });
  const [shareUrl, setShareUrl] = useState("");
  const [failure, setFailure] = useState("");
  const { frame } = useAnimation({ interval: 90, isActive: phase === "working" });
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));
  const several = drafts.length > 1;
  const canAdd = config.noteBlocks && drafts.length < MAX_BLOCKS;

  /** Changes one part. Any change takes back a pending removal. */
  const update = (key: number, change: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setRemoveAsked(null);
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...(typeof change === "function" ? change(d) : change) } : d)));
  };

  const addPart = () => {
    const key = nextKey;
    setNextKey(key + 1);
    setDrafts((all) => [...all, newDraft(key)]);
    setRemoveAsked(null);
    setProblem(null);
    focusOn(`${key}:kind`);
  };

  /** Removes a part. One with something in it asks for a second enter first. */
  const removePart = (d: Draft) => {
    if (!isEmpty(d) && removeAsked !== d.key) {
      setRemoveAsked(d.key);
      return;
    }
    setDrafts((all) => all.filter((x) => x.key !== d.key));
    setRemoveAsked(null);
    setProblem(null);
    focusOn("add");
  };

  const create = async () => {
    const blocks: NoteBlock[] = [];
    for (const [i, d] of drafts.entries()) {
      const made = blockOf(d);
      if (typeof made === "string") {
        setProblem(several ? `Part ${i + 1}: ${made}` : made);
        return;
      }
      blocks.push(made);
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
    const note = prepareNote(blocks, config.noteBlocks);
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
        contentType: drafts.map((d) => d.kind).join(", "), hasPassword: shared.hasPassword,
        createdAt: new Date().toISOString(), expireSec,
      });
      setShareUrl(url);
      setPhase("done");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const generate = async (d: Draft) => {
    setWorking("Making the key");
    setPhase("working");
    try {
      const comment = d.comment.trim() || undefined;
      const passphrase = d.passphrase.trim() || undefined;
      const pair = d.sshSource === "rsa"
        ? await generateRSAKeyPair(4096, comment, passphrase)
        : await generateEd25519KeyPair(comment, passphrase);
      update(d.key, {
        sshKey: { publicKey: pair.publicKey, privateKey: pair.privateKey, passphrase: d.passphrase.trim() },
        share: { pub: true, priv: true, pass: true },
      });
      setPhase("compose");
      focusOn(`${d.key}:part:pub`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("compose");
    }
  };

  const addEntry = (d: Draft) => {
    if (!d.newValue) return;
    update(d.key, { entries: [...d.entries, { label: d.newLabel.trim(), value: d.newValue }], newLabel: "", newValue: "" });
    setProblem(null);
    focusOn(`${d.key}:newLabel`);
  };

  const startOver = () => {
    const key = nextKey;
    setNextKey(key + 1);
    setDrafts([newDraft(key)]);
    setPassword("");
    setProblem(null);
    setPhase("compose");
    focusOn(`${key}:kind`);
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
          const d = drafts.find((x) => x.key === pickFor);
          if (!d) return;
          try {
            const content = fs.readFileSync(file.path, "utf-8");
            if (d.kind === "sshkey") {
              const key = sshKeyFromText(content);
              if (!key.publicKey && !key.privateKey) {
                setProblem("That file does not look like an SSH key.");
                return;
              }
              update(d.key, {
                sshKey: { publicKey: key.publicKey, privateKey: key.privateKey, passphrase: key.passphrase },
                share: { pub: true, priv: true, pass: true },
              });
              focusOn(`${d.key}:part:pub`);
            } else {
              update(d.key, (x) => ({ text: content, editorReset: x.editorReset + 1 }));
              focusOn(`${d.key}:text`);
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
          {several ? `${drafts.length} parts` : KINDS.find((k) => k.id === drafts[0]?.kind)?.label}, deleted after {formatExpiry(expireSec)}
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

  /** The rows of one part, after its kind. */
  const contentOf = (d: Draft): FormRow[] => {
    const id = (name: string) => `${d.key}:${name}`;
    const rows: FormRow[] = [];
    if (TEXT_KINDS.includes(d.kind)) {
      rows.push({
        kind: "editor",
        id: id("text"),
        label: d.kind === "code" ? "Code" : "Text",
        value: d.text,
        onChange: (text) => update(d.key, { text }),
        height: several ? Math.max(3, Math.min(6, height - 22)) : Math.max(3, height - 22),
        placeholder: "Write here. Enter makes a new line, tab goes on.",
        reset: d.editorReset,
      });
      rows.push({
        kind: "button",
        id: id("load"),
        label: "Load the text from a file instead",
        onPress: () => {
          setPickFor(d.key);
          setPhase("pick");
        },
      });
    } else if (d.kind === "password") {
      d.entries.forEach((e, i) => {
        rows.push({
          kind: "item",
          id: id(`entry:${i}`),
          onRemove: () => update(d.key, (x) => ({ entries: x.entries.filter((_, j) => j !== i) })),
          removeHint: "take it out",
          render: (focused) => (
            <Text wrap="truncate-end">
              <Text color={COLORS.text} bold={focused}>{e.label ? forTerminal(e.label) : `Password ${i + 1}`}</Text>
              <Text color={COLORS.muted}>   {"•".repeat(Math.min(e.value.length, 20))}</Text>
            </Text>
          ),
        });
      });
      rows.push({ kind: "input", id: id("newLabel"), label: "Label", value: d.newLabel, onChange: (newLabel) => update(d.key, { newLabel }), placeholder: "like WiFi or Email, can stay empty" });
      rows.push({ kind: "input", id: id("newValue"), label: "Password", value: d.newValue, onChange: (newValue) => update(d.key, { newValue }), placeholder: "type it, or make one below", submitHint: "add it", onSubmit: () => addEntry(d) });
      rows.push({
        kind: "button",
        id: id("generate"),
        label: "Make a strong password",
        onPress: () => {
          update(d.key, { newValue: generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true }) });
          focusOn(id("newValue"));
        },
      });
      rows.push({ kind: "button", id: id("addEntry"), label: d.entries.length ? "Add another password" : "Add this password", disabled: !d.newValue, onPress: () => addEntry(d) });
    } else if (!d.sshKey) {
      rows.push({
        kind: "choice",
        id: id("sshSource"),
        label: "Key",
        value: SSH_SOURCES.find((x) => x.id === d.sshSource)!.label,
        onChange: (by) => update(d.key, (x) => ({ sshSource: step(SSH_SOURCES.map((y) => y.id), x.sshSource, by) })),
      });
      if (d.sshSource === "file") {
        rows.push({
          kind: "button",
          id: id("pickKey"),
          label: "Pick the key file",
          onPress: () => {
            setPickFor(d.key);
            setPhase("pick");
          },
        });
      } else {
        rows.push({ kind: "input", id: id("comment"), label: "Comment", value: d.comment, onChange: (comment) => update(d.key, { comment }), placeholder: "like you@laptop, can stay empty" });
        rows.push({ kind: "input", id: id("passphrase"), label: "Passphrase", value: d.passphrase, onChange: (passphrase) => update(d.key, { passphrase }), mask: true, placeholder: "can stay empty" });
        rows.push({ kind: "button", id: id("makeKey"), label: "Make the key", onPress: () => void generate(d) });
      }
    } else {
      const sshKey = d.sshKey;
      const partRows: Array<{ key: "pub" | "priv" | "pass"; label: string; present: boolean }> = [
        { key: "pub", label: "Public key", present: !!sshKey.publicKey },
        { key: "priv", label: "Private key", present: !!sshKey.privateKey },
        { key: "pass", label: "Passphrase", present: !!sshKey.passphrase },
      ];
      for (const p of partRows.filter((x) => x.present)) {
        rows.push({
          kind: "item",
          id: id(`part:${p.key}`),
          pressHint: d.share[p.key] ? "leave it out" : "put it in",
          onPress: () => update(d.key, (x) => ({ share: { ...x.share, [p.key]: !x.share[p.key] } })),
          render: (focused) => (
            <Text wrap="truncate-end">
              <Text color={d.share[p.key] ? accent : COLORS.faint}>{d.share[p.key] ? "[✓]" : "[ ]"}</Text>
              <Text color={COLORS.text} bold={focused}> {p.label}</Text>
              {p.key === "pub" && <Text color={COLORS.faint}>   {forTerminal(sshKey.publicKey)}</Text>}
            </Text>
          ),
        });
      }
      rows.push({ kind: "button", id: id("again"), label: "Start over with another key", onPress: () => update(d.key, { sshKey: null }) });
    }
    return rows;
  };

  const parts: FormRow[] = [];
  drafts.forEach((d, i) => {
    const kindRow: FormRow = {
      kind: "choice",
      id: `${d.key}:kind`,
      label: several ? "Kind" : "Kind of note",
      value: KINDS.find((k) => k.id === d.kind)!.label,
      onChange: (by) => {
        update(d.key, (x) => ({ kind: step(KINDS.map((k) => k.id), x.kind, by) }));
        setProblem(null);
      },
    };
    // One part keeps the form of a note of one kind. Several get a heading each.
    if (several) parts.push({ kind: "section", label: `Part ${i + 1}` }, kindRow);
    else parts.push(kindRow, { kind: "section", label: "Content" });
    parts.push(...contentOf(d));
    if (several) {
      parts.push({
        kind: "button",
        id: `${d.key}:remove`,
        label: removeAsked === d.key ? "Press enter again to remove this part" : "Remove this part",
        onPress: () => removePart(d),
      });
    }
  });
  if (canAdd) parts.push({ kind: "button", id: "add", label: "+ Add a part", onPress: addPart });
  else if (!config.noteBlocks) parts.push({ kind: "note", content: <Faint>This server takes notes of one part only.</Faint> });

  const rows: FormRow[] = [
    ...parts,
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
