import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FileText,
  KeyRound,
  Code,
  AlertCircle,
  Clock,
  Ban,
  FileQuestion,
  Flame,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { NoteContent } from "@/components/NoteContent";
import { Button } from "@/components/ui/button";
import { useNoteView } from "@/hooks/useNoteView";
import { formatTimeRemaining } from "@/lib/utils";

const CONTENT_TYPE_ICONS = {
  text: FileText,
  password: KeyRound,
  code: Code,
} as const;

export function NoteViewPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const noteHook = useNoteView();
  const [passwordInput, setPasswordInput] = useState<string | undefined>();

  const secret = window.location.hash.slice(1);

  useEffect(() => {
    if (id && secret) {
      noteHook.loadInfo(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id || !secret) {
    return (
      <ErrorDisplay
        icon={<FileQuestion className="h-8 w-8" />}
        title={t("noteView.notFound")}
      />
    );
  }

  if (noteHook.phase === "loading-info") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-32 w-full rounded-md" />
            <Skeleton className="h-4 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (noteHook.phase === "error" && !noteHook.info) {
    const error = noteHook.error ?? "";
    const isExpired = error.includes("expired");
    const isLimitReached = error.includes("limit") || error.includes("View");

    return (
      <ErrorDisplay
        icon={
          isExpired ? (
            <Clock className="h-8 w-8" />
          ) : isLimitReached ? (
            <Ban className="h-8 w-8" />
          ) : (
            <AlertCircle className="h-8 w-8" />
          )
        }
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
      noteHook.view(id, secret, pw);
    };

    return (
      <div className="space-y-6">
        <PageHeader contentType={noteHook.info?.contentType} />
        <Card>
          <CardContent className="space-y-6 pt-6">
            <PasswordPrompt
              onSubmit={handlePasswordSubmit}
              loading={noteHook.phase === "needs-password" && !!passwordInput}
              error={noteHook.error}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Awaiting user action to view (no password required)
  if (noteHook.phase === "idle" && noteHook.info) {
    const info = noteHook.info;
    const isBurnAfterReading = info.maxViews === 1;
    const isUnlimited = info.maxViews === 0;

    return (
      <div className="space-y-6">
        <PageHeader contentType={info.contentType} />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <span>
                  {isUnlimited
                    ? t("noteView.viewsUnlimited")
                    : t("noteView.viewsRemaining", {
                        remaining: info.maxViews - info.viewCount,
                        max: info.maxViews,
                      })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>
                  {t("noteView.expiresIn", {
                    time: formatTimeRemaining(info.expiresAt),
                  })}
                </span>
              </div>
            </div>

            {isBurnAfterReading && !isUnlimited && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                <Flame className="h-4 w-4 shrink-0" />
                <span>{t("noteView.burnWarning")}</span>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => noteHook.view(id, secret, passwordInput)}
            >
              {t("noteView.viewNote")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Content display (viewing or destroyed)
  if (
    (noteHook.phase === "viewing" || noteHook.phase === "destroyed") &&
    noteHook.content !== null &&
    noteHook.contentType !== null
  ) {
    return (
      <div className="space-y-6">
        <PageHeader contentType={noteHook.contentType} />
        <Card
          className={
            noteHook.phase === "destroyed"
              ? "border-destructive/30"
              : "border-primary/30 bg-primary/5"
          }
        >
          <CardContent className="space-y-4 pt-6">
            {/* View counter */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="h-4 w-4" />
              <span>
                {noteHook.maxViews === 0
                  ? t("noteView.viewCountUnlimited", { current: noteHook.viewCount })
                  : t("noteView.viewCount", {
                      current: noteHook.viewCount,
                      max: noteHook.maxViews,
                    })}
              </span>
            </div>

            {/* Destroyed warning */}
            {noteHook.phase === "destroyed" && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                <Flame className="h-4 w-4 shrink-0" />
                <span>{t("noteView.destroyed")}</span>
              </div>
            )}

            {/* Note content */}
            <NoteContent
              content={noteHook.content}
              contentType={noteHook.contentType}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Verifying password state
  if (noteHook.phase === "verifying-password") {
    return (
      <div className="space-y-6">
        <PageHeader contentType={noteHook.info?.contentType} />
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Skeleton className="h-4 w-4 rounded-full" />
            <span>{t("noteView.verifying")}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error with info loaded
  if (noteHook.phase === "error" && noteHook.info) {
    return (
      <div className="space-y-6">
        <PageHeader contentType={noteHook.info.contentType} />
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive-foreground">
              <AlertCircle className="h-5 w-5" />
              <span>{noteHook.error}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

function PageHeader({ contentType }: { contentType?: string | null }) {
  const { t } = useTranslation();
  const Icon =
    CONTENT_TYPE_ICONS[(contentType as keyof typeof CONTENT_TYPE_ICONS) ?? "text"] ?? FileText;

  return (
    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
      <Icon className="h-7 w-7 text-primary" />
      {t("noteView.title")}
    </h1>
  );
}

function ErrorDisplay({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-muted-foreground">
      {icon}
      <p className="text-lg font-medium">{title}</p>
    </div>
  );
}
