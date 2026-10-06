const FILE_KINDS: Array<{ exts: string[]; className: string }> = [
  { exts: ["pdf", "doc", "docx", "txt", "md", "rtf", "odt", "pages", "xls", "xlsx", "csv", "ppt", "pptx", "key"], className: "bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  { exts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif", "bmp", "tif", "tiff"], className: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  { exts: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso"], className: "bg-amber-500/14 text-amber-800 dark:text-amber-300" },
  { exts: ["mp4", "mov", "mkv", "avi", "webm", "mp3", "wav", "flac", "m4a", "ogg"], className: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  { exts: ["js", "ts", "tsx", "jsx", "py", "go", "rs", "java", "json", "yml", "yaml", "sh", "sql", "env", "pem", "toml"], className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
];

/** A short colored label for a file, like PDF or ZIP, from its extension. */
export function fileBadge(name: string): { label: string; className: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind = FILE_KINDS.find((k) => k.exts.includes(ext));
  return {
    label: ext ? ext.slice(0, 4).toUpperCase() : "FILE",
    className: kind?.className ?? "bg-muted text-muted-foreground",
  };
}
