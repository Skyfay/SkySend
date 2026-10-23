import React, { useMemo, useState } from "react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Box, Text } from "ink";
import { formatBytes } from "../../lib/progress.js";
import { listSources } from "../../lib/upload-job.js";
import { forTerminal } from "../../lib/terminal.js";
import { COLORS, useAccent } from "../theme.js";
import { useFocus, useRoom } from "../shell.js";
import { Muted, Panel, T } from "./Frame.js";
import { Form, type FormRow } from "./Form.js";

/** A file or a folder picked to send, with what it holds. */
export interface PickedItem {
  path: string;
  folder: boolean;
  size: number;
  /** Files inside, 1 for a file. */
  count: number;
  /** The folder holds more files than one upload takes. */
  tooMany: boolean;
}

interface Entry {
  name: string;
  folder: boolean;
  size: number;
  changed: Date;
}

interface FilePickerProps {
  /** The most files one upload takes, which also stops measuring a huge folder early. */
  maxFiles: number;
  onDone: (items: PickedItem[]) => void;
  onCancel: () => void;
}

/** What a picked path holds. A folder is walked up to one file past the limit. */
export function measure(target: string, maxFiles: number): PickedItem | null {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isFile()) return { path: target, folder: false, size: stat.size, count: 1, tooMany: false };
  if (!stat.isDirectory()) return null;
  try {
    const { entries, truncated } = listSources([target], maxFiles);
    const size = entries.reduce((sum, e) => sum + e.size, 0);
    return { path: target, folder: true, size, count: entries.length, tooMany: truncated };
  } catch {
    return null;
  }
}

