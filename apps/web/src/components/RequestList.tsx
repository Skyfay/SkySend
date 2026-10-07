import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestCard } from "@/components/RequestCard";
import { useRequestHistory, type RequestWithStatus } from "@/hooks/useFileRequests";

/**
 * The requests made in this browser, for the Requests tab of My Links. `hint` leaves out the
 * line on where the list lives, for a page that says it already.
 */
export function RequestList({ hint = true }: { hint?: boolean }) {
  const { t } = useTranslation();
  const history = useRequestHistory();

  const handleDelete = async (request: RequestWithStatus) => {
    try {
      await history.remove(request);
      toast.success(request.hasPassword ? t("requests.forgotten") : t("requests.deleted"));
    } catch {
      toast.error(t("requests.deleteFailed"));
    }
  };

  if (history.loading) {
    return (
      <Card className="overflow-hidden" aria-busy="true">
        <ul className="divide-y divide-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-24 rounded-xl" />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (history.requests.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
          <Inbox className="h-6 w-6" />
        </span>
        <p className="text-lg font-semibold tracking-tight">{t("requests.empty")}</p>
        <Button asChild>
          <Link to="/requests">
            {t("requests.emptyAction")}
            <ArrowRight />
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border" role="list">
          {history.requests.map((request) => (
            <RequestCard key={request.id} request={request} onDelete={handleDelete} />
          ))}
        </ul>
      </Card>
      {hint && <p className="text-xs text-muted-foreground">{t("requests.localHint")}</p>}
    </div>
  );
}
