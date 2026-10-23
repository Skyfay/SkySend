import React, { useCallback, useRef, useState } from "react";
import { Text } from "ink";
import { formatBytes } from "../../lib/progress.js";
import { COLORS, useAccent } from "../theme.js";
import { Faint, Gap, Muted, T } from "./Frame.js";

export const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const SPARKS = "▁▂▃▄▅▆▇█";
/** How many speed samples the curve keeps, one every half second. */
const SAMPLES = 28;

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "7 s", "3 min 12 s", "1 h 4 min". */
export function seconds(value: number): string {
  if (value < 60) return `${Math.max(1, Math.round(value))} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
  return `${Math.floor(value / 3600)} h ${Math.round((value % 3600) / 60)} min`;
}

function sparkline(samples: number[]): string {
  const top = Math.max(...samples, 1);
  return samples.map((v) => SPARKS[Math.min(7, Math.floor((v / top) * 7.999))]).join("");
}

export interface Rate {
  /** One sample every half second, for the curve. */
  samples: number[];
  /** Bytes per second over the last three seconds, like the web shows it. */
  now: number;
}

/** Turns progress events into the speed of the last seconds and the samples of the curve. */
export function useRate(): { rate: Rate; track: (loaded: number) => void; reset: () => void } {
  const [rate, setRate] = useState<Rate>({ samples: [], now: 0 });
  const points = useRef<Array<[number, number]>>([]);
  const last = useRef<[number, number]>([0, 0]);

  const reset = useCallback(() => {
    const now = Date.now();
    points.current = [[now, 0]];
    last.current = [now, 0];
    setRate({ samples: [], now: 0 });
  }, []);

  const track = useCallback((loaded: number) => {
    const now = Date.now();
    const list = points.current;
    list.push([now, loaded]);
    while (list.length > 2 && now - list[0]![0] > 3000) list.shift();
    const [t0, b0] = list[0]!;
    const speed = now > t0 ? ((loaded - b0) * 1000) / (now - t0) : 0;
    const [lastTime, lastBytes] = last.current;
    if (now - lastTime >= 500) {
      const sample = ((loaded - lastBytes) * 1000) / (now - lastTime);
      last.current = [now, loaded];
      setRate((prev) => ({ samples: [...prev.samples, sample].slice(-SAMPLES), now: speed }));
    } else {
      setRate((prev) => ({ ...prev, now: speed }));
    }
  }, []);

  return { rate, track, reset };
}

interface TransferProgressProps {
  /** Share of the transfer done, 0 to 1. */
  ratio: number;
  /** What the amount line counts, the plaintext the user picked or receives. */
  done: number;
  total: number;
  rate: Rate;
  /** Columns the bar may take, its percentage included. */
  width: number;
  finishing?: boolean;
}

/** A bar across the card, the amount and the time left, and the curve of the speed. */
export function TransferProgress({ ratio, done, total, rate, width, finishing }: TransferProgressProps): React.ReactElement {
  const accent = useAccent();
  const barWidth = Math.max(10, width - 7);
  const filled = Math.round(Math.min(1, ratio) * barWidth);
  const left = rate.now > 0 ? ((1 - ratio) * total) / rate.now : 0;
  return (
    <>
      <Text>
        <Text color={accent}>{"━".repeat(filled)}</Text>
        <Text color={COLORS.line}>{"━".repeat(barWidth - filled)}</Text>
        <T bold>{`${Math.floor(Math.min(1, ratio) * 100)} %`.padStart(7)}</T>
      </Text>
      <Text>
        <T>{formatBytes(done)}</T>
        <Muted> of {formatBytes(total)}</Muted>
        {left > 0 && !finishing && (
          <>
            <Faint>   •   </Faint>
            <Muted>about </Muted>
            <T>{seconds(left)}</T>
            <Muted> left</Muted>
          </>
        )}
      </Text>
      <Gap />
      <Text>
        <Muted>speed  </Muted>
        <Text color={accent}>{sparkline(rate.samples.length ? rate.samples : [0])}</Text>
        <T>  {formatBytes(rate.now)}/s</T>
      </Text>
    </>
  );
}
