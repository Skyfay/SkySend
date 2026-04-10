import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, Inbox } from "lucide-react";
import { UploadCard } from "@/components/UploadCard";
import { useUploadHistory } from "@/hooks/useUploadHistory";
import { toast } from "@/hooks/useToast";

export function MyUploadsPage() {
  const { t } = useTranslation();
  const { uploads, loading, deleteUpload } = useUploadHistory();

  const handleDelete = async (id: string, ownerToken: string) => {
    try {
      await deleteUpload(id, ownerToken);
      toast({ title: t("myUploads.deleteSuccess"), variant: "success" });
    } catch {
      toast({
        title: t("myUploads.deleteFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
        <FolderOpen className="h-7 w-7 text-primary" />
        {t("myUploads.title")}
      </h1>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : uploads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
          <Inbox className="h-12 w-12" />
          <div>
            <p className="text-lg font-medium">{t("myUploads.empty")}</p>
            <p className="text-sm">{t("myUploads.emptyHint")}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {uploads.map((upload) => (
            <UploadCard
              key={upload.id}
              upload={upload}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
