import { Toaster as Sonner, type ToasterProps } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      closeButton
      icons={{
        error: <AlertCircle className="h-4 w-4 text-destructive" />,
        warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
        success: <CheckCircle2 className="h-4 w-4 text-success" />,
        info: <Info className="h-4 w-4 text-blue-500" />,
      }}
      {...props}
    />
  );
}
