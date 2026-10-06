import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { LinkGone } from "@/components/LinkGone";

export function NotFoundPage() {
  const { t } = useTranslation();
  return <LinkGone icon={FileQuestion} title={t("notFound.title")} text={t("notFound.description")} />;
}
