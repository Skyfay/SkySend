import { useTranslation } from "react-i18next";
import { HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface StorageLowNoticeProps {
  /** The largest upload the page allows, which the server may refuse for now. */
  maxSize: number;
}

/**
 * For while the server reports `storageLow`: an upload up to `maxSize` may not fit right now.
 * Whether one does shows only when it starts, since the server never tells how much is free.
 */
export function StorageLowNotice({ maxSize }: StorageLowNoticeProps) {
  const { t } = useTranslation();
  return (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-warning"
    >
      <HardDrive className="mt-0.5 h-4 w-4 shrink-0" />
      {t("upload.storageLow", { size: formatBytes(maxSize) })}
    </p>
  );
}
