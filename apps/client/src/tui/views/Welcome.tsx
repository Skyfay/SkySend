import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { trimTrailingSlashes } from "@skysend/transfer";
import { getServers } from "../../lib/config.js";
import { fetchPublicInstances, type PublicInstance } from "../../lib/instances.js";
import { formatBytes } from "../../lib/progress.js";
import { forTerminal } from "../../lib/terminal.js";
import { COLORS, useAccent } from "../theme.js";
import { Faint, Gap, Muted, Panel, T } from "../components/Frame.js";
import { Form, type FormRow } from "../components/Form.js";

interface WelcomeViewProps {
  width: number;
  height: number;
  onConnect: (url: string) => void;
  /** Why the last connection failed. */
  error?: string | null;
  /** The server that failed to connect, so the user can correct it. */
  initialUrl?: string;
}

const LOGO = ["█▀ █▄▀ █▄█ █▀ █▀▀ █▄ █ █▀▄", "▄█ █ █  █  ▄█ ██▄ █ ▀█ █▄▀"];

/** Accepts what people paste: a bare host gets https://, the result has to be a web address. */
function serverUrl(input: string): string | null {
  const trimmed = trimTrailingSlashes(input.trim());
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The first start, or after "Switch server": pick a saved, a public or your own server. */
export function WelcomeView({ width, height, onConnect, error, initialUrl }: WelcomeViewProps): React.ReactElement {
  const accent = useAccent();
  const saved = useMemo(() => getServers(), []);
  const [instances, setInstances] = useState<PublicInstance[] | null>(null);
  const [own, setOwn] = useState(() =>
    initialUrl && !saved.some((s) => s.url === initialUrl) ? initialUrl : "",
  );
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchPublicInstances().then((list) => {
      if (live) setInstances(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const known = new Set(saved.map((s) => s.url));
  const publics = (instances ?? []).filter((i) => !known.has(trimTrailingSlashes(i.url)));
  const wide = width >= 90;

  const rows: FormRow[] = [];
  if (saved.length > 0) {
    rows.push({ kind: "section", label: "Your servers" });
    for (const s of saved) {
      rows.push({
        kind: "item",
        id: `saved:${s.url}`,
        pressHint: "connect",
        onPress: () => onConnect(s.url),
        render: (focused) => (
          <Text wrap="truncate-end">
            <Text color={COLORS.text} bold={focused}>{forTerminal(s.name)}</Text>
            <Text color={COLORS.muted}>   {forTerminal(s.url)}</Text>
          </Text>
        ),
      });
    }
  }
  rows.push({ kind: "section", label: "Public servers" });
  if (instances === null) rows.push({ kind: "note", content: <Faint>Loading the list from instances.skysend.app…</Faint> });
  else if (publics.length === 0) rows.push({ kind: "note", content: <Faint>The list of public servers could not be loaded.</Faint> });
  for (const i of publics) {
    const limits = [
      i.fileMaxSize ? `${formatBytes(i.fileMaxSize)} a file` : null,
      i.fileUploadQuotaBytes ? `${formatBytes(i.fileUploadQuotaBytes)} a day` : "no daily limit",
    ].filter(Boolean).join(", ");
    rows.push({
      kind: "item",
      id: `public:${i.url}`,
      pressHint: "connect",
      onPress: () => onConnect(trimTrailingSlashes(i.url)),
      render: (focused) => (
        <Box>
          <Box width={26}><Text color={COLORS.text} bold={focused} wrap="truncate-end">{forTerminal(i.name)}</Text></Box>
          {wide && <Box width={14}><Text color={COLORS.muted} wrap="truncate-end">{forTerminal(i.country ?? "")}</Text></Box>}
          {wide && <Text color={COLORS.muted} wrap="truncate-end">{limits}</Text>}
        </Box>
      ),
    });
  }
  rows.push({ kind: "section", label: "Your own server" });
  rows.push({
    kind: "input",
    id: "own",
    label: "Address",
    value: own,
    onChange: (value) => {
      setOwn(value);
      setProblem(null);
    },
    placeholder: "https://send.example.com",
    submitHint: "connect",
    onSubmit: () => {
      const url = serverUrl(own);
      if (url) onConnect(url);
      else setProblem("That is not a web address. It looks like https://send.example.com");
    },
  });

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" paddingX={2}>
        {LOGO.map((l) => (
          <Text key={l} color={accent} bold>{l}</Text>
        ))}
        <Gap />
        <T>Share files and notes, end-to-end encrypted.</T>
        <Muted>Pick a server to start. Your files are encrypted before they leave this computer.</Muted>
        <Gap />
      </Box>
      <Panel width={width}>
        <Gap />
        {(error || problem) && <Text color={COLORS.danger}>  {forTerminal(problem ?? error ?? "")}</Text>}
        <Form
          rows={rows}
          active
          focus={own ? { id: "own", n: 1 } : undefined}
          height={Math.max(6, height - 9)}
          labelWidth={10}
        />
        <Gap />
      </Panel>
    </Box>
  );
}
