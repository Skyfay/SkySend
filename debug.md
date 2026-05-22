# Feature Request: In-App Debug Info Panel

## Motivation

Das primäre Debugging-Tool für Download- und Upload-Probleme ist aktuell der Browser DevTools. Das ist problematisch, weil:

- **Firefox + DevTools** verursachen genau das Problem das man debuggen möchte: DevTools async-task-tracking saturiert den SW-Event-Loop und lässt Downloads hängen.
- **Normale User** können mit DevTools-Output nichts anfangen und müssen Screenshots von kryptischen Console-Logs schicken.
- Es gibt keine in-app Möglichkeit zu sehen, welcher Download- oder Upload-Pfad tatsächlich genutzt wird.

Ein kleines, immer zugängliches Info-Panel direkt in der UI löst alle drei Probleme.

## Proposed UI

Ein kleiner `(i)`-Button neben dem Download- bzw. Upload-Fortschrittsanzeige, der eine Klappe aufklappt:

```
┌─────────────────────────────────────┐
│  Technical Info                   ✕ │
├─────────────────────────────────────┤
│  Download                           │
│  ─────────────────────────────────  │
│  Tier:      SW Stream               │
│  SW-Path:   ReadableStream          │
│  Browser:   Firefox 127             │
│  DevTools:  not detected            │
│  File size: 245 MB                  │
├─────────────────────────────────────┤
│  Upload                             │
│  ─────────────────────────────────  │
│  Transport: WebSocket               │
│  Fallback:  –                       │
│  Browser:   Chrome 124              │
└─────────────────────────────────────┘
```

## Download Info Fields

| Feld | Werte | Quelle |
|------|-------|--------|
| Tier | `SW Stream` / `Save File Picker` / `Blob` | `useDownload.ts` - expliziter Code-Pfad |
| SW-Path | `Worker (Chrome)` / `ReadableStream (Fallback)` | neues `dl-tier` BroadcastChannel-Message aus `download-sw.js` |
| Browser | `Firefox 127` / `Chrome 124` / `Safari 17.4` / ... | `navigator.userAgent` |
| DevTools | `detected (docked)` / `not detected` | `isFirefoxDevToolsOpen()` aus `utils.ts` |
| File size | `245 MB` | aus `UploadInfo.size` |

## Upload Info Fields

| Feld | Werte | Quelle |
|------|-------|--------|
| Transport | `WebSocket` / `HTTP Chunks` | neues `transport` Worker-Message aus `upload-worker.ts` |
| Fallback | `WS failed → HTTP` / `–` | ob WS-Handshake gefailed ist vor HTTP-Fallback |
| Browser | s.o. | `navigator.userAgent` |

## What Already Exists

Nahezu alle Daten sind bereits im Runtime vorhanden - sie werden nur nicht ans UI weitergeleitet:

- `isFirefox()`, `isSafari()`, `isFirefoxDevToolsOpen()` - vorhanden in `apps/web/src/lib/utils.ts`
- `SAFARI_BIG_SIZE`, `FIREFOX_DEVTOOLS_BIG_SIZE` - vorhanden in `apps/web/src/lib/utils.ts`
- Download-Tier-Logik - vorhanden in `apps/web/src/hooks/useDownload.ts`
- Upload-Transport-Entscheidung - vorhanden in `apps/web/src/lib/upload-worker.ts` (loggt nur `console.info`)
- SW-Pfad-Entscheidung (`new Worker()` try/catch) - vorhanden in `apps/web/public/download-sw.js`
- BroadcastChannel `skysend-dl` - bereits aktiv für dl-progress/dl-done/dl-error

## What Needs to Be Implemented

### 1. `apps/web/public/download-sw.js`

Am Anfang von `handleDownload()`, nachdem der Pfad entschieden ist, eine neue Message senden:

```js
// Worker-Pfad:
bc.postMessage({ type: "dl-tier", downloadId, swPath: "worker" });

// ReadableStream-Pfad (catch-Block):
bc.postMessage({ type: "dl-tier", downloadId, swPath: "stream" });
```

### 2. `apps/web/src/lib/upload-worker.ts`

Wenn die Transport-Entscheidung fällt (die `console.info` Zeilen sind genau dort), eine Message posten:

```ts
// Statt nur console.info:
post({ type: "transport", transport: "ws" });
// bzw.
post({ type: "transport", transport: "http", fallback: wsAttempted });
```

Das `UploadWorkerMessage`-Type-Union muss um `{ type: "transport", transport: "ws" | "http", fallback?: boolean }` erweitert werden.

### 3. `apps/web/src/hooks/useDownload.ts`

- `DownloadState` um `debugInfo: DownloadDebugInfo | null` erweitern
- In `streamDownloadViaSw()` (via BroadcastChannel) das `dl-tier` Message abhören und in State speichern
- Download-Tier (`"sw"` / `"file-picker"` / `"blob"`) beim jeweiligen Code-Pfad setzen

### 4. `apps/web/src/hooks/useUpload.ts`

- `UploadState` um `debugInfo: UploadDebugInfo | null` erweitern
- Im `worker.onmessage`-Handler den `transport`-Message-Typ behandeln

### 5. Neues `apps/web/src/components/DebugPanel.tsx`

- Kleines, kollabiertes Panel mit `(i)`-Button zum Öffnen
- Zeigt Download- und/oder Upload-Debug-Info je nach Kontext
- Nur angezeigt wenn `debugInfo !== null` (d.h. nach Start einer Operation)

### 6. Einbinden in `apps/web/src/pages/Download.tsx` und `Upload.tsx`

Den `<DebugPanel>` unterhalb des Fortschrittsbalkens platzieren.

## Always Accurate?

Ja - alle Werte stammen aus den tatsächlichen Runtime-Entscheidungen, nicht aus Heuristiken:

- Der SW sendet `dl-tier` erst *nachdem* er weiss, welchen Pfad er nimmt.
- `upload-worker.ts` postet `transport` erst *nachdem* der WebSocket-Handshake entweder erfolgreich war oder gefailed ist.
- Download-Tier wird in `useDownload.ts` direkt an der Stelle gesetzt, wo der Tier-Wechsel passiert.

Fallbacks werden korrekt angezeigt: wenn WS failed und HTTP genutzt wird, zeigt das Panel `Transport: HTTP Chunks (WS failed)`.

## Browser Support

Vollständig - das Panel ist reines React/HTML. Es gibt keine API-Abhängigkeiten.

## Open Questions

- Soll das Panel immer sichtbar sein oder nur über einen URL-Parameter (`?debug=1`) aktivierbar?
- Soll es einen "Copy to clipboard"-Button geben, damit User den Debug-Output bei Bug-Reports einfach kopieren können?
- Sollen historische Fallback-Events angezeigt werden (z.B. "WS tried at 14:03:21, failed after 3.2s")?
