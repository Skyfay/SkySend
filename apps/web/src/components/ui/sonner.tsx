import { Toaster as Sonner, type ToasterProps } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useColorScheme } from "@/hooks/useColorScheme";

export function Toaster(props: ToasterProps) {
  const { colorScheme } = useColorScheme();

  return (
    <Sonner
      theme={colorScheme}
      className="toaster group"
      position="top-center"
      closeButton
      icons={{
        error: <AlertCircle className="h-4 w-4 text-destructive" />,
        warning: <AlertTriangle className="h-4 w-4 text-warning" />,
        success: <CheckCircle2 className="h-4 w-4 text-success" />,
        info: <Info className="h-4 w-4 text-primary-text" />,
      }}
      {...props}
    />
  );
}
