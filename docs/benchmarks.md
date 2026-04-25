# Benchmarks

Real-world upload speed measurements across browsers and transport modes. All tests were performed with end-to-end encryption enabled (AES-256-GCM) - this is the actual throughput users experience.

::: info
These numbers reflect encrypted upload speed including client-side AES-256-GCM encryption overhead. Actual network utilization is slightly higher due to encryption expansion (~0.05%).
:::

## Test Environment

As we want to provide realistic benchmarks, we tested with Connection over Internet with non optimized network conditions. This was not a Lab environment with direct connection between client and server and not a data center environment. The server was hosted on a LXC Container (Proxmox) about 40km away from the client over public internet. The Client was Macos which has limited network performance compared to a Linux machine, but this is more realistic for the average user.

| Parameter | Value |
|---|---|
| **Server** | Linux, 4 Cores, 2GB Ram, NFS-Share, 10 Gbit/s network |
| **Client** | MacOS, 10 Gbit/s network |
| **Reverse Proxy** | Traefik v3 (TLS termination) |
| **Upload Speed Limit** | None (`FILE_UPLOAD_SPEED_LIMIT=0`) |
| **SkySend Version** | v2.5.1 |
| **File Size** | 2.6 GB, ZIP File |

## Results

Ø = average speed across the entire upload duration.

### Browser WebSocket Upload (Default)

Single persistent connection. No parallel requests needed.

| Browser | Speed |
|---|---|
| Firefox | Ø 204.6 MB/s |
| Safari | Ø 192.8 MB/s |
| Google Chrome | Ø 175.1 MB/s |
| Microsoft Edge | Ø 192.4 MB/s |
| Brave | Ø 165.9 MB/s |

### Browser HTTP Chunked Upload (Fallback)

Parallel 10 MB chunks over multiple HTTP/2 connections.

| Browser | Speed |
|---|---|
| Firefox | Ø 226.7 MB/s |
| Safari | Ø 182.9 MB/s |
| Google Chrome | Ø 61.7 MB/s |
| Microsoft Edge | Ø 99.4 MB/s |
| Brave | Ø 54.0 MB/s |

### Client CLI (MacOS)

| Client Mode | Speed |
|---|---|
| WebSocket | Ø 350 MB/s |
| HTTP Chunked | Ø 70 MB/s |

## Key Takeaways

- **WebSocket provides the most consistent speeds across browsers.** The spread between fastest and slowest is much smaller (175 - 200 MB/s for major browsers) compared to HTTP (70 - 210 MB/s).
- **HTTP is faster on Firefox and Safari** because these browsers have highly optimized HTTP/2 stacks that can saturate the network with parallel chunk uploads. Their WebSocket binary throughput is slightly lower.
- **Chromium-based browsers benefit significantly from WebSocket.** Chrome goes from ~70 MB/s (HTTP) to ~170 MB/s (WS) - a 2.4x improvement. Edge improves from a variable 90 - 200 MB/s to a consistent ~185 MB/s.
- **Brave is slower across both transports** due to Brave Shields adding overhead to network requests.

## Why WebSocket is the Default

WebSocket is enabled by default because:

1. **Consistency** - All major browsers achieve 100+ MB/s through a reverse proxy
2. **Simplicity** - Single connection, no chunk coordination overhead
3. **Chromium dominance** - Chrome and Edge represent ~75% of browser traffic and benefit the most from WebSocket
4. **Automatic fallback** - If the WebSocket handshake fails (proxy blocks it, server disabled it), the client automatically falls back to HTTP chunked upload

To disable WebSocket and force HTTP chunked upload, set `FILE_UPLOAD_WS=false`.

## Your Own Benchmarks

Upload speeds depend heavily on:

- **Network bandwidth** between client and server
- **Reverse proxy** configuration and TLS implementation
- **CPU speed** on both client (encryption) and server (I/O)
- **Storage backend** (local SSD vs. S3-compatible)

The numbers above represent a best-case scenario in real world conditions. Your results will vary.