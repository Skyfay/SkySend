import React, { useEffect, useRef, useState } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Box, Text, useAnimation } from "ink";
import type { ReadBlock } from "@skysend/note-format";
import type { OpenedUpload } from "@skysend/transfer";
import {
  deleteEntry,
  describeEntry,
  inboxEntries,
  openInboxFrom,
  readEntryNote,
  readInboxLink,
  saveEntry,
  savePathFor,
  type OpenInbox,
} from "../../lib/inbox-job.js";
import { formatBytes } from "../../lib/progress.js";
import { forTerminal } from "../../lib/terminal.js";
import { expandPath } from "../../lib/paths.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom, useToast } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";
import { SPINNER, TransferProgress, plural, useRate } from "../components/Progress.js";
import { Blocks } from "./NoteView.js";

type Phase = "password" | "opening" | "list" | "target" | "saving" | "note" | "error";

/** A path as short as it reads: relative below the folder the CLI started in, else whole. */
function shortPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

/** The size an upload had before it was encrypted, where its metadata names one. */
function sizeOf(entry: OpenedUpload): number {
  const metadata = entry.file?.metadata;
  if (metadata?.type === "archive") return metadata.archiveSize ?? entry.upload.size;
  return metadata?.size ?? entry.upload.size;
}

interface InboxViewProps {
  /** The inbox link of a file request. */
  link: string;
  /** Back to the link field of the Receive tab. */
  onBack: () => void;
}

/**
 * The inbox of a file request, opened from its link in the Receive tab: what arrived, saved one
 * by one or all at once, notes read here, uploads deleted. Listing downloads nothing.
 */
