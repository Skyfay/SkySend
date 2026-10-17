import React, { useCallback, useRef, useState } from "react";
import * as path from "node:path";
import { Box, Text, useAnimation } from "ink";
import { getWebSocket } from "../../lib/config.js";
import { addUpload } from "../../lib/history.js";
import { formatBytes, formatExpiry } from "../../lib/progress.js";
import { runUpload, type UploadJobResult } from "../../lib/upload-job.js";
import { ensureOidcAuth } from "../../lib/oidc.js";
import { forTerminal } from "../../lib/terminal.js";
import { checkNewPassword } from "../../lib/input.js";
import { expandPath, pastedPaths } from "../../lib/paths.js";
import type { AppState } from "../types.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";
import { FilePicker, measure, type PickedItem } from "../components/FilePicker.js";
import { LinkReady } from "../components/LinkReady.js";
import { SPINNER, TransferProgress, plural, seconds, useRate } from "../components/Progress.js";

type Phase = "compose" | "pick" | "auth" | "uploading" | "done" | "error";

interface UploadViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
  /** After an upload, so the quota can be read again. */
  onUploaded: () => void;
}

/** "Deleted after 1 day or 1 download, whichever comes first." */
function lifetime(expireSec: number, downloads: number): string {
  return `Deleted after ${formatExpiry(expireSec)} or ${plural(downloads, "download")}, whichever comes first.`;
}

/** The next value of a list of options in a direction, staying at the ends. */
function step<T>(values: readonly T[], current: T, by: number): T {
  const at = Math.max(0, values.indexOf(current));
  return values[Math.min(values.length - 1, Math.max(0, at + by))]!;
}

