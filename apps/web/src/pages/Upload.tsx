import { useState, useEffect } from "react";
import { Link, Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { showKnownErrorToast } from "@/lib/toast";
import {
  ShieldCheck,
  Link2,
  Clock,
  Lock,
  X,
  FileIcon,
  FolderArchive,
  Layers,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Glow } from "@/components/Glow";
import { UploadZone } from "@/components/UploadZone";
import { UploadProgress } from "@/components/UploadProgress";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { ShareFooter } from "@/components/ShareFooter";
import { SignInRequired } from "@/components/SignInRequired";
import { DebugPanel } from "@/components/DebugPanel";
import { QuotaBar } from "@/components/QuotaBar";
import { NoteComposer } from "@/components/NoteComposer";
import { useUpload } from "@/hooks/useUpload";
import { useFaviconProgress } from "@/hooks/useFaviconProgress";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useAuth } from "@/hooks/useAuth";
import { fetchQuota, type QuotaStatus } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

type Tab = "file" | "note";

function Hero() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h1
        data-slot="hero-title"
        className="text-[34px] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[44px]"
      >
        {t("share.heroTitle")}{" "}
        <span data-slot="accent" className="text-primary-text">{t("share.heroAccent")}</span>
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {t("share.heroText")}{" "}
        <Link to="/how" className="font-medium text-primary-text hover:underline">
          {t("header.howItWorks")}
        </Link>
      </p>
    </div>
  );
}

