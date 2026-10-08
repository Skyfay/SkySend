"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Script from "next/script";
import { z } from "zod";
import { AlertCircle, Check, CircleAlert, Loader2 } from "lucide-react";
import { InstancePicker } from "@/components/site/report/instance-picker";
import { fetchWithCache } from "@/lib/github";
import {
  getHostname,
  getLinkKind,
  hasAbuseSupport,
  REPORT_API_BASE,
  REPORT_INSTANCES_URL,
  REPORT_REASONS,
  parseReportInstances,
  ReportFormSchema,
  TURNSTILE_SITE_KEY,
  type ReportInstance,
} from "@/lib/report";
import { INSTANCES_DOCS_URL } from "@/lib/content";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

type InstancesState =
  | { status: "loading" }
  | { status: "ready"; instances: ReportInstance[] }
  | { status: "error" };

type SubmitState = "idle" | "submitting" | "error";

const CACHE_KEY = "skysend-report-instances";
const CACHE_TTL_MS = 5 * 60 * 1000;
/** How long sending may take before the form gives up and lets the reporter retry. */
const SEND_TIMEOUT_MS = 20000;

/** The body of a refused report, read only for its message. */
const WorkerErrorSchema = z.object({ error: z.string().max(300) });

const FIELD =
  "w-full rounded-[11px] border border-input bg-surface px-3.5 outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-tone-green/55 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--tone-green)_12%,transparent)]";

function Step({ n, done, children, aside }: { n: number; done: boolean; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
          done ? "bg-primary text-primary-foreground" : "bg-accent text-subtle"
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <span className="text-base font-semibold">{children}</span>
      {aside && <span className="ml-auto text-xs text-faint">{aside}</span>}
    </div>
  );
}

