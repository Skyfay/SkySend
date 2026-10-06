import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { showKnownErrorToast, showRewrittenLinkWarning } from "@/lib/toast";
import { wasShareLinkRewritten } from "@/lib/rewritten-link";
import {
  FileText,
  KeyRound,
  Code,
  Terminal,
  AlertCircle,
  Clock,
  Ban,
  FileQuestion,
  Flame,
  Eye,
  Loader2,
  Lock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ReceiveShell } from "@/components/ReceiveShell";
import { LinkGone } from "@/components/LinkGone";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { NoteContent } from "@/components/NoteContent";
import { useNoteView } from "@/hooks/useNoteView";
import { hashWasmArgon2 } from "@/lib/argon2";
import { formatTimeRemaining } from "@/lib/utils";

const CONTENT_TYPE_ICONS = {
  text: FileText,
  markdown: FileText,
  password: KeyRound,
  code: Code,
  sshkey: Terminal,
} as const;

type KnownType = keyof typeof CONTENT_TYPE_ICONS;

function isKnownType(type: string | null | undefined): type is KnownType {
  return !!type && type in CONTENT_TYPE_ICONS;
}

/** The icon tile and type name above a note, like "Code" or "SSH Key". */
function NoteType({ contentType, children }: { contentType?: string | null; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const Icon = isKnownType(contentType) ? CONTENT_TYPE_ICONS[contentType] : FileText;
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold tracking-tight">
          {isKnownType(contentType) ? t(`tab.${contentType}`) : t("noteView.title")}
        </p>
        <p className="text-xs text-muted-foreground">{t("noteView.title")}</p>
      </div>
      {children}
    </div>
  );
}

export function NoteViewPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const noteHook = useNoteView();
  const [passwordInput, setPasswordInput] = useState<string | undefined>();

  // T-2: Capture the secret from the URL fragment once at mount so that clearing
  // the hash via history.replaceState does not reset the value on the next re-render.
  const [secret] = useState<string>(() => window.location.hash.slice(1));

  useEffect(() => {
    // Remove the key fragment from the URL immediately to reduce exposure in
    // browser history, screenshots, and browser extensions.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (id && secret) {
      noteHook.loadInfo(id);
    }
    // A rewritten link means the key reached the server in the request path.
    if (wasShareLinkRewritten()) {
      showRewrittenLinkWarning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show transient errors (e.g. decryption failure) as a toast instead of inline.
  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.info && noteHook.error) {
      showKnownErrorToast(noteHook.error);
    }
  }, [noteHook.phase, noteHook.info, noteHook.error]);

  const title = (
    <Trans
      i18nKey="share.receivedNote"
      components={{ a: <span data-slot="accent" className="text-primary-text" /> }}
    />
  );

  if (!id || !secret) {
    return <LinkGone icon={FileQuestion} title={t("noteView.notFound")} />;
  }

  if (noteHook.phase === "loading-info") {
    return (
      <ReceiveShell title={title}>
        <div className="space-y-4" aria-busy="true">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </ReceiveShell>
    );
  }

  if (noteHook.phase === "error" && !noteHook.info) {
    const error = noteHook.error ?? "";
    const isExpired = error.includes("expired");
    const isLimitReached = error.includes("limit") || error.includes("View");

    return (
      <LinkGone
        icon={isExpired ? Clock : isLimitReached ? Ban : AlertCircle}
        title={
          isExpired
            ? t("noteView.expired")
            : isLimitReached
              ? t("noteView.limitReached")
              : error.includes("not found")
                ? t("noteView.notFound")
                : error
        }
      />
    );
  }

  // Password prompt
  if (noteHook.phase === "needs-password") {
    const handlePasswordSubmit = (pw: string) => {
      setPasswordInput(pw);
      noteHook.view(id, secret, pw, hashWasmArgon2);
    };

    return (
      <ReceiveShell title={title}>
        <PasswordPrompt onSubmit={handlePasswordSubmit} loading={false} error={noteHook.error} />
      </ReceiveShell>
    );
  }

  // Awaiting user action to view (no password required)
  if (noteHook.phase === "idle" && noteHook.info) {
    const info = noteHook.info;
    const isBurnAfterReading = info.maxViews === 1;
    const isUnlimited = info.maxViews === 0;
    const stats = [
      {
        icon: Eye,
        label: isUnlimited
          ? t("noteView.viewsUnlimited")
          : t("noteView.viewsRemaining", {
              remaining: info.maxViews - info.viewCount,
              max: info.maxViews,
            }),
      },
      { icon: Clock, label: t("noteView.expiresIn", { time: formatTimeRemaining(info.expiresAt) }) },
    ];

    return (
      <ReceiveShell title={title}>
        <div className="space-y-4">
          <NoteType contentType={info.contentType} />

          <ul className="grid gap-2 sm:grid-cols-2">
            {stats.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 rounded-2xl bg-well px-3.5 py-3 text-[13px]">
                <Icon className="h-4 w-4 shrink-0 text-primary-text" />
                {label}
              </li>
            ))}
          </ul>

          {isBurnAfterReading && !isUnlimited && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-destructive-soft p-3.5 text-sm text-destructive-text">
              <Flame className="h-4 w-4 shrink-0" />
              <span>{t("noteView.burnWarning")}</span>
            </div>
          )}

          <div className="space-y-3">
            <Button
              size="lg"
              className="w-full"
              onClick={() => noteHook.view(id, secret, passwordInput, hashWasmArgon2)}
            >
              <Eye />
              {t("noteView.viewNote")}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              {t("share.decryptHint")}
            </p>
          </div>
        </div>
      </ReceiveShell>
    );
  }

  // Content display (viewing or destroyed)
  if (
    (noteHook.phase === "viewing" || noteHook.phase === "destroyed") &&
    noteHook.content !== null &&
    noteHook.contentType !== null
  ) {
    return (
      <ReceiveShell title={title} wide>
        <div className="space-y-4">
          <NoteType contentType={noteHook.contentType}>
            <span className="shrink-0 rounded-full bg-well px-3 py-1 text-xs text-muted-foreground">
              {noteHook.maxViews === 0
                ? t("noteView.viewCountUnlimited", { current: noteHook.viewCount })
                : t("noteView.viewCount", {
                    current: noteHook.viewCount,
                    max: noteHook.maxViews,
                  })}
            </span>
          </NoteType>

          {noteHook.phase === "destroyed" && (
            <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-destructive-soft p-3.5 text-sm text-destructive-text">
              <Flame className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("noteView.destroyed")}</span>
            </div>
          )}

          <NoteContent content={noteHook.content} contentType={noteHook.contentType} />
        </div>
      </ReceiveShell>
    );
  }

  // Verifying password state
  if (noteHook.phase === "verifying-password") {
    return (
      <ReceiveShell title={title}>
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-primary-text" />
          <span>{t("noteView.verifying")}</span>
        </div>
      </ReceiveShell>
    );
  }

  return null;
}