function TrustRow() {
  const { t } = useTranslation();
  const items = [
    { icon: ShieldCheck, label: t("share.trustEncrypted") },
    { icon: Link2, label: t("share.trustKey") },
    { icon: Clock, label: t("share.trustDeleted") },
  ];
  return (
    <ul className="mt-7 flex flex-wrap justify-center gap-x-7 gap-y-2.5 text-[13px] text-muted-foreground">
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="inline-flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary-text" />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function UploadPage() {
  const { t } = useTranslation();
  const { config, loading: configLoading } = useServerConfig();
  const uploadHook = useUpload();
  const { isLoggedIn, loading: authLoading } = useAuth(config);

  useEffect(() => {
    if (uploadHook.phase === "error" && uploadHook.error) {
      const raw = uploadHook.error;
      if (raw === "fileNotReadable") {
        showKnownErrorToast(t("upload.fileNotReadable"));
      } else {
        showKnownErrorToast(t(`upload.${raw}`, { defaultValue: raw }));
      }
    }
  }, [uploadHook.phase, uploadHook.error, t]);

  const [activeTab, setActiveTab] = useState<Tab>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [expireSec, setExpireSec] = useState<number>(0);
  const [maxDownloads, setMaxDownloads] = useState<number>(0);
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  const quotaEnabled = config ? config.fileUploadQuotaBytes > 0 : false;

  // Determine available tabs based on enabled services
  const fileEnabled = config?.enabledServices.includes("file") ?? true;
  const noteEnabled = config?.enabledServices.includes("note") ?? true;
  const availableTabs: Tab[] = [...(fileEnabled ? ["file" as const] : []), ...(noteEnabled ? ["note" as const] : [])];
  // DEFAULT_TAB names a block type to open the note tab with that block already added.
  const defaultTab = config?.defaultTab ?? "file";
  const noteStart = defaultTab === "file" || defaultTab === "note" ? null : defaultTab;

  useEffect(() => {
    if (!quotaEnabled) return;
    fetchQuota()
      .then(setQuota)
      .catch(() => {});
  }, [quotaEnabled, quotaRefreshKey]);

  // Favicon progress during upload
  const isUploading =
    uploadHook.phase !== "idle" &&
    uploadHook.phase !== "done" &&
    uploadHook.phase !== "error";
  useFaviconProgress(isUploading ? uploadHook.progress : null);

  // Initialize defaults when config loads
  if (config && expireSec === 0) {
    setExpireSec(config.fileDefaultExpire);
    setMaxDownloads(config.fileDefaultDownload);
    // Set initial tab: use server default if available, else first available tab
    const preferredTab: Tab = defaultTab === "file" ? "file" : "note";
    const targetTab = availableTabs.includes(preferredTab) ? preferredTab : availableTabs[0]!;
    setActiveTab(targetTab);
    // Apply force-password for file uploads
    if (config.forceFilePassword) {
      setPasswordEnabled(true);
    }
  }

  // An instance that offers only file requests has nothing to share here.
  if (config && availableTabs.length === 0 && config.fileRequestsEnabled) {
    return <Navigate to="/requests" replace />;
  }

  if (configLoading || !config) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
          <Skeleton className="h-10 w-4/5 rounded-xl" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <Card className="mt-8 space-y-5 p-2">
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-[20px]" />
          <div className="space-y-3 px-3">
            <Skeleton className="h-8 w-3/4 rounded-full" />
            <Skeleton className="h-8 w-1/2 rounded-full" />
          </div>
          <Skeleton className="h-16 w-full rounded-2xl" />
        </Card>
      </div>
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const sizeExceeded = totalSize > config.fileMaxSize;
  const tooManyFiles = files.length > config.fileMaxFilesPerUpload;
  const quotaExceeded = quota?.enabled && totalSize > quota.remaining;
  const canUpload =
    files.length > 0 && !sizeExceeded && !tooManyFiles && !quotaExceeded && !isUploading;

  const handleUpload = () => {
    uploadHook.upload({
      files,
      maxDownloads,
      expireSec,
      password: passwordEnabled ? password : "",
    });
  };

  const handleNewUpload = () => {
    uploadHook.reset();
    setFiles([]);
    setPassword("");
    setPasswordEnabled(config.forceFilePassword);
    setQuotaRefreshKey((k) => k + 1);
  };

  const noteSignIn = config.oidcProtectNotes && !isLoggedIn && !authLoading;

  let body;
  if (uploadHook.phase === "done" && uploadHook.shareLink) {
    body = (
      <ShareLink link={uploadHook.shareLink} averageSpeed={uploadHook.averageSpeed} onNewUpload={handleNewUpload}>
        <DebugPanel uploadInfo={uploadHook.debugInfo} />
      </ShareLink>
    );
  } else if (isUploading) {
    const fileCount = files.length;
    const fileName = fileCount === 1 ? files[0]!.name : undefined;
    const Icon = fileCount > 1 ? FolderArchive : FileIcon;
    body = (
      <div className="space-y-5 p-3 sm:p-5">
        <div className="flex items-center gap-3 rounded-2xl bg-well p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {fileName ?? t("upload.selectedFiles", { count: fileCount })}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(totalSize)}</p>
          </div>
        </div>
        <UploadProgress phase={uploadHook.phase} progress={uploadHook.progress} speed={uploadHook.speed} />
        <DebugPanel uploadInfo={uploadHook.debugInfo} />
        <Button onClick={() => uploadHook.cancel()} variant="outline" className="w-full">
          <X />
          {t("upload.cancel")}
        </Button>
      </div>
    );
  } else {
    body = (
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        {availableTabs.length > 1 && (
          // A finished note shows its link in place of the form. The tabs hide with it.
          <TabsList variant="cards" aria-label={t("share.what")} className="group-has-[[data-share-done]]/composer:hidden">
            <TabsTrigger value="file">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <FileIcon />
                {t("tab.file")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("share.fileTabHint", { size: formatBytes(config.fileMaxSize) })}
              </span>
            </TabsTrigger>
            <TabsTrigger value="note">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Layers />
                {t("tab.note")}
              </span>
              <span className="text-xs text-muted-foreground">{t("share.noteTabHint")}</span>
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="file" className="space-y-5 px-1 pb-1 pt-3 sm:px-2">
          {/* OIDC auth block: shown when file uploads are protected and user is not logged in */}
          {config.oidcProtectFiles && !isLoggedIn && !authLoading ? (
            <SignInRequired />
          ) : (
            <>
              <QuotaBar quota={quota} />
              <UploadZone
                files={files}
                onFilesChange={setFiles}
                maxFiles={config.fileMaxFilesPerUpload}
                maxSize={config.fileMaxSize}
              />
              {sizeExceeded && (
                <p className="px-2 text-sm text-destructive-text" role="alert">
                  {t("upload.fileTooLarge", { size: formatBytes(config.fileMaxSize) })}
                </p>
              )}
              {tooManyFiles && (
                <p className="px-2 text-sm text-destructive-text" role="alert">
                  {t("upload.tooManyFiles", { count: config.fileMaxFilesPerUpload })}
                </p>
              )}
              {quotaExceeded && (
                <p className="px-2 text-sm text-destructive-text" role="alert">
                  {t("quota.fileTooLarge", { remaining: formatBytes(quota?.remaining ?? 0) })}
                </p>
              )}
              <div className="px-2 pt-1 sm:px-3">
                <ShareOptions
                  kind="file"
                  expireOptions={config.fileExpireOptions}
                  expireSec={expireSec}
                  onExpireChange={setExpireSec}
                  limitOptions={config.fileDownloadOptions}
                  limit={maxDownloads}
                  onLimitChange={setMaxDownloads}
                  passwordEnabled={passwordEnabled}
                  onPasswordEnabledChange={setPasswordEnabled}
                  password={password}
                  onPasswordChange={setPassword}
                  forcePassword={config.forceFilePassword}
                />
              </div>
              <ShareFooter
                kind="file"
                expireSec={expireSec}
                limit={maxDownloads}
                label={t("share.encryptUpload")}
                icon={<Lock />}
                disabled={!canUpload}
                onSubmit={handleUpload}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="note" className="px-1 pb-1 pt-3 sm:px-2">
          {noteSignIn ? <SignInRequired /> : <NoteComposer config={config} startWith={noteStart} />}
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Hero />
      <div className="relative mt-8">
        <Glow />
        <Card data-emphasis="main" className="group/composer relative p-2">
          {body}
        </Card>
      </div>
      <TrustRow />
    </div>
  );
}
