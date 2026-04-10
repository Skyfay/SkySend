import { useTranslation } from "react-i18next";
import { formatDuration } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ExpirySelectorProps {
  expireOptions: number[];
  downloadOptions: number[];
  expireSec: number;
  maxDownloads: number;
  onExpireChange: (value: number) => void;
  onDownloadsChange: (value: number) => void;
  disabled?: boolean;
}

export function ExpirySelector({
  expireOptions,
  downloadOptions,
  expireSec,
  maxDownloads,
  onExpireChange,
  onDownloadsChange,
  disabled = false,
}: ExpirySelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="expiry">{t("upload.expiry")}</Label>
        <Select
          value={String(expireSec)}
          onValueChange={(v) => onExpireChange(parseInt(v, 10))}
          disabled={disabled}
        >
          <SelectTrigger id="expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expireOptions.map((sec) => (
              <SelectItem key={sec} value={String(sec)}>
                {formatDuration(sec)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="downloads">{t("upload.downloads")}</Label>
        <Select
          value={String(maxDownloads)}
          onValueChange={(v) => onDownloadsChange(parseInt(v, 10))}
          disabled={disabled}
        >
          <SelectTrigger id="downloads">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {downloadOptions.map((num) => (
              <SelectItem key={num} value={String(num)}>
                {num}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
