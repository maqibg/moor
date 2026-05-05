import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-xl border border-[var(--fg-10)] bg-transparent px-3 py-2 font-body text-sm text-cursor-dark",
      "placeholder:text-[var(--fg-40)]",
      "focus:border-[var(--fg-20)] focus-visible:outline-none focus-visible:shadow-[rgba(0,0,0,0.1)_0px_4px_12px]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "resize-none transition-all duration-150",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
