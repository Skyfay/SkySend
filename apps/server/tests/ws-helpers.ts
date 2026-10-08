import type { UpgradeWebSocket, WSContext, WSEvents, WSMessageReceive } from "hono/ws";

/**
 * Create a fake WSContext pair (ws + captured messages) compatible
 * enough with the route's code path.
 */
export function createFakeWs() {
  const sent: Array<string | Uint8Array> = [];
  let closeInfo: { code?: number; reason?: string } | null = null;

  const ws = {
    send: (data: string | ArrayBuffer | Uint8Array) => {
      if (typeof data === "string") {
        sent.push(data);
      } else if (data instanceof ArrayBuffer) {
        sent.push(new Uint8Array(data));
      } else {
        sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
    },
    close: (code?: number, reason?: string) => {
      if (closeInfo) return;
      closeInfo = { code, reason };
    },
    readyState: 1,
    binaryType: "arraybuffer" as BinaryType,
    url: null,
    protocol: null,
    raw: undefined,
  } as unknown as WSContext;

  return {
    ws,
    sent,
    get closed() {
      return closeInfo;
    },
    lastJson(): Record<string, unknown> | null {
      for (let i = sent.length - 1; i >= 0; i--) {
        const item = sent[i];
        if (typeof item === "string") {
          try {
            return JSON.parse(item);
          } catch {
            /* keep looking */
          }
        }
      }
      return null;
    },
    allJson(): Array<Record<string, unknown>> {
      const out: Array<Record<string, unknown>> = [];
      for (const item of sent) {
        if (typeof item === "string") {
          try {
            out.push(JSON.parse(item));
          } catch {
            /* skip */
          }
        }
      }
      return out;
    },
  };
}

/**
 * Build a message event compatible with the Hono WS helper.
 */
export function msgEvent(data: WSMessageReceive): MessageEvent<WSMessageReceive> {
  return { data } as unknown as MessageEvent<WSMessageReceive>;
}

/**
 * Install a mock upgradeWebSocket that captures the event handlers and
 * returns a no-op middleware.  The returned handlers are invoked manually
 * by the tests to exercise the protocol logic.
 */
export function createMockUpgrade(): {
  upgrade: UpgradeWebSocket;
  getEvents: () => WSEvents;
} {
  let events: WSEvents | null = null;
  const upgrade = ((createEvents: (c: unknown) => WSEvents | Promise<WSEvents>) => {
    return async (c: unknown, next: () => Promise<void>) => {
      const res = await createEvents(c);
      events = res;
      await next();
    };
  }) as unknown as UpgradeWebSocket;
  return {
    upgrade,
    getEvents: () => {
      if (!events) throw new Error("events not installed yet");
      return events;
    },
  };
}
