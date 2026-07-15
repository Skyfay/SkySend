/**
 * SkySend Report Worker
 *
 * Handles abuse reports for files/notes shared through any SkySend instance.
 * Looks up the reporting instance's abuse contact email from the public
 * instances registry and forwards the report via Cloudflare Email Routing.
 */

import { EmailMessage } from "cloudflare:email";

interface Env {
  REPORT_EMAIL: SendEmail;
  TURNSTILE_SECRET: string;
}

interface ReportBody {
  reason?: unknown;
  comment?: unknown;
  url?: unknown;
  token?: unknown;
  replyEmail?: unknown;
}

interface RegistryInstance {
  url: string;
  contact?: { abuse?: string | null };
}

const ALLOWED_ORIGINS = ["https://skysend.app", "https://www.skysend.app"];

const FROM_ADDRESS = "report@mail.skysend.app";
const INSTANCES_API = "https://docs.skysend.app/instances.json";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const reqUrl = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.startsWith("http://localhost");
    const allowedOrigin = isAllowed ? origin : "https://skysend.app";

    if (request.method === "OPTIONS") {
      return corsResponse(null, 204, allowedOrigin);
    }

    // GET /instances - proxy docs.skysend.app/instances.json with CORS headers
    if (request.method === "GET" && reqUrl.pathname === "/instances") {
      try {
        const res = await fetch(INSTANCES_API, {
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!res.ok) return corsResponse({ error: "Failed to fetch instances" }, 502, allowedOrigin);
        const data = await res.json();
        return corsResponse(data, 200, allowedOrigin);
      } catch {
        return corsResponse({ error: "Failed to fetch instances" }, 502, allowedOrigin);
      }
    }

    if (request.method !== "POST") {
      return corsResponse({ error: "Not found" }, 404, allowedOrigin);
    }

    let body: ReportBody;
    try {
      body = await request.json();
    } catch {
      return corsResponse({ error: "Invalid JSON" }, 400, allowedOrigin);
    }

    const { reason, comment, url, token, replyEmail } = body;

    // --- Turnstile validation ---
    if (!token || typeof token !== "string") {
      return corsResponse({ error: "Missing captcha token" }, 400, allowedOrigin);
    }

    const tsValid = await verifyTurnstile(token, request.headers.get("CF-Connecting-IP"), env.TURNSTILE_SECRET);
    if (!tsValid) {
      return corsResponse({ error: "Captcha verification failed" }, 403, allowedOrigin);
    }

    // --- Input validation ---
    if (!url || typeof url !== "string") {
      return corsResponse({ error: "Missing URL" }, 400, allowedOrigin);
    }

    let reportedUrl: URL;
    try {
      reportedUrl = new URL(url);
    } catch {
      return corsResponse({ error: "Invalid URL" }, 400, allowedOrigin);
    }

    if (!url.includes("/file/") && !url.includes("/note/")) {
      return corsResponse({ error: "URL must point to a file or note" }, 400, allowedOrigin);
    }

    if (!Array.isArray(reason) || reason.length === 0) {
      return corsResponse({ error: "At least one reason required" }, 400, allowedOrigin);
    }

    if (!comment || typeof comment !== "string" || comment.trim().length < 5) {
      return corsResponse({ error: "Comment too short" }, 400, allowedOrigin);
    }

    if (replyEmail && (typeof replyEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail))) {
      return corsResponse({ error: "Invalid reply email" }, 400, allowedOrigin);
    }

    // --- Lookup admin email from instances API ---
    // This also validates the instance is known (no hardcoded domain check needed)
    const instanceHost = reportedUrl.hostname;
    const adminEmail = await lookupInstanceEmail(instanceHost);

    if (!adminEmail) {
      return corsResponse({ error: "No contact email found for this instance" }, 404, allowedOrigin);
    }

    // --- Build and send email ---
    const subject = `[Abuse Report] ${instanceHost}`;
    const htmlBody = buildHtmlEmail({
      instanceHost,
      url,
      reasons: reason as string[],
      comment: comment.trim(),
      replyEmail: (replyEmail as string) || null,
    });

    const rawEmail = buildRawEmail({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject,
      htmlBody,
    });

    try {
      const message = new EmailMessage(FROM_ADDRESS, adminEmail, rawEmail);
      await env.REPORT_EMAIL.send(message);
    } catch (err) {
      console.error("Email send failed:", err);
      return corsResponse({ error: "Failed to send report" }, 500, allowedOrigin);
    }

    return corsResponse({ success: true }, 200, allowedOrigin);
  },
} satisfies ExportedHandler<Env>;

async function lookupInstanceEmail(hostname: string): Promise<string | null> {
  try {
    const res = await fetch(INSTANCES_API, {
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const instances = Array.isArray(data) ? (data as RegistryInstance[]) : [];
    const instance = instances.find((i) => {
      try {
        return new URL(i.url).hostname === hostname;
      } catch {
        return false;
      }
    });
    return instance?.contact?.abuse ?? null;
  } catch {
    return null;
  }
}

async function verifyTurnstile(token: string, ip: string | null, secret: string): Promise<boolean> {
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });

  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildHtmlEmail({
  instanceHost,
  url,
  reasons,
  comment,
  replyEmail,
}: {
  instanceHost: string;
  url: string;
  reasons: string[];
  comment: string;
  replyEmail: string | null;
}): string {
  const reasonsList = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  const commentHtml = escapeHtml(comment).replace(/\n/g, "<br>");
  const replyEmailBlock = replyEmail
    ? `  <div class="field">
    <div class="label">Reply-To (Reporter)</div>
    <div class="value"><a href="mailto:${escapeHtml(replyEmail)}">${escapeHtml(replyEmail)}</a></div>
  </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333; background: #f5f5f5; }
  .card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #46c89d, #34d399); padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; }
  .header h1 { color: #fff; margin: 0; font-size: 18px; }
  .field { margin-bottom: 14px; padding: 12px; background: #f9f9f9; border-radius: 6px; border-left: 4px solid #46c89d; }
  .label { font-weight: bold; color: #777; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .value { color: #222; font-size: 14px; word-break: break-all; }
  .value a { color: #46c89d; }
  ul { margin: 4px 0; padding-left: 18px; }
  .footer { margin-top: 20px; padding-top: 14px; border-top: 1px solid #eee; color: #aaa; font-size: 11px; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>Abuse Report - SkySend</h1>
  </div>
  <div class="field">
    <div class="label">Instance</div>
    <div class="value">${escapeHtml(instanceHost)}</div>
  </div>
  <div class="field">
    <div class="label">Reported URL</div>
    <div class="value"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></div>
  </div>
  <div class="field">
    <div class="label">Reasons</div>
    <div class="value"><ul>${reasonsList}</ul></div>
  </div>
  <div class="field">
    <div class="label">Details</div>
    <div class="value">${commentHtml}</div>
  </div>
  ${replyEmailBlock}
  <div class="footer">
    Sent via SkySend Report System - <a href="https://skysend.app/report/" style="color:#46c89d;">skysend.app/report</a>
  </div>
</div>
</body>
</html>`;
}

function buildRawEmail({
  from,
  to,
  subject,
  htmlBody,
}: {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
}): ReadableStream<Uint8Array> {
  const date = new Date().toUTCString();
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@mail.skysend.app>`;

  const raw = [
    `From: SkySend Report <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody,
  ].join("\r\n");

  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
}

function corsResponse(body: unknown, status: number, origin: string): Response {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://skysend.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}