/** The Send tab: a form with the files, the options and the button, then the upload and its link. */
export function UploadView({ appState, onUploaded }: UploadViewProps): React.ReactElement {
  const accent = useAccent();
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const { server, config, quota } = appState;
  const host = new URL(server).host;

  const [phase, setPhase] = useState<Phase>("compose");
  const [items, setItems] = useState<PickedItem[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [expireSec, setExpireSec] = useState(config.fileDefaultExpire);
  const [maxDownloads, setMaxDownloads] = useState(config.fileDefaultDownload);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number }>({ id: "add", n: 0 });
  const [progress, setProgress] = useState({ loaded: 0, total: 0, finishing: false });
  const { rate, track, reset } = useRate();
  const [result, setResult] = useState<(UploadJobResult & { seconds: number }) | null>(null);
  const [failure, setFailure] = useState("");
  // Cancelling takes a second enter, so a stray one does not throw the upload away.
  const [cancelAsked, setCancelAsked] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const { frame } = useAnimation({ interval: 90, isActive: phase === "uploading" || phase === "auth" });

  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  const fileCount = items.reduce((sum, item) => sum + item.count, 0);
  const tooBig = totalSize > config.fileMaxSize;
  const tooMany = fileCount > config.fileMaxFilesPerUpload || items.some((i) => i.tooMany);
  const what = plural(fileCount, "file");
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));

  const add = useCallback((paths: string[]) => {
    const found: PickedItem[] = [];
    const missing: string[] = [];
    for (const p of paths) {
      const item = measure(p, config.fileMaxFilesPerUpload);
      if (item) found.push(item);
      else missing.push(p);
    }
    setItems((prev) => [...prev, ...found.filter((f) => !prev.some((p) => p.path === f.path))]);
    setProblem(missing.length > 0 ? `Nothing found at ${missing.join(", ")}` : null);
    return found.length;
  }, [config.fileMaxFilesPerUpload]);

  const send = async () => {
    if (password && checkNewPassword(password) !== true) {
      setProblem(`Password: ${checkNewPassword(password) as string}`);
      focusOn("password");
      return;
    }
    if (config.forceFilePassword && !password) {
      setProblem("This server wants a password on every upload.");
      focusOn("password");
      return;
    }
    setProblem(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let oidcToken: string | undefined;
      if (config.oidcProtectFiles) {
        setPhase("auth");
        oidcToken = await ensureOidcAuth(server);
      }
      setPhase("uploading");
      setCancelAsked(false);
      setProgress({ loaded: 0, total: 0, finishing: false });
      reset();
      const started = Date.now();
      let doneAt = 0;
      const uploaded = await runUpload(
        {
          server,
          paths: items.map((item) => item.path),
          config,
          expireSec,
          maxDownloads,
          ...(password ? { password } : {}),
          ...(oidcToken ? { oidcToken } : {}),
          webSocket: getWebSocket(server),
          signal: controller.signal,
        },
        {
          onProgress: (loaded, total) => {
            setProgress({ loaded, total, finishing: false });
            track(loaded);
          },
          onPhase: (next) => {
            if (next !== "saving-meta" || doneAt > 0) return;
            doneAt = Date.now();
            setProgress((prev) => ({ ...prev, finishing: true }));
          },
        },
      );
      addUpload({
        id: uploaded.id,
        server,
        url: uploaded.url,
        ownerToken: uploaded.ownerToken,
        fileNames: uploaded.names,
        totalSize: uploaded.totalSize,
        hasPassword: uploaded.hasPassword,
        createdAt: new Date().toISOString(),
        expireSec,
      });
      setResult({ ...uploaded, seconds: ((doneAt || Date.now()) - started) / 1000 });
      setPhase("done");
      onUploaded();
    } catch (err) {
      if (controller.signal.aborted) {
        setProblem("The upload was cancelled, nothing was shared.");
        setPhase("compose");
        focusOn("send");
      } else {
        setFailure(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    } finally {
      abort.current = null;
    }
  };

  const startOver = () => {
    setItems([]);
    setPassword("");
    setResult(null);
    setProblem(null);
    setPhase("compose");
    focusOn("add");
  };

  // ── Screens over the form ────────────────────────────

  if (phase === "pick") {
    return (
      <FilePicker
        maxFiles={config.fileMaxFilesPerUpload}
        onDone={(picked) => {
          setItems((prev) => [...prev, ...picked.filter((p) => !prev.some((i) => i.path === p.path))]);
          setProblem(null);
          setPhase("compose");
          focusOn("send");
        }}
        onCancel={() => setPhase("compose")}
      />
    );
  }

  if (phase === "auth") {
    return (
      <Panel width={width}>
        <Gap />
        <T>  <Text color={accent}>{SPINNER[frame % SPINNER.length]}</Text> <Text bold>Waiting for the login in your browser</Text></T>
        <Muted>  {forTerminal(host)} wants you to sign in before you send files. A browser window opened for it.</Muted>
        <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
      </Panel>
    );
  }

  if (phase === "uploading") {
    const ratio = progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : 0;
    const sentPlain = ratio * totalSize;
    const spin = SPINNER[frame % SPINNER.length];
    // Where each item ends in the plaintext, to tell which are through.
    const ends = items.reduce<number[]>((acc, item) => [...acc, (acc.at(-1) ?? 0) + item.size], []);
    const listRows = Math.max(2, height - 18);
    return (
      <Panel width={width} paddingX={2}>
        <Gap />
        <T><Text color={accent}>{spin}</Text> <Text bold>{progress.finishing ? "Finishing up" : `Sending ${what} to ${forTerminal(host)}`}</Text></T>
        <Gap />
        <TransferProgress ratio={ratio} done={sentPlain} total={totalSize} rate={rate} width={width - 8} finishing={progress.finishing} />
        <Gap />
        <Box backgroundColor={COLORS.well} flexDirection="column" paddingX={1}>
          {items.slice(0, listRows).map((item, index) => {
            const from = ends[index]! - item.size;
            const done = sentPlain >= ends[index]!;
            const current = !done && sentPlain >= from;
            return (
              <Box key={item.path} justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text color={done || current ? accent : COLORS.faint}>{done ? "✓" : current ? spin : "·"}</Text>
                  <Text color={done ? COLORS.muted : COLORS.text}> {forTerminal(path.basename(item.path))}{item.folder ? "/" : ""}</Text>
                </Text>
                <Text color={current ? COLORS.text : COLORS.muted}>
                  {current ? `${formatBytes(sentPlain - from)} of ${formatBytes(item.size)}` : formatBytes(item.size)}
                </Text>
              </Box>
            );
          })}
          {items.length > listRows && <Faint>  and {items.length - listRows} more</Faint>}
        </Box>
        <Gap />
        <Faint>Encrypted before it leaves this computer. You can use the other tabs meanwhile.</Faint>
        <Gap />
        <Form
          rows={[{
            kind: "button",
            id: "cancel",
            label: cancelAsked ? "Press enter again to cancel the upload" : "Cancel the upload",
            onPress: () => (cancelAsked ? abort.current?.abort() : setCancelAsked(true)),
          }]}
          active={active}
          height={1}
          onExit={toTabs}
          exitHint="tabs"
        />
        <Gap />
      </Panel>
    );
  }

  if (phase === "done" && result) {
    const speed = result.seconds > 0 ? result.size / result.seconds : 0;
    return (
      <LinkReady
        url={result.url}
        title="Your link is ready"
        actions={[{ id: "more", label: "Send more files", onPress: startOver }]}
        active={active}
        onExit={toTabs}
        exitHint="tabs"
      >
        <Muted>
          {plural(result.fileCount, "file")}, {formatBytes(result.size)}, sent in {seconds(result.seconds)}
          {speed > 0 ? ` (${formatBytes(speed)}/s)` : ""}
        </Muted>
        <Muted>{lifetime(expireSec, maxDownloads)}</Muted>
        <Muted>{result.hasPassword ? "Protected with a password. Tell it on another way than the link." : "No password."}</Muted>
        <Faint>It is in My links, where you can delete it early.</Faint>
      </LinkReady>
    );
  }

  if (phase === "error") {
    return (
      <Panel width={width}>
        <Gap />
        <Text color={COLORS.danger} bold>  The upload failed</Text>
        <T>  {forTerminal(failure)}</T>
        <Gap />
        <Form
          rows={[{ kind: "button", id: "back", label: "Back to the files", primary: true, onPress: () => { setPhase("compose"); focusOn("send"); } }]}
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

  const ready = items.length > 0 && !tooBig && !tooMany;
  const used = quota?.enabled ? Math.min(10, Math.round((quota.used / Math.max(quota.limit, 1)) * 10)) : 0;
  const rows: FormRow[] = [
    { kind: "section", label: items.length ? `Files, ${what}, ${formatBytes(totalSize)}` : "Files" },
    ...items.map((item): FormRow => ({
      kind: "item",
      id: `item:${item.path}`,
      onRemove: () => setItems((prev) => prev.filter((i) => i.path !== item.path)),
      removeHint: "take it out",
      render: (focused) => (
        <Box justifyContent="space-between" flexGrow={1}>
          <Text wrap="truncate-end">
            <Text color={COLORS.text} bold={focused}>{forTerminal(path.basename(item.path))}{item.folder ? "/" : ""}</Text>
            {item.folder && <Text color={COLORS.muted}>  {plural(item.count, "file")}{item.tooMany ? "+" : ""}</Text>}
          </Text>
          <Text color={COLORS.muted}>{formatBytes(item.size)} </Text>
        </Box>
      ),
    })),
    { kind: "button", id: "add", label: items.length ? "+ Add more files or folders" : "+ Pick files or folders", onPress: () => setPhase("pick") },
    {
      kind: "input",
      id: "path",
      label: "Or a path",
      value: pathInput,
      onChange: setPathInput,
      placeholder: "type or paste one, or drop files on the window",
      submitHint: "add it",
      onSubmit: () => {
        if (!pathInput.trim()) return focusOn("send");
        if (add([expandPath(pathInput)]) > 0) {
          setPathInput("");
          focusOn("send");
        }
      },
    },
    { kind: "section", label: "Options" },
    {
      kind: "choice",
      id: "expires",
      label: "Expires after",
      value: formatExpiry(expireSec),
      onChange: (by) => setExpireSec((v) => step(config.fileExpireOptions, v, by)),
    },
    {
      kind: "choice",
      id: "downloads",
      label: "Downloads",
      value: maxDownloads === 1 ? "1 download" : `${maxDownloads} downloads`,
      onChange: (by) => setMaxDownloads((v) => step(config.fileDownloadOptions, v, by)),
    },
    {
      kind: "input",
      id: "password",
      label: "Password",
      value: password,
      onChange: setPassword,
      mask: true,
      placeholder: config.forceFilePassword ? "required by this server" : "none, or type one",
    },
    { kind: "section", label: "" },
    ...(problem || tooBig || tooMany
      ? [{
          kind: "note" as const,
          lines: 1,
          content: (
            <Text color={COLORS.danger} wrap="truncate-end">
              {problem
                ?? (tooBig
                  ? `Too large, ${forTerminal(host)} takes up to ${formatBytes(config.fileMaxSize)}.`
                  : `Too many files, ${forTerminal(host)} takes up to ${config.fileMaxFilesPerUpload} at once.`)}
            </Text>
          ),
        }]
      : []),
    {
      kind: "button",
      id: "send",
      primary: true,
      disabled: !ready,
      label: ready ? `Send ${what}` : "Send (pick files first)",
      onPress: () => void send(),
    },
    {
      kind: "note",
      lines: quota?.enabled ? 2 : 1,
      content: (
        <>
          <Faint>
            {fileCount > 1 || items.some((i) => i.folder)
              ? "Several files go up as one zip, with the names you see."
              : `Up to ${formatBytes(config.fileMaxSize)} and ${config.fileMaxFilesPerUpload} files. Several go up as one zip.`}
          </Faint>
          {quota?.enabled && (
            <Text>
              <Faint>Your quota today </Faint>
              <Text color={accent}>{"▰".repeat(used)}</Text>
              <Text color={COLORS.track}>{"▱".repeat(10 - used)}</Text>
              <Faint> {formatBytes(quota.used)} of {formatBytes(quota.limit)}</Faint>
            </Text>
          )}
        </>
      ),
    },
  ];

  return (
    <Panel width={width}>
      <Gap />
      <Form
        rows={rows}
        active={active}
        height={Math.max(8, height - 4)}
        focus={focus}
        onExit={toTabs}
        exitHint="tabs"
        onPaste={(text) => {
          if (add(pastedPaths(text)) > 0) focusOn("send");
        }}
      />
      <Gap />
    </Panel>
  );
}
