import { useCallback, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, FolderOpen, Plus, Upload, X } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { fileBadge } from "@/lib/file-badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  maxFiles: number;
  maxSize: number;
  disabled?: boolean;
}

/** Three file cards that fan out on hover, with the upload arrow in the accent. */
function FileFan() {
  const card = "absolute top-2.5 h-[72px] w-14 rounded-[10px] border border-border bg-card shadow-chip transition-transform duration-300 motion-reduce:transition-none";
  const line = "absolute left-2 h-1 rounded-full bg-input";
  const label = "absolute bottom-2 left-2 font-mono text-[10px] font-bold";
  return (
    <div aria-hidden="true" className="relative h-24 w-40">
      <span className={cn(card, "left-5 -rotate-[14deg] group-hover:-translate-x-2 group-hover:-rotate-[20deg]")}>
        <i className={cn(line, "top-3 w-7")} />
        <i className={cn(line, "top-5 w-5")} />
        <b className={cn(label, "text-blue-700 dark:text-blue-300")}>PDF</b>
      </span>
      <span className={cn(card, "left-[78px] rotate-[14deg] group-hover:translate-x-2 group-hover:rotate-[20deg]")}>
        <i className={cn(line, "top-3 w-7")} />
        <i className={cn(line, "top-5 w-5")} />
        <b className={cn(label, "text-amber-800 dark:text-amber-300")}>ZIP</b>
      </span>
      <span className={cn(card, "left-[50px] top-0.5 z-10 group-hover:-translate-y-1.5")}>
        <i className={cn(line, "top-3 w-7")} />
        <i className={cn(line, "top-5 w-5")} />
        <b className={cn(label, "text-sky-700 dark:text-sky-300")}>PNG</b>
      </span>
      <span className="absolute -bottom-1 left-16 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-well">
        <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </div>
  );
}

export function UploadZone({
  files,
  onFilesChange,
  maxFiles,
  maxSize,
  disabled = false,
}: UploadZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const arr = Array.from(newFiles);
      const combined = [...files, ...arr].slice(0, maxFiles);
      onFilesChange(combined);
    },
    [files, maxFiles, onFilesChange],
  );

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const dropHandlers = {
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };
  const browse = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };
  const limits = `${t("upload.maxFiles", { count: maxFiles })} · ${t("upload.maxSize", { size: formatBytes(maxSize) })}`;

  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t("upload.dropzone")}
          className={cn(
            "group flex cursor-pointer flex-col items-center gap-4 rounded-[20px] border border-dashed border-input bg-well px-5 pb-7 pt-8 text-center transition-colors hover:border-primary-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDragging && "border-primary bg-primary-soft",
            disabled && "pointer-events-none opacity-50",
          )}
          {...dropHandlers}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <FileFan />
          <div>
            <p className="text-[17px] font-semibold tracking-tight">
              {isDragging ? t("upload.dropzoneActive") : t("share.dropTitle")}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("share.dropSubtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={browse}>
              <Upload />
              {t("upload.browseFiles")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
            >
              <FolderOpen />
              {t("upload.browseFolder")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{limits}</p>
        </div>
      ) : (
        <div
          className={cn(
            "rounded-[20px] bg-well p-1.5 transition-colors",
            isDragging && "bg-primary-soft",
          )}
          {...dropHandlers}
        >
          {/* Cap the viewport, not the root, so the list actually scrolls. */}
          <ScrollArea viewportClassName="max-h-72">
            <ul className="space-y-1.5" role="list">
              {files.map((file, i) => {
                const badge = fileBadge(file.name);
                const path = file.webkitRelativePath || file.name;
                return (
                  <li
                    key={`${file.name}-${file.size}-${i}`}
                    className="flex items-center gap-3 rounded-[14px] bg-card py-2 pl-2.5 pr-2 shadow-chip"
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-mono text-[10px] font-bold", badge.className)}>
                      {badge.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{path}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={t("share.removeFile", { name: file.name })}
                      disabled={disabled}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 pt-2.5">
            <span className="text-xs text-muted-foreground">
              {t("upload.selectedFiles", { count: files.length })} · {formatBytes(totalSize)}
              {files.length > 1 && <> · {t("share.zipHint")}</>}
            </span>
            <Button type="button" variant="ghost" size="sm" className="text-primary-text" disabled={disabled} onClick={browse}>
              <Plus />
              {t("share.addMore")}
            </Button>
          </div>
        </div>
      )}

      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error -- webkitdirectory is not in standard types
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