function Hint({ tone, children }: { tone: "ok" | "warn" | "bad" | "plain"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[13px] leading-snug",
        tone === "ok" && "text-tone-green",
        tone === "warn" && "text-tone-amber",
        tone === "bad" && "text-tone-red",
        tone === "plain" && "text-muted-foreground"
      )}
    >
      {tone === "ok" && <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.6} />}
      {(tone === "warn" || tone === "bad") && <CircleAlert className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

export function ReportForm() {
  const [instancesState, setInstancesState] = useState<InstancesState>({ status: "loading" });
  const [selectedHostname, setSelectedHostname] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [token, setToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ text: string; n: number } | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // The link as typed, for the instance list that may arrive after it was pasted.
  const urlRef = useRef("");
  const errorCount = useRef(0);

  /** Shows an error. The counter remounts the alert, so the same text is announced again. */
  function fail(text: string) {
    errorCount.current += 1;
    setFormError({ text, n: errorCount.current });
  }

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(CACHE_KEY, REPORT_INSTANCES_URL, CACHE_TTL_MS)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseReportInstances(raw);
        if (!parsed || parsed.length === 0) {
          setInstancesState({ status: "error" });
          return;
        }
        setInstancesState({ status: "ready", instances: parsed });
        // A link pasted before the list arrived picks its instance now.
        const hostname = getHostname(urlRef.current.trim());
        const match = parsed.find((inst) => getHostname(inst.url) === hostname);
        if (hostname && match && hasAbuseSupport(match)) setSelectedHostname(hostname);
      })
      .catch(() => {
        if (!cancelled) setInstancesState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const instances = useMemo(
    () => (instancesState.status === "ready" ? instancesState.instances : []),
    [instancesState]
  );
  const selectedInstance = useMemo(
    () => instances.find((inst) => getHostname(inst.url) === selectedHostname),
    [instances, selectedHostname]
  );
  const abuseSupported = hasAbuseSupport(selectedInstance);

  const linkHost = getHostname(url);
  const linkKind = getLinkKind(url);
  const linkInstance = instances.find((inst) => getHostname(inst.url) === linkHost);
  const linkOk =
    !!linkInstance && hasAbuseSupport(linkInstance) && (linkKind === "file" || linkKind === "note" || linkKind === "request");

  // The Turnstile widget container only enters the DOM after a reportable
  // instance is selected, well after Cloudflare's script has done its one-time
  // implicit auto-render scan. Explicit rendering (calling turnstile.render()
  // once the container exists) is the only reliable way to mount it then.
  useEffect(() => {
    if (!turnstileReady || !abuseSupported) return;
    const container = turnstileContainerRef.current;
    if (!container || !window.turnstile) return;

    const widgetId = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t) => {
        setTurnstileFailed(false);
        setToken(t);
      },
      "expired-callback": () => setToken(""),
      "error-callback": () => setTurnstileFailed(true),
    });
    widgetIdRef.current = widgetId;

    return () => {
      window.turnstile?.remove(widgetId);
      widgetIdRef.current = null;
      setToken("");
    };
  }, [turnstileReady, selectedHostname, abuseSupported]);

  function handleUrlChange(value: string) {
    setUrl(value);
    urlRef.current = value;
    const hostname = getHostname(value.trim());
    const match = instances.find((inst) => getHostname(inst.url) === hostname);
    if (match && hostname && hasAbuseSupport(match)) setSelectedHostname(hostname);
  }

  function toggleReason(reason: string) {
    setReasons((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitState("idle");

    const trimmedUrl = url.trim();
    if (!selectedHostname || !abuseSupported) {
      fail("Pick the instance the link belongs to.");
      return;
    }
    const kind = getLinkKind(trimmedUrl);
    if (kind === "inbox") {
      fail("Inbox links cannot be reported. Report the upload link of the request instead.");
      return;
    }
    if (getHostname(trimmedUrl) !== selectedHostname || (kind !== "file" && kind !== "note" && kind !== "request")) {
      fail("Paste a file, note or request link of the instance you picked.");
      return;
    }
    const parsed = ReportFormSchema.safeParse({
      url: trimmedUrl,
      reason: reasons,
      comment,
      replyEmail: replyEmail.trim() || null,
      token,
    });
    if (!parsed.success) {
      fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setSubmitState("submitting");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(REPORT_API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      if (!res.ok) {
        // A refusal names its reason, a retry would not change it.
        const body = WorkerErrorSchema.safeParse(await res.json().catch(() => null));
        if (res.status >= 400 && res.status < 500 && body.success) {
          if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
          setToken("");
          setSubmitState("idle");
          fail(`The report was refused: ${body.data.error}.`);
          return;
        }
        throw new Error("Server error");
      }
      setSentTo(selectedHostname);
      setSubmitState("idle");
      setUrl("");
      setReasons([]);
      setComment("");
      setReplyEmail("");
      setToken("");
      setSelectedHostname(null);
      urlRef.current = "";
    } catch {
      // The Worker may have used up the token before it failed, so the next try
      // needs a fresh one.
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      setToken("");
      setSubmitState("error");
    } finally {
      clearTimeout(timer);
    }
  }

  let linkHint: ReactNode = <Hint tone="plain">Paste the link as you got it, the part after the # included.</Hint>;
  if (url.trim() && !linkHost) linkHint = <Hint tone="bad">That does not look like a link.</Hint>;
  else if (linkKind === "inbox") {
    linkHint = (
      <Hint tone="bad">
        Inbox links cannot be reported. Their key would open everything sent to the request, report its upload link
        instead.
      </Hint>
    );
  } else if (linkHost && instancesState.status === "ready" && !linkInstance) {
    linkHint = <Hint tone="warn">{linkHost} is not a listed instance. Write to its operator directly.</Hint>;
  } else if (linkInstance && !hasAbuseSupport(linkInstance)) {
    linkHint = <Hint tone="warn">{linkHost} takes no reports here. Write to its operator, linked below.</Hint>;
  } else if (linkInstance && linkKind === "other") {
    linkHint = <Hint tone="warn">This is not a file, note or request link.</Hint>;
  } else if (linkOk) {
    linkHint = <Hint tone="ok">{`${linkKind === "request" ? "Request" : linkKind === "note" ? "Note" : "File"} link on ${linkHost}`}</Hint>;
  }

  return (
    <div className="relative rounded-[22px] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone-green)_55%,transparent),var(--border)_35%,var(--border)_70%,color-mix(in_srgb,var(--tone-red)_40%,transparent))] p-px shadow-[var(--deep-shadow)]">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={() => setTurnstileReady(true)}
        onError={() => setTurnstileFailed(true)}
      />
      <div className="overflow-hidden rounded-[21px] bg-card">
        {sentTo ? (
          <div className="fx-in flex flex-col items-center gap-4 px-6 py-14 text-center sm:px-10">
            <span className="flex size-16 items-center justify-center rounded-full bg-tone-green/16 text-tone-green shadow-[0_0_40px_rgb(70_200_157/0.35)]">
              <Check className="size-7" strokeWidth={2.4} />
            </span>
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">Report sent to {sentTo}</h2>
            <p className="max-w-[440px] leading-relaxed text-muted-foreground">
              Its abuse contact has the link and your reasons. Thank you for keeping the instances clean.
            </p>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="btn-chip mt-2 h-[42px] rounded-[10px] px-[18px] font-medium"
            >
              Report another link
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-[26px] p-5 sm:p-7">
            <div className="flex flex-col gap-2.5">
              <Step n={1} done={linkOk}>
                The link
              </Step>
              <label htmlFor="report-url" className="text-muted-foreground">
                The file, note or request link you want to report
              </label>
              <input
                id="report-url"
                aria-describedby="report-url-hint"
                aria-invalid={url.trim() !== "" && instancesState.status === "ready" && !linkOk}
                type="url"
                required
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://ch.skysend.app/file/2d6580e6#…"
                className={cn(FIELD, "h-12 font-mono text-[13px]")}
              />
              <div id="report-url-hint">{linkHint}</div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Step n={2} done={!!selectedInstance && abuseSupported} aside={linkOk && selectedHostname === linkHost ? "Picked from the link" : undefined}>
                The instance
              </Step>
              {instancesState.status === "loading" && (
                <div className="flex h-[60px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading the instances
                </div>
              )}
              {instancesState.status === "error" && (
                <Hint tone="bad">
                  The instances could not be loaded. Try again later, or find the operator in the{" "}
                  <a href={INSTANCES_DOCS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    list of instances
                  </a>
                  .
                </Hint>
              )}
              {instancesState.status === "ready" && (
                <InstancePicker instances={instances} selectedHostname={selectedHostname} onSelect={setSelectedHostname} />
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Step n={3} done={reasons.length > 0} aside="Pick one or more">
                What is wrong
              </Step>
              <div role="group" aria-label="Reasons" className="flex flex-wrap gap-2">
                {REPORT_REASONS.map((reason) => {
                  const on = reasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleReason(reason)}
                      className={cn(
                        "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                        on ? "border-tone-red/50 bg-tone-red/14 text-tone-red" : "btn-chip"
                      )}
                    >
                      {on && <Check className="size-3.5" strokeWidth={2.6} />}
                      {reason}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Step n={4} done={comment.trim().length >= 10} aside="At least 10 characters">
                <label htmlFor="report-details">Details</label>
              </Step>
              <textarea
                id="report-details"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What does the share contain, and where did you find the link?"
                className={cn(FIELD, "resize-none py-3 leading-relaxed")}
              />
            </div>

            <div className="flex flex-col gap-2.5">
              <Step n={5} done={false} aside="Optional">
                <label htmlFor="report-email">Your email</label>
              </Step>
              <input
                id="report-email"
                type="email"
                autoComplete="email"
                value={replyEmail}
                onChange={(e) => setReplyEmail(e.target.value)}
                placeholder="you@example.com"
                className={cn(FIELD, "h-[46px]")}
              />
              <Hint tone="plain">Only if the operator may write back to you.</Hint>
            </div>

            {abuseSupported && <div ref={turnstileContainerRef} className="min-h-[65px]" />}

            <div className="flex flex-col gap-2.5 border-t border-border pt-5">
              {turnstileFailed && (
                <p role="alert" className="flex items-start gap-2 text-[13px] text-tone-red">
                  <AlertCircle className="mt-px size-4 shrink-0" />
                  The spam check could not load. Allow challenges.cloudflare.com in your blocker or try again later.
                </p>
              )}
              {formError && (
                <p key={formError.n} role="alert" className="flex items-start gap-2 text-[13px] text-tone-red">
                  <AlertCircle className="mt-px size-4 shrink-0" />
                  {formError.text}
                </p>
              )}
              {submitState === "error" && (
                <p role="alert" className="flex items-start gap-2 text-[13px] text-tone-red">
                  <AlertCircle className="mt-px size-4 shrink-0" />
                  The report could not be sent. Try again in a moment.
                </p>
              )}
              <button
                type="submit"
                disabled={submitState === "submitting"}
                className="btn-primary flex min-h-[50px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-[15px] font-semibold disabled:opacity-60"
              >
                {submitState === "submitting" && <Loader2 className="size-4 animate-spin" />}
                {submitState === "submitting"
                  ? "Sending"
                  : selectedHostname && abuseSupported
                    ? `Send the report to ${selectedHostname}`
                    : "Send the report"}
              </button>
              <span className="text-center text-xs text-faint">The report goes to the abuse contact of that instance.</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
