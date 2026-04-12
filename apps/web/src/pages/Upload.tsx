import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadZone } from "@/components/UploadZone";
import { ExpirySelector } from "@/components/ExpirySelector";
import { UploadProgress } from "@/components/UploadProgress";
import { ShareLink } from "@/components/ShareLink";
import { QuotaBar } from "@/components/QuotaBar";
import { useUpload } from "@/hooks/useUpload";
import { useFaviconProgress } from "@/hooks/useFaviconProgress";
import { useServerConfig } from "@/hooks/useServerConfig";
import { fetchQuota, type QuotaStatus } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

export function UploadPage() {
  const { t } = useTranslation();
  const { config, loading: configLoading } = useServerConfig();
  const uploadHook = useUpload();

  const [files, setFiles] = useState<File[]>([]);
  const [expireSec, setExpireSec] = useState<number>(0);
  const [maxDownloads, setMaxDownloads] = useState<number>(0);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  const quotaEnabled = config ? config.uploadQuotaBytes > 0 : false;

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
    setExpireSec(config.defaultExpire);
    setMaxDownloads(config.defaultDownload);
  }

  if (configLoading || !config) {
    return (
      <div className="space-y-6">
        {/* Title skeleton */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>

        {/* Card skeleton */}
        <Card>
          <CardContent className="space-y-6 pt-6">
            {/* Upload zone skeleton */}
            <Skeleton className="h-50 w-full rounded-lg" />

            {/* Expiry selectors skeleton */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </div>

            {/* Password toggle skeleton */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>

            {/* Upload button skeleton */}
            <Skeleton className="h-11 w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const sizeExceeded = totalSize > config.maxFileSize;
  const tooManyFiles = files.length > config.maxFilesPerUpload;
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
    setPasswordEnabled(false);
    setQuotaRefreshKey((k) => k + 1);
  };

  // Show share link when done
  if (uploadHook.phase === "done" && uploadHook.shareLink) {
    return <ShareLink link={uploadHook.shareLink} onNewUpload={handleNewUpload} />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Shield className="h-7 w-7 text-primary" />
          {t("upload.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("common.tagline")}</p>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {/* Quota bar */}
          <QuotaBar quota={quota} />

          {/* Drop zone / file selection */}
          <UploadZone
            files={files}
            onFilesChange={setFiles}
            maxFiles={config.maxFilesPerUpload}
            maxSize={config.maxFileSize}
            disabled={isUploading}
          />

          {/* Validation errors */}
          {sizeExceeded && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("upload.fileTooLarge", {
                size: formatBytes(config.maxFileSize),
              })}
            </p>
          )}
          {tooManyFiles && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("upload.tooManyFiles", { count: config.maxFilesPerUpload })}
            </p>
          )}
          {quotaExceeded && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t("quota.fileTooLarge", { remaining: formatBytes(quota?.remaining ?? 0) })}
            </p>
          )}

          {/* Expiry + Downloads */}
          <ExpirySelector
            expireOptions={config.expireOptions}
            downloadOptions={config.downloadOptions}
            expireSec={expireSec}
            maxDownloads={maxDownloads}
            onExpireChange={setExpireSec}
            onDownloadsChange={setMaxDownloads}
            disabled={isUploading}
          />

          {/* Password */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="password-toggle"
                className="flex items-center gap-2"
              >
                <Lock className="h-4 w-4" />
                {t("upload.password")}
              </Label>
              <Switch
                id="password-toggle"
                checked={passwordEnabled}
                onCheckedChange={setPasswordEnabled}
                disabled={isUploading}
              />
            </div>
            {passwordEnabled && (
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("upload.passwordPlaceholder")}
                  disabled={isUploading}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Progress */}
          {isUploading && (
            <UploadProgress
              phase={uploadHook.phase}
              progress={uploadHook.progress}
              speed={uploadHook.speed}
            />
          )}

          {/* Error */}
          {uploadHook.phase === "error" && uploadHook.error && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {t(`upload.${uploadHook.error}`, { defaultValue: uploadHook.error })}
            </p>
          )}

          {/* Upload button */}
          {!isUploading && (
            <Button
              onClick={handleUpload}
              disabled={!canUpload}
              className="w-full"
              size="lg"
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Shield className="mr-2 h-5 w-5" />
              )}
              {t("upload.uploading").replace("...", "")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