function readFolder(dir: string, hidden: boolean): Entry[] {
  try {
    const entries: Entry[] = [];
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!hidden && child.name.startsWith(".")) continue;
      const stat = fs.statSync(path.join(dir, child.name), { throwIfNoEntry: false });
      if (!stat || (!stat.isFile() && !stat.isDirectory())) continue;
      entries.push({ name: child.name, folder: stat.isDirectory(), size: stat.size, changed: stat.mtime });
    }
    return entries.sort((a, b) =>
      a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

function itemsIn(dir: string): string {
  try {
    const count = fs.readdirSync(dir).length;
    return `${count} item${count === 1 ? "" : "s"}`;
  } catch {
    return "";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = String(date.getDate()).padStart(2, "0");
  return sameYear ? `${MONTHS[date.getMonth()]} ${day}` : `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The places of a file dialog that exist on this machine. */
function places(): Array<{ label: string; dir: string }> {
  const home = os.homedir();
  const named = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"]
    .map((name) => ({ label: name, dir: path.join(home, name) }))
    .filter((p) => fs.statSync(p.dir, { throwIfNoEntry: false })?.isDirectory());
  return [{ label: "Home", dir: home }, ...named, { label: "Computer", dir: path.parse(home).root }];
}

/**
 * A file dialog in the terminal. Space selects files and whole folders, → opens a folder and ←
 * goes up. Enter is done: it moves the cursor to the Add button on top, which adds what is
 * selected across folders. Before anything is selected, enter opens a folder or takes a file.
 */
export function FilePicker({ maxFiles, onDone, onCancel }: FilePickerProps): React.ReactElement {
  const accent = useAccent();
  const { width, height } = useRoom();
  const { active } = useFocus();
  const spots = useMemo(() => places(), []);
  const [cwd, setCwd] = useState(process.cwd());
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Map<string, PickedItem>>(new Map());
  const [focus, setFocus] = useState<{ id: string; n: number } | undefined>(undefined);

  const all = useMemo(() => readFolder(cwd, hidden), [cwd, hidden]);
  const entries = filter ? all.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) : all;

  const open = (dir: string, cursorOn?: string) => {
    setCwd(dir);
    setFilter("");
    setFocus((f) => ({ id: cursorOn ? `entry:${cursorOn}` : "up", n: (f?.n ?? 0) + 1 }));
  };
  const toAdd = () => setFocus((f) => ({ id: "add", n: (f?.n ?? 0) + 1 }));
  const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) open(parent, path.basename(cwd));
  };
  const toggle = (full: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(full)) {
        next.delete(full);
        return next;
      }
      const item = measure(full, maxFiles);
      if (item) next.set(full, item);
      return next;
    });
  };

  const picked = [...selected.values()];
  const pickedSize = picked.reduce((sum, item) => sum + item.size, 0);
  const pickedFiles = picked.reduce((sum, item) => sum + item.count, 0);
  const here = spots.findIndex((p) => p.dir === cwd);
  const home = os.homedir();
  const shown = cwd === home ? "~" : cwd.startsWith(home + path.sep) ? `~${cwd.slice(home.length)}` : cwd;
  const wide = width >= 80;
  const nameWidth = Math.max(16, width - 8 - (wide ? 26 : 12));

  const rows: FormRow[] = [
    {
      kind: "button",
      id: "add",
      primary: true,
      disabled: picked.length === 0,
      label: picked.length === 0
        ? "Select files or folders below"
        : `Add ${pickedFiles === 1 ? "1 file" : `${pickedFiles} files`}, ${formatBytes(pickedSize)}`,
      onPress: () => onDone(picked),
    },
    {
      kind: "choice",
      id: "place",
      label: "Go to",
      value: here >= 0 ? spots[here]!.label : "this folder",
      onChange: (by) => {
        const next = spots[(here + (here < 0 && by < 0 ? 0 : by) + spots.length) % spots.length]!;
        open(next.dir);
        setFocus((f) => ({ id: "place", n: (f?.n ?? 0) + 1 }));
      },
    },
    { kind: "input", id: "filter", label: "Filter", value: filter, onChange: setFilter, placeholder: "type part of a name" },
    {
      kind: "choice",
      id: "hidden",
      label: "Hidden files",
      value: hidden ? "shown" : "not shown",
      onChange: () => setHidden((h) => !h),
    },
    { kind: "section", label: shown.length > width - 10 ? `…${shown.slice(shown.length - width + 11)}` : shown },
    {
      kind: "item",
      id: "up",
      pressHint: "up a folder",
      onPress: goUp,
      onLeft: goUp,
      render: () => <Muted>..  up a folder</Muted>,
    },
    ...entries.map((entry): FormRow => {
      const full = path.join(cwd, entry.name);
      const checked = selected.has(full);
      return {
        kind: "item",
        id: `entry:${entry.name}`,
        // Space selects, enter is done and goes up to the Add button. Before anything is
        // selected, enter opens a folder or takes the file it is on.
        ...(entry.folder
          ? {
              onPress: () => (selected.size > 0 ? toAdd() : open(full)),
              pressHint: selected.size > 0 ? "done" : "open",
              onRight: () => open(full),
              rightHint: "open",
              onToggle: () => toggle(full),
              toggleHint: checked ? "unselect" : "select all of it",
            }
          : {
              onPress: () => {
                if (selected.size === 0) toggle(full);
                toAdd();
              },
              pressHint: selected.size > 0 ? "done" : "take this file",
              onToggle: () => toggle(full),
              toggleHint: checked ? "unselect" : "select",
            }),
        onLeft: goUp,
        leftHint: "up",
        render: (focused) => (
          <Box>
            <Text color={checked ? accent : COLORS.faint}>{checked ? "[✓] " : "[ ] "}</Text>
            <Box width={nameWidth}>
              <Text color={COLORS.text} bold={focused} wrap="truncate-end">
                {forTerminal(entry.name)}{entry.folder ? "/" : ""}
              </Text>
            </Box>
            <Box width={12} justifyContent="flex-end">
              <Text color={COLORS.muted}>{entry.folder ? itemsIn(full) : formatBytes(entry.size)}</Text>
            </Box>
            {wide && (
              <Box width={12} justifyContent="flex-end">
                <Text color={COLORS.faint}>{shortDate(entry.changed)}</Text>
              </Box>
            )}
          </Box>
        ),
      };
    }),
    ...(entries.length === 0
      ? [{ kind: "note" as const, content: <Muted>{filter ? "Nothing here matches the filter." : "This folder is empty."}</Muted> }]
      : []),
  ];

  return (
    <Panel width={width}>
      <Box justifyContent="space-between">
        <T bold>  Pick files to send</T>
        {picked.length > 0 && <Text color={accent}>{picked.length} selected</Text>}
      </Box>
      <Form
        rows={rows}
        active={active}
        height={Math.max(6, height - 3)}
        onExit={onCancel}
        upExits={false}
        exitHint="cancel"
        labelWidth={14}
        {...(focus ? { focus } : { focus: { id: entries[0] ? `entry:${entries[0].name}` : "up", n: 0 } })}
      />
    </Panel>
  );
}
