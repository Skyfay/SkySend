import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { apiFor } from "../../lib/api.js";
import {
  getUploads, getNotes, removeUpload, removeNote, cleanupExpired,
  type StoredUpload, type StoredNote,
} from "../../lib/history.js";
import { ApiError } from "../../lib/errors.js";
import { formatBytes } from "../../lib/progress.js";
import { forTerminal } from "../../lib/terminal.js";
import type { AppState } from "../types.js";
import { COLORS } from "../theme.js";
import { useFocus, useRoom, useToast } from "../shell.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";
import { LinkReady } from "../components/LinkReady.js";
import { plural } from "../components/Progress.js";

type Item = { kind: "file"; record: StoredUpload } | { kind: "note"; record: StoredNote };

/** What the server says about a link now: how often it was used and when it goes. */
type Live =
  | { state: "loading" }
  | { state: "gone" }
  | { state: "error" }
  | { state: "live"; used: number; max: number; expiresAt: string };

interface MyUploadsViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min left`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ${min % 60} min left`;
  return `${Math.floor(hours / 24)} days ${hours % 24} h left`;
}

function age(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function title(item: Item): string {
  if (item.kind === "note") return `Note, ${item.record.contentType}`;
  const names = item.record.fileNames;
  return names.length === 1 ? names[0]! : `${names[0]} and ${names.length - 1} more`;
}

/** The My links tab: what this computer sent to the server, with its state and the link. */
export function MyUploadsView({ appState }: MyUploadsViewProps): React.ReactElement {
  const toast = useToast();
  const { width, height } = useRoom();
  const { active, toTabs } = useFocus();
  const { server } = appState;
  const [, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [live, setLive] = useState<Record<string, Live>>({});
  const requested = useRef(new Set<string>());
  const [cleaned] = useState(() => {
    const { removedUploads, removedNotes } = cleanupExpired();
    return removedUploads + removedNotes;
  });

  // Read on every render, a change to the history bumps `version` to render again.
  const items: Item[] = [
    ...getUploads().filter((u) => u.server === server).map((record) => ({ kind: "file" as const, record })),
    ...getNotes().filter((n) => n.server === server).map((record) => ({ kind: "note" as const, record })),
  ].sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
  const item = items.find((it) => it.record.id === openId);
  const id = item?.record.id;
  const kind = item?.kind;
  const itemServer = item?.record.server;

  // Ask the server once about the link that is open.
  useEffect(() => {
    if (!id || !kind || !itemServer || requested.current.has(id)) return;
    requested.current.add(id);
    const api = apiFor(itemServer);
    const request = kind === "file"
      ? api.fetchInfo(id).then((info) => ({ used: info.downloadCount, max: info.maxDownloads, expiresAt: info.expiresAt }))
      : api.fetchNoteInfo(id).then((info) => ({ used: info.viewCount, max: info.maxViews, expiresAt: info.expiresAt }));
    request
      .then((info) => setLive((prev) => ({ ...prev, [id]: { state: "live", ...info } })))
      .catch((err: unknown) => {
        const gone = err instanceof ApiError && (err.status === 404 || err.status === 410);
        setLive((prev) => ({ ...prev, [id]: { state: gone ? "gone" : "error" } }));
      });
  }, [id, kind, itemServer]);

  const removeLocal = (target: Item) => {
    if (target.kind === "file") removeUpload(target.record.id);
    else removeNote(target.record.id);
    setOpenId(null);
    setVersion((v) => v + 1);
  };

  const deleteRemote = async (target: Item) => {
    const api = apiFor(target.record.server);
    try {
      if (target.kind === "file") await api.deleteUpload(target.record.id, target.record.ownerToken);
      else await api.deleteNote(target.record.id, target.record.ownerToken);
      toast("Deleted from the server");
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 410))) {
        toast(`Not deleted: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      toast("It was already gone from the server");
    }
    removeLocal(target);
  };

  if (item) {
    const state: Live = live[item.record.id] ?? { state: "loading" };
    const gone = state.state === "gone";
    return (
      <LinkReady
        url={item.record.url}
        title={title(item)}
        fresh={false}
        active={active}
        onExit={() => {
          setOpenId(null);
          setConfirm(false);
        }}
        exitHint="back to the list"
        actions={[
          ...(gone
            ? []
            : [{
                id: "delete",
                label: confirm ? "Press enter again to delete it for good" : "Delete it from the server now",
                onPress: () => {
                  if (!confirm) setConfirm(true);
                  else {
                    setConfirm(false);
                    void deleteRemote(item);
                  }
                },
              }]),
          { id: "forget", label: "Take it off this list", onPress: () => removeLocal(item) },
        ]}
      >
        {item.kind === "file" && (
          <Muted>{plural(item.record.fileNames.length, "file")}, {formatBytes(item.record.totalSize)}</Muted>
        )}
        <Muted>Sent {age(item.record.createdAt)}, {item.record.hasPassword ? "with a password" : "no password"}.</Muted>
        {state.state === "live" && (
          <Muted>
            {item.kind === "file" ? "Downloaded" : "Viewed"} {state.used} of {state.max === 0 ? "unlimited" : state.max} times, {timeLeft(state.expiresAt)}.
          </Muted>
        )}
        {state.state === "loading" && <Faint>Asking the server how it stands…</Faint>}
        {gone && <Text color={COLORS.danger}>Gone from the server, used up or expired.</Text>}
        {state.state === "error" && <Faint>The server did not answer.</Faint>}
      </LinkReady>
    );
  }

  if (items.length === 0) {
    return (
      <Panel width={width}>
        <Gap />
        <T bold>  Nothing here yet</T>
        <Muted>  Files you send and notes you write from this computer to {forTerminal(new URL(server).host)} show up here,</Muted>
        <Muted>  with their links, so you can copy them again or delete them early.</Muted>
        {cleaned > 0 && <Faint>  {plural(cleaned, "link")} that ran out were taken off the list.</Faint>}
        <Form rows={[]} active={active} height={1} onExit={toTabs} exitHint="tabs" />
      </Panel>
    );
  }

  const rows: FormRow[] = [
    { kind: "section", label: `${plural(items.length, "link")} sent to ${new URL(server).host}` },
    ...items.map((it): FormRow => ({
      kind: "item",
      id: `link:${it.record.id}`,
      pressHint: "open",
      onPress: () => {
        setOpenId(it.record.id);
        setConfirm(false);
      },
      render: (focused) => (
        <Box justifyContent="space-between" flexGrow={1}>
          <Text wrap="truncate-end">
            <Text color={COLORS.faint}>{it.kind === "file" ? "file  " : "note  "}</Text>
            <Text color={COLORS.text} bold={focused}>{forTerminal(title(it))}</Text>
          </Text>
          <Text color={COLORS.muted}>{age(it.record.createdAt)} </Text>
        </Box>
      ),
    })),
    ...(cleaned > 0 ? [{ kind: "note" as const, content: <Faint>{plural(cleaned, "link")} that ran out were taken off the list.</Faint> }] : []),
  ];

  return (
    <Panel width={width}>
      <Gap />
      <Form rows={rows} active={active} height={Math.max(6, height - 4)} onExit={toTabs} exitHint="tabs" />
      <Gap />
    </Panel>
  );
}