export function InboxView({ link, onBack }: InboxViewProps): React.ReactElement {
  const accent = useAccent();
  const toast = useToast();
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const [phase, setPhase] = useState<Phase>("opening");
  const [password, setPassword] = useState("");
  // The password that opened the inbox, kept in memory to look again after a change.
  const [opener, setOpener] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [inbox, setInbox] = useState<OpenInbox | null>(null);
  // What to save and where. `all` saves everything into a folder, else one upload.
  const [target, setTarget] = useState<{
    entries: OpenedUpload[];
    place: string;
    all: boolean;
  } | null>(null);
  const [progress, setProgress] = useState({ written: 0, total: 0, ticks: 0, index: 0 });
  const [note, setNote] = useState<{ blocks: ReadBlock[]; unreadable: boolean } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [removeAsked, setRemoveAsked] = useState<string | null>(null);
  const { rate, track, reset } = useRate();
  const { frame } = useAnimation({ interval: 90, isActive: phase === "opening" });
  const started = useRef(false);

  const fail = (err: unknown) => {
    setFailure(err instanceof Error ? err.message : String(err));
    setPhase("error");
  };

  /** Opens the inbox, or opens it again to show what changed. */
  const load = async (withPassword?: string) => {
    setPhase("opening");
    try {
      const opened = await openInboxFrom(link, withPassword);
      setInbox(opened);
      setOpener(withPassword);
      setProblem(null);
      setPhase("list");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (withPassword && message.startsWith("Wrong password")) {
        setProblem(message);
        setPassword("");
        setPhase("password");
      } else {
        fail(err);
      }
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (readInboxLink(link).needsPassword) setPhase("password");
        else await load();
      } catch (err) {
        fail(err);
      }
    })();
    // Opens the link it was given once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Enter on an upload: a note opens here, a file asks where it goes. */
  const choose = async (entry: OpenedUpload) => {
    if (!inbox || !entry.file) return;
    if (entry.file.metadata.type === "note") {
      setPhase("opening");
      try {
        setNote(await readEntryNote(inbox, entry));
        setRevealed(false);
        setPhase("note");
      } catch (err) {
        fail(err);
      }
      return;
    }
    setTarget({ entries: [entry], place: savePathFor(entry, process.cwd()), all: false });
    setPhase("target");
  };

  /** Del on an upload, twice: deletes it from the inbox for good. */
  const remove = async (entry: OpenedUpload) => {
    if (!inbox) return;
    if (removeAsked !== entry.upload.id) {
      setRemoveAsked(entry.upload.id);
      return;
    }
    setRemoveAsked(null);
    try {
      await deleteEntry(inbox, entry);
      toast(`Deleted ${describeEntry(entry)}`);
      await load(opener);
    } catch (err) {
      fail(err);
    }
  };

  /** Saves what `target` holds: one upload to a path or a folder, or everything to a folder. */
  const save = async () => {
    if (!inbox || !target) return;
    setPhase("saving");
    reset();
    const place = path.resolve(expandPath(target.place || "."));
    const single = !target.all;
    const folder = target.all || (fs.existsSync(place) && fs.statSync(place).isDirectory());
    let shown = 0;
    let saved = 0;
    let last = place;
    try {
      for (const [index, entry] of target.entries.entries()) {
        setProgress({ written: 0, total: 0, ticks: 0, index });
        const output = folder ? savePathFor(entry, place) : place;
        // A render per record would hold the download back, ten a second are plenty.
        last = output;
        await saveEntry(inbox, entry, output, (written, total) => {
          const now = Date.now();
          if (now - shown < 100 && written < total) return;
          shown = now;
          setProgress((prev) => ({ written, total, ticks: prev.ticks + 1, index }));
          track(written);
        });
        saved += 1;
      }
      toast(
        single
          ? `Saved ${shortPath(last)}`
          : `Saved ${plural(saved, "upload")} to ${shortPath(place) || "."}`,
      );
      await load(opener);
    } catch (err) {
      fail(err);
    }
  };

  // ── Screens ──────────────────────────────────────────

  if (phase === "password") {
    return (
      <Panel width={width}>
        <Gap />
        <T bold> This inbox has a password</T>
        <Muted> The one you set when you made the request.</Muted>
        <Gap />
        <Form
          rows={[
            {
              kind: "input",
              id: "password",
              label: "Password",
              value: password,
              onChange: setPassword,
              mask: true,
              submitHint: "open it",
              onSubmit: () => void load(password),
            },
            ...(problem
              ? [
                  {
                    kind: "note" as const,
                    content: <Text color={COLORS.danger}>{forTerminal(problem)}</Text>,
                  },
                ]
              : []),
            { kind: "section", label: "" },
            {
              kind: "button",
              id: "open",
              label: "Open the inbox",
              primary: true,
              disabled: !password,
              onPress: () => void load(password),
            },
            { kind: "button", id: "back", label: "Use another link", onPress: onBack },
          ]}
          active={active}
          height={8}
          labelWidth={10}
          onExit={onBack}
          upExits={false}
        />
      </Panel>
    );
  }

  if (phase === "opening") {
    return (
      <Panel width={width}>
        <Gap />
        <T>
          {" "}
          <Text color={accent}>{SPINNER[frame % SPINNER.length]}</Text> Opening the inbox
        </T>
        <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
      </Panel>
    );
  }

  if (phase === "error") {
    return (
      <Panel width={width}>
        <Gap />
        <Text color={COLORS.danger} bold>
          {" "}
          That did not work
        </Text>
        <T> {forTerminal(failure)}</T>
        <Gap />
        <Form
          rows={[
            ...(inbox
              ? [
                  {
                    kind: "button" as const,
                    id: "list",
                    label: "Back to the inbox",
                    primary: true,
                    onPress: () => void load(opener),
                  },
                ]
              : []),
            {
              kind: "button",
              id: "back",
              label: "Use another link",
              primary: !inbox,
              onPress: onBack,
            },
          ]}
          active={active}
          height={2}
          onExit={toTabs}
          exitHint="tabs"
        />
        <Gap />
      </Panel>
    );
  }

  if (phase === "note" && note) {
    const hasSecrets = note.blocks.some(
      (b) => b.type === "password" || (b.type === "sshkey" && b.passphrase),
    );
    return (
      <Panel width={width}>
        <Gap />
        <T bold> A note in the inbox</T>
        {note.unreadable && <Muted> It did not read as a note, here is its text as it came.</Muted>}
        <Gap />
        <Blocks blocks={note.blocks} revealed={revealed} />
        <Gap />
        <Form
          rows={[
            ...(hasSecrets
              ? [
                  {
                    kind: "button" as const,
                    id: "reveal",
                    label: revealed ? "Hide the passwords" : "Show the passwords",
                    onPress: () => setRevealed((r) => !r),
                  },
                ]
              : []),
            {
              kind: "button",
              id: "back",
              label: "Back to the inbox",
              primary: !hasSecrets,
              onPress: () => void load(opener),
            },
          ]}
          active={active}
          height={2}
          onExit={() => void load(opener)}
          upExits={false}
        />
        <Gap />
      </Panel>
    );
  }

  if (phase === "target" && target) {
    const single = target.all ? null : target.entries[0]!;
    return (
      <Panel width={width}>
        <Gap />
        <T bold>
          {" "}
          {single
            ? forTerminal(describeEntry(single))
            : `Everything, ${plural(target.entries.length, "upload")}`}
        </T>
        <Muted>
          {" "}
          {formatBytes(target.entries.reduce((sum, e) => sum + sizeOf(e), 0))}. Each download counts
          against what the request allows.
        </Muted>
        <Gap />
        <Form
          rows={[
            {
              kind: "button",
              id: "save",
              label: "Download",
              primary: true,
              onPress: () => void save(),
            },
            {
              kind: "input",
              id: "place",
              label: "Save to",
              value: target.place,
              onChange: (place) => setTarget({ ...target, place }),
              submitHint: "download",
              onSubmit: () => void save(),
            },
            {
              kind: "note",
              content: (
                <Faint>
                  {single
                    ? "A folder keeps the name above, a file name replaces it."
                    : "A folder. Names already there are kept, new ones get a number."}
                </Faint>
              ),
            },
            {
              kind: "button",
              id: "back",
              label: "Back to the inbox",
              onPress: () => setPhase("list"),
            },
          ]}
          active={active}
          height={6}
          labelWidth={10}
          onExit={() => setPhase("list")}
          upExits={false}
        />
      </Panel>
    );
  }

  if (phase === "saving" && target) {
    const entry = target.entries[progress.index];
    return (
      <Panel width={width}>
        <Gap />
        <T>
          {"  "}
          <Text color={accent}>{SPINNER[progress.ticks % SPINNER.length]}</Text>{" "}
          <Text bold>
            {target.entries.length > 1 ? `${progress.index + 1} of ${target.entries.length}: ` : ""}
            {entry ? forTerminal(describeEntry(entry)) : ""}
          </Text>
        </T>
        <Gap />
        <Box paddingX={2} flexDirection="column">
          <TransferProgress
            ratio={progress.total > 0 ? progress.written / progress.total : 0}
            done={progress.written}
            total={progress.total || (entry ? sizeOf(entry) : 0)}
            rate={rate}
            width={width - 8}
          />
        </Box>
        <Gap />
        <Faint>
          {" "}
          Decrypted on this computer while it arrives. You can use the other tabs meanwhile.
        </Faint>
        <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
      </Panel>
    );
  }

  // ── The list ─────────────────────────────────────────

  const groups = inbox ? inboxEntries(inbox) : [];
  const openable = groups.flat().filter((e) => e.file);
  const rows: FormRow[] = [];
  groups.forEach((group, i) => {
    if (group.length > 1) rows.push({ kind: "section", label: "Sent together" });
    for (const entry of group) {
      const id = entry.upload.id;
      const isNote = entry.file?.metadata.type === "note";
      rows.push({
        kind: "item",
        id: `u:${id}`,
        ...(entry.file
          ? { onPress: () => void choose(entry), pressHint: isNote ? "read it" : "download it" }
          : {}),
        onRemove: () => void remove(entry),
        removeHint: removeAsked === id ? "press del again to delete it" : "delete it",
        render: (focused) => (
          <Box justifyContent="space-between" flexGrow={1}>
            <Text wrap="truncate-end">
              <Text
                color={removeAsked === id ? COLORS.danger : entry.file ? COLORS.text : COLORS.faint}
                bold={focused}
              >
                {forTerminal(describeEntry(entry))}
              </Text>
            </Text>
            <Text color={COLORS.muted}>
              {formatBytes(sizeOf(entry))} {entry.upload.downloadCount} of{" "}
              {entry.upload.maxDownloads} downloads{" "}
            </Text>
          </Box>
        ),
      });
    }
    // A gap after a group, unless the buttons come next with their own.
    if (group.length > 1 && i < groups.length - 1) rows.push({ kind: "section", label: "" });
  });
  if (groups.length === 0)
    rows.push({ kind: "note", content: <Muted>Nothing arrived yet.</Muted> });
  rows.push(
    { kind: "section", label: "" },
    {
      kind: "button",
      id: "all",
      label:
        openable.length > 0
          ? `Download everything, ${plural(openable.length, "upload")}`
          : "Download everything",
      primary: true,
      disabled: openable.length === 0,
      onPress: () => {
        setTarget({ entries: openable, place: process.cwd(), all: true });
        setPhase("target");
      },
    },
    { kind: "button", id: "refresh", label: "Look again", onPress: () => void load(opener) },
    { kind: "button", id: "back", label: "Open another link", onPress: onBack },
  );

  return (
    <Panel width={width}>
      <Gap />
      <T bold>
        {" "}
        {inbox?.opened.title ? forTerminal(inbox.opened.title) : "The inbox of a file request"}
      </T>
      <Muted> {plural(groups.flat().length, "upload")}. Listing downloads nothing.</Muted>
      <Gap />
      <Form
        rows={rows}
        active={active}
        height={Math.max(6, height - 7)}
        onExit={toTabs}
        exitHint="tabs"
      />
      <Gap />
    </Panel>
  );
}
