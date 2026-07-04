import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorBannerProps {
  message: string;
  variant?: "default" | "mono";
  className?: string;
}

export function ErrorBanner({ message, variant = "default", className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-error-warm/20 bg-error-warm/8 px-3 py-2",
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-error-warm" />
      <p
        className={cn(
          "min-w-0 text-error-warm",
          variant === "mono" ? "truncate font-mono text-[11px]" : "break-words font-body text-xs",
        )}
        title={message}
      >
        {message}
      </p>
    </div>
  );
}
