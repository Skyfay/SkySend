"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstancePicker } from "@/components/site/report/instance-picker";
import {
  getHostname,
  hasAbuseSupport,
  REPORT_API_BASE,
  REPORT_INSTANCES_URL,
  REPORT_REASONS,
  ReportInstancesResponseSchema,
  TURNSTILE_SITE_KEY,
  type ReportInstance,
} from "@/lib/report";

declare global {
  interface Window {
    onSkySendTurnstileVerify?: (token: string) => void;
    onSkySendTurnstileExpire?: () => void;
  }
}

type InstancesState =
  | { status: "loading" }
  | { status: "ready"; instances: ReportInstance[] }
  | { status: "error" };

type SubmitState = "idle" | "submitting" | "success" | "error";

export function ReportForm() {
  const [instancesState, setInstancesState] = useState<InstancesState>({ status: "loading" });
  const [selectedHostname, setSelectedHostname] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [token, setToken] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(REPORT_INSTANCES_URL)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const parsed = ReportInstancesResponseSchema.safeParse(data);
        setInstancesState(
          parsed.success ? { status: "ready", instances: parsed.data } : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setInstancesState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.onSkySendTurnstileVerify = (t: string) => setToken(t);
    window.onSkySendTurnstileExpire = () => setToken("");
    return () => {
      window.onSkySendTurnstileVerify = undefined;
      window.onSkySendTurnstileExpire = undefined;
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

  function handleUrlChange(value: string) {
    setUrl(value);
    const hostname = getHostname(value);
    if (hostname && instances.some((inst) => getHostname(inst.url) === hostname)) {
      setSelectedHostname(hostname);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!selectedHostname) {
      setFormError("Select the instance this link belongs to.");
      return;
    }
    if (reasons.length === 0) {
      setFormError("Select at least one reason.");
      return;
    }
    if (!token) {
      setFormError("Please complete the captcha.");
      return;
    }
    const reportedHostname = getHostname(url);
    const isKnownInstance = reportedHostname === selectedHostname;
    if (!isKnownInstance || (!url.includes("/file/") && !url.includes("/note/"))) {
      setFormError("Enter a valid SkySend file or note link that matches the selected instance.");
      return;
    }
    if (comment.trim().length < 10) {
      setFormError("Please provide at least 10 characters of detail.");
      return;
    }

    setSubmitState("submitting");
    try {
      const res = await fetch(REPORT_API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reasons,
          comment,
          url,
          token,
          replyEmail: replyEmail.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Server error");
      setSubmitState("success");
      setUrl("");
      setReasons([]);
      setComment("");
      setReplyEmail("");
      setToken("");
      setSelectedHostname(null);
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-8">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <h3 className="text-lg font-bold">
            SkySend Link <span className="text-destructive">*</span>
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            The SkySend link you want to report:
          </p>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://ch.skysend.app/file/2d6580e6-1811-467c-a90f-a22915ef6836#..."
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <h3 className="text-lg font-bold">
            Instance <span className="text-destructive">*</span>
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Select the instance the file or note is hosted on:
          </p>

          {instancesState.status === "loading" && (
            <div className="space-y-2">
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
            </div>
          )}
          {instancesState.status === "error" && (
            <p className="text-sm text-destructive">Instances could not be loaded.</p>
          )}
          {instancesState.status === "ready" && (
            <InstancePicker
              instances={instances}
              selectedHostname={selectedHostname}
              onSelect={setSelectedHostname}
            />
          )}

          {selectedInstance && !abuseSupported && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertCircle className="size-4 shrink-0" />
                This instance doesn&apos;t use SkySend&apos;s report system. Please contact the
                operator directly:
              </p>
              <a
                href={selectedInstance.contact?.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
              >
                <ExternalLink className="size-3.5" />
                {selectedInstance.contact?.label || "Contact operator"}
              </a>
            </div>
          )}
        </div>

        {selectedInstance && abuseSupported && (
          <>
            <div>
              <h3 className="text-lg font-bold">
                Reason <span className="text-destructive">*</span>
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">Select everything that applies:</p>
              <div className="space-y-3">
                {REPORT_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-muted/50 p-3 transition-colors hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={reasons.includes(reason)}
                      onChange={(e) =>
                        setReasons((prev) =>
                          e.target.checked ? [...prev, reason] : prev.filter((r) => r !== reason)
                        )
                      }
                      className="size-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm">{reason}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold">
                Additional Details <span className="text-destructive">*</span>
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">
                Provide as much detail as possible:
              </p>
              <textarea
                required
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe the incident in as much detail as possible..."
                className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
              />
              <div className="mt-1 flex justify-end text-xs text-muted-foreground">
                <span className={comment.trim().length >= 10 ? "text-primary" : undefined}>
                  {comment.trim().length}
                </span>
                &nbsp;/ 10 min.
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold">Your Email (optional)</h3>
              <p className="mb-3 text-sm text-muted-foreground">
                If you&apos;d like to receive a reply:
              </p>
              <input
                type="email"
                value={replyEmail}
                onChange={(e) => setReplyEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
              />
            </div>

            <div
              className="cf-turnstile"
              data-sitekey={TURNSTILE_SITE_KEY}
              data-callback="onSkySendTurnstileVerify"
              data-expired-callback="onSkySendTurnstileExpire"
            />

            {formError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {formError}
              </p>
            )}

            {submitState === "success" && (
              <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
                <CheckCircle2 className="size-4 shrink-0" />
                Thank you! Your report has been sent.
              </p>
            )}
            {submitState === "error" && (
              <p className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                Something went wrong. Please try again later.
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={submitState === "submitting"}>
              {submitState === "submitting" ? "Sending..." : "Send Report"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
