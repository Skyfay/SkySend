import React, { useCallback, useState } from "react";
import * as path from "node:path";
import { Box, Text, useAnimation } from "ink";
import {
  lookUpShare,
  openShare,
  outputPathFor,
  saveShare,
  type OpenedShare,
} from "../../lib/download-job.js";
import { parseShareUrl, type ParsedUrl } from "../../lib/url.js";
import { forTerminal } from "../../lib/terminal.js";
import { formatBytes } from "../../lib/progress.js";
import { expandPath } from "../../lib/paths.js";
import { sanitizeFilename } from "../../lib/filename.js";
import type { UploadInfo } from "../../lib/api.js";
import type { AppState } from "../types.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form } from "../components/Form.js";
import { SPINNER, TransferProgress, plural, seconds, useRate } from "../components/Progress.js";
import { NoteViewView } from "./NoteView.js";

type Phase = "link" | "looking" | "password" | "target" | "downloading" | "done" | "error" | "note";

interface ReceiveViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
  /** A note link to open right away. */
  initialUrl?: string;
}

/** The Receive tab: a file or note link in, the file on the disk or the note on the screen. */
export function ReceiveView({ appState, onBack, onError, initialUrl }: ReceiveViewProps): React.ReactElement {
  const accent = useAccent();
  const { width } = useRoom();
  const { active, toTabs } = useFocus();
  const [phase, setPhase] = useState<Phase>(initialUrl ? "note" : "link");
  const [link, setLink] = useState(initialUrl ?? "");
  const [password, setPassword] = useState("");
  const [place, setPlace] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [locked, setLocked] = useState<{ link: ParsedUrl; info: UploadInfo } | null>(null);
  const [share, setShare] = useState<OpenedShare | null>(null);
  const [progress, setProgress] = useState({ written: 0, total: 0, ticks: 0 });
  const [saved, setSaved] = useState<{ file: string; size: number; seconds: number } | null>(null);
  const [failure, setFailure] = useState("");
  const { rate, track, reset } = useRate();
  // No timer while the download runs: a render from a timer between two reads left the socket
  // unread at the wrong moment, and over loopback the kernel then held the window shut and the
  // download stood still for seconds. The spinner turns with the progress instead.
  const { frame } = useAnimation({ interval: 90, isActive: phase === "looking" });

  const fail = (err: unknown) => {
    setFailure(err instanceof Error ? err.message : String(err));
    setPhase("error");
  };

  const again = () => {
    setPhase("link");
    setLink("");
    setPassword("");
    setProblem(null);
    setShare(null);
    setSaved(null);
  };

  const open = useCallback(async (parsed: ParsedUrl, info: UploadInfo, secret?: string) => {
    const opened = await openShare(parsed, info, secret);
    setShare(opened);
    setPlace(outputPathFor(opened.metadata));
    setPhase("target");
  }, []);

  const submitLink = async (given = link) => {
    let parsed: ParsedUrl;
    try {
      parsed = parseShareUrl(given.trim());
    } catch {
      setProblem("That is not a SkySend link. It looks like https://host/file/…#…");
      return;
    }
    setProblem(null);
    if (parsed.type === "note") {
      setPhase("note");
      return;
    }
    setPhase("looking");
    try {
      const found = await lookUpShare(given.trim());
      if (found.info.hasPassword) {
        setLocked(found);
        setPassword("");
        setPhase("password");
        return;
      }
      await open(found.link, found.info);
    } catch (err) {
      fail(err);
    }
  };

  const unlock = async () => {
    if (!locked || !password) return;
    setPhase("looking");
    try {
      await open(locked.link, locked.info, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Invalid password") {
        setProblem("That password is wrong. The server counts every try.");
        setPassword("");
        setPhase("password");
      } else {
        fail(err);
      }
    }
  };

  const download = async () => {
    if (!share) return;
    setPhase("downloading");
    reset();
    const started = Date.now();
    // A render per record of 64 KiB would hold the download back, ten a second are plenty.
    let shown = 0;
    try {
      const target = outputPathFor(share.metadata, path.resolve(expandPath(place || ".")));
      const result = await saveShare(share, target, (written, total) => {
        const now = Date.now();
        if (now - shown < 100 && written < total) return;
        shown = now;
        setProgress((prev) => ({ written, total, ticks: prev.ticks + 1 }));
        track(written);
      });
      setSaved({ ...result, seconds: (Date.now() - started) / 1000 });
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  };

  if (phase === "note") {
    return (
      <NoteViewView
        appState={appState}
        onBack={() => {
          again();
          if (initialUrl) onBack();
        }}
        onError={onError}
        initialUrl={link}
      />
    );
  }

  const metadata = share?.metadata;
  const name = metadata?.type === "single" ? sanitizeFilename(metadata.name) : "archive.zip";
  const total = metadata ? (metadata.type === "single" ? metadata.size : (metadata.archiveSize ?? 0)) : 0;

  return (
    <Panel width={width}>
      <Gap />
      {phase === "link" && (
        <>
          <T bold>  Receive a file or a note</T>
          <Muted>  Paste the link you got. Everything after the # is the key, it never reaches the server.</Muted>
          <Gap />
          <Form
            rows={[
              {
                kind: "input",
                id: "link",
                label: "Link",
                value: link,
                onChange: (v) => {
                  setLink(v);
                  setProblem(null);
                },
                placeholder: "paste it here",
                submitHint: "open it",
                onSubmit: () => void submitLink(),
              },
              ...(problem ? [{ kind: "note" as const, content: <Text color={COLORS.danger}>{problem}</Text> }] : []),
              { kind: "section", label: "" },
              { kind: "button", id: "open", label: "Open the link", primary: true, disabled: !link.trim(), onPress: () => void submitLink() },
            ]}
            active={active}
            height={8}
            labelWidth={8}
            onExit={toTabs}
            exitHint="tabs"
            onPaste={(text) => {
              const line = (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
              setLink(line);
              void submitLink(line);
            }}
          />
        </>
      )}
      {phase === "looking" && (
        <>
          <T>  <Text color={accent}>{SPINNER[frame % SPINNER.length]}</Text> Opening the link</T>
          <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
        </>
      )}
      {phase === "password" && (
        <>
          <T bold>  This file has a password</T>
          <Muted>  The sender should have told it to you on another way than the link.</Muted>
          <Gap />
          <Form
            rows={[
              { kind: "input", id: "password", label: "Password", value: password, onChange: setPassword, mask: true, submitHint: "unlock", onSubmit: () => void unlock() },
              ...(problem ? [{ kind: "note" as const, content: <Text color={COLORS.danger}>{problem}</Text> }] : []),
              { kind: "section", label: "" },
              { kind: "button", id: "unlock", label: "Unlock", primary: true, disabled: !password, onPress: () => void unlock() },
              { kind: "button", id: "cancel", label: "Use another link", onPress: again },
            ]}
            active={active}
            height={8}
            labelWidth={10}
            onExit={again}
            upExits={false}
          />
        </>
      )}
      {phase === "target" && metadata && (
        <>
          <T bold>  {forTerminal(name)}</T>
          <Muted>  {metadata.type === "archive" ? `${plural(metadata.files.length, "file")} in one zip, ` : ""}{formatBytes(total)}</Muted>
          {metadata.type === "archive" && (
            <Box backgroundColor={COLORS.well} flexDirection="column" paddingX={1} marginX={2} marginTop={1}>
              {metadata.files.slice(0, 5).map((f, i) => (
                <Box key={`${f.name}-${i}`} justifyContent="space-between">
                  <Text color={COLORS.text} wrap="truncate-end">{forTerminal(f.name)}</Text>
                  <Text color={COLORS.muted}>{formatBytes(f.size)}</Text>
                </Box>
              ))}
              {metadata.files.length > 5 && <Faint>and {metadata.files.length - 5} more</Faint>}
            </Box>
          )}
          <Gap />
          <Form
            rows={[
              { kind: "button", id: "download", label: "Download", primary: true, onPress: () => void download() },
              { kind: "input", id: "place", label: "Save to", value: place, onChange: setPlace, submitHint: "download", onSubmit: () => void download() },
              { kind: "note", content: <Faint>A folder keeps the name above, a file name replaces it.</Faint> },
              { kind: "button", id: "cancel", label: "Use another link", onPress: again },
            ]}
            active={active}
            height={6}
            labelWidth={10}
            onExit={again}
            upExits={false}
          />
        </>
      )}
      {phase === "downloading" && (
        <>
          <T>  <Text color={accent}>{SPINNER[progress.ticks % SPINNER.length]}</Text> <Text bold>Receiving {forTerminal(name)}</Text></T>
          <Gap />
          <Box paddingX={2} flexDirection="column">
            <TransferProgress
              ratio={progress.total > 0 ? progress.written / progress.total : 0}
              done={progress.written}
              total={progress.total || total}
              rate={rate}
              width={width - 8}
            />
          </Box>
          <Gap />
          <Faint>  Decrypted on this computer while it arrives. You can use the other tabs meanwhile.</Faint>
          <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
        </>
      )}
      {phase === "done" && saved && (
        <>
          <Text color={accent} bold>  ✓ Saved</Text>
          <Gap />
          <Box backgroundColor={COLORS.well} paddingX={1} marginX={2}>
            <T bold>{forTerminal(saved.file)}</T>
          </Box>
          <Muted>
            {"  "}{formatBytes(saved.size)} in {seconds(saved.seconds)}
            {saved.seconds > 0 ? ` (${formatBytes(saved.size / saved.seconds)}/s)` : ""}
            {metadata?.type === "archive" ? `, a zip with ${plural(metadata.files.length, "file")}` : ""}
          </Muted>
          <Gap />
          <Form
            rows={[{ kind: "button", id: "again", label: "Receive another", primary: true, onPress: again }]}
            active={active}
            height={1}
            onExit={toTabs}
            exitHint="tabs"
          />
        </>
      )}
      {phase === "error" && (
        <>
          <Text color={COLORS.danger} bold>  That did not work</Text>
          <T>  {forTerminal(failure)}</T>
          <Gap />
          <Form
            rows={[{ kind: "button", id: "again", label: "Try another link", primary: true, onPress: again }]}
            active={active}
            height={1}
            onExit={toTabs}
            exitHint="tabs"
          />
        </>
      )}
      <Gap />
    </Panel>
  );
}
