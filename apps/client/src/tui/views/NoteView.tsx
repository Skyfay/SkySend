import React, { useState, useCallback, useRef } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useAnimation, useBoxMetrics, useInput } from "ink";
import { decryptNoteContent } from "@skysend/crypto";
import { noteToText, type ReadBlock } from "@skysend/note-format";
import { apiFor, type NoteInfo } from "../../lib/api.js";
import { prepareDownload } from "../../lib/auth.js";
import { noteFileName, readReceivedNote } from "../../lib/note.js";
import { forTerminal } from "../../lib/terminal.js";
import { parseShareUrl } from "../../lib/url.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { expandPath } from "../../lib/paths.js";
import type { AppState } from "../types.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom, useToast } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";
import { SPINNER } from "../components/Progress.js";

type Phase = "loading" | "password" | "display" | "save" | "error";

/** One part of a note in a well of its own, with its title. */
function Part({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  const accent = useAccent();
  return (
    <Panel on={COLORS.card} fill={COLORS.well}>
      <Text color={accent} bold>{title}</Text>
      {children}
    </Panel>
  );
}

/** The blocks of a note. Passwords stay dots until `revealed`. */
function Blocks({ blocks, revealed }: { blocks: readonly ReadBlock[]; revealed: boolean }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <Part key={i} title={block.label ? forTerminal(block.label) : block.format === "markdown" ? "Markdown" : "Text"}>
                <T>{forTerminal(block.text)}</T>
              </Part>
            );
          case "code":
            return (
              <Part key={i} title={forTerminal(`${block.title || "Code"}${block.language === "auto" ? "" : ` (${block.language})`}`)}>
                <T>{forTerminal(block.code)}</T>
              </Part>
            );
          case "password":
            return (
              <Part key={i} title={block.label ? forTerminal(block.label) : "Passwords"}>
                {block.entries.map((entry, j) => {
                  // An entry that is no secret, like a username, is shown without a reveal.
                  const shown = entry.secret === false || revealed;
                  return (
                    <Box key={j}>
                      <Box width={22}>
                        <Text color={COLORS.muted} wrap="truncate-end">
                          {entry.label ? forTerminal(entry.label) : entry.secret === false ? "Field" : `Password ${j + 1}`}
                        </Text>
                      </Box>
                      <Text color={COLORS.text}>{shown ? forTerminal(entry.value) : "•".repeat(Math.min(entry.value.length, 24))}</Text>
                    </Box>
                  );
                })}
              </Part>
            );
          case "sshkey":
            return (
              <Box key={i} flexDirection="column">
                {block.publicKey && <Part title={block.label ? `${forTerminal(block.label)}, public key` : "Public key"}><T>{forTerminal(block.publicKey)}</T></Part>}
                {block.privateKey && <Part title="Private key"><T>{forTerminal(block.privateKey)}</T></Part>}
                {block.passphrase && <Part title="Passphrase"><T>{revealed ? forTerminal(block.passphrase) : "•".repeat(12)}</T></Part>}
              </Box>
            );
          case "unsupported":
            return (
              <Part key={i} title="Unknown part">
                <Muted>This part of the note needs a newer version of SkySend.</Muted>
              </Part>
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

/** A note from its link: the password when it has one, then the note to read, copy or save. */
export function NoteViewView({ onBack, initialUrl }: NoteViewViewProps): React.ReactElement {
  const accent = useAccent();
  const toast = useToast();
  const { width, height } = useRoom();
  const { active } = useFocus();
  const [phase, setPhase] = useState<Phase>("loading");
  const [blocks, setBlocks] = useState<ReadBlock[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [viewCount, setViewCount] = useState(0);
  const [maxViews, setMaxViews] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [password, setPassword] = useState("");
  const [savePath, setSavePath] = useState("");
  const [scroll, setScroll] = useState(0);
  const [parsedUrl, setParsedUrl] = useState<ReturnType<typeof parseShareUrl> | null>(null);
  const [noteInfo, setNoteInfo] = useState<NoteInfo | null>(null);
  const didAutoLoad = useRef(false);
  const content = useRef(null);
  const { height: contentHeight } = useBoxMetrics(content);
  const { frame } = useAnimation({ interval: 90, isActive: phase === "loading" });

  const fail = (err: unknown) => {
    setErrorMsg(err instanceof Error ? err.message : String(err));
    setPhase("error");
  };

  const loadNote = useCallback(async (parsed: ReturnType<typeof parseShareUrl>, info: NoteInfo, pw?: string) => {
    setPhase("loading");
    const creds = await prepareDownload(parsed.secret, info.salt, pw, info.passwordSalt, info.passwordAlgo);
    const response = await apiFor(parsed.server).viewNote(parsed.id, creds.authTokenB64);
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
      if (parsed.type !== "note") throw new Error("This link is a file, not a note");
      setParsedUrl(parsed);
      const info = await apiFor(parsed.server).fetchNoteInfo(parsed.id);
      setNoteInfo(info);
      if (info.hasPassword) {
        setPhase("password");
        return;
      }
      await loadNote(parsed, info);
    } catch (err) {
      fail(err);
    }
  }, [loadNote]);

  React.useEffect(() => {
    if (initialUrl && !didAutoLoad.current) {
      didAutoLoad.current = true;
      void handleUrl(initialUrl);
    }
  }, [initialUrl, handleUrl]);

  const unlock = async () => {
    try {
      if (!parsedUrl || !noteInfo || !password) return;
      const creds = await prepareDownload(parsedUrl.secret, noteInfo.salt, password, noteInfo.passwordSalt, noteInfo.passwordAlgo);
      const valid = await apiFor(parsedUrl.server).verifyNotePassword(parsedUrl.id, creds.authTokenB64);
      if (!valid) {
        setErrorMsg("That password is wrong. The server counts every try.");
        setPassword("");
        return;
      }
      setErrorMsg("");
      await loadNote(parsedUrl, noteInfo, password);
    } catch (err) {
      fail(err);
    }
  };

  const save = () => {
    try {
      const filePath = path.resolve(expandPath(savePath));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Only the owner may read it: the note can hold passwords and private keys.
      fs.writeFileSync(filePath, noteToText(blocks), { encoding: "utf-8", mode: 0o600 });
      toast(`Saved to ${filePath}`);
      setPhase("display");
    } catch (err) {
      fail(err);
    }
  };

  const hasSecrets = blocks.some((b) => (b.type === "password" && b.entries.some((e) => e.secret !== false)) || (b.type === "sshkey" && b.passphrase));
  const viewHeight = Math.max(4, height - 12);
  const maxScroll = Math.max(0, contentHeight - viewHeight);

  // Page up and down scroll a note longer than the screen, the arrows stay with the buttons.
  useInput((_input, key) => {
    if (key.pageUp) setScroll((s) => Math.max(0, s - viewHeight + 1));
    else if (key.pageDown) setScroll((s) => Math.min(maxScroll, s + viewHeight - 1));
  }, { isActive: active && phase === "display" && maxScroll > 0 });

  if (phase === "loading") {
    return (
      <Panel width={width}>
        <Gap />
        <T>  <Text color={accent}>{SPINNER[frame % SPINNER.length]}</Text> Opening the note</T>
        <Gap />
      </Panel>
    );
  }

  if (phase === "password" || phase === "error") {
    const rows: FormRow[] = phase === "password"
      ? [
          { kind: "input", id: "password", label: "Password", value: password, onChange: setPassword, mask: true, submitHint: "open it", onSubmit: () => void unlock() },
          ...(errorMsg ? [{ kind: "note" as const, content: <Text color={COLORS.danger}>{errorMsg}</Text> }] : []),
          { kind: "section", label: "" },
          { kind: "button", id: "open", label: "Open the note", primary: true, disabled: !password, onPress: () => void unlock() },
          { kind: "button", id: "back", label: "Use another link", onPress: onBack },
        ]
      : [{ kind: "button", id: "back", label: "Use another link", primary: true, onPress: onBack }];
    return (
      <Panel width={width}>
        <Gap />
        {phase === "password" ? (
          <>
            <T bold>  This note has a password</T>
            <Muted>  The sender should have told it to you on another way than the link.</Muted>
          </>
        ) : (
          <>
            <Text color={COLORS.danger} bold>  The note could not be opened</Text>
            <T>  {forTerminal(errorMsg)}</T>
          </>
        )}
        <Gap />
        <Form rows={rows} active={active} height={6} labelWidth={10} onExit={onBack} upExits={false} />
        <Gap />
      </Panel>
    );
  }

  const rows: FormRow[] = phase === "save"
    ? [
        { kind: "input", id: "path", label: "Save to", value: savePath, onChange: setSavePath, submitHint: "save", onSubmit: save },
        { kind: "button", id: "save", label: "Save the note", primary: true, onPress: save },
        { kind: "button", id: "cancel", label: "Cancel", onPress: () => setPhase("display") },
      ]
    : [
        ...(hasSecrets
          ? [{ kind: "button" as const, id: "reveal", label: revealed ? "Hide the passwords" : "Show the passwords", onPress: () => setRevealed((r) => !r) }]
          : []),
        {
          kind: "button",
          id: "copy",
          label: "Copy the note",
          onPress: () => toast(copyToClipboard(noteToText(blocks)) === "system" ? "Note copied to the clipboard" : "Note sent to the terminal's clipboard"),
        },
        {
          kind: "button",
          id: "save",
          label: "Save it to a file",
          onPress: () => {
            setSavePath(path.join(process.cwd(), noteFileName(blocks)));
            setPhase("save");
          },
        },
        { kind: "button", id: "back", label: "Done, open another link", onPress: onBack },
      ];

  return (
    <Panel width={width}>
      <Box justifyContent="space-between">
        <T bold>  Note</T>
        <Muted>{maxViews === 0 ? `view ${viewCount}, no limit` : `view ${viewCount} of ${maxViews}`}</Muted>
      </Box>
      {unreadable && <Text color={COLORS.danger}>  This note could not be read as usual, so it is shown exactly as it arrived.</Text>}
      <Box height={Math.min(viewHeight, contentHeight || viewHeight)} overflow="hidden" flexDirection="column" contentOffsetY={Math.min(scroll, maxScroll)}>
        <Box ref={content} flexDirection="column" flexShrink={0}>
          <Blocks blocks={blocks} revealed={revealed} />
        </Box>
      </Box>
      {maxScroll > 0 && <Faint>  page down and page up to read on, {scroll < maxScroll ? "more below" : "end of the note"}</Faint>}
      <Gap />
      <Form
        rows={rows}
        active={active}
        height={rows.length}
        labelWidth={10}
        onExit={phase === "save" ? () => setPhase("display") : onBack}
        upExits={false}
        {...(maxScroll > 0 ? { extraHints: [{ key: "pgdn pgup", label: "scroll" }] } : {})}
      />
    </Panel>
  );
}
