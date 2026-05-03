import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-[18px] w-[18px] shrink-0 rounded-md border border-[rgba(38,37,30,0.2)] bg-surface-100",
      "focus-visible:outline-none focus-visible:shadow-[rgba(0,0,0,0.1)_0px_4px_12px]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-cursor-orange data-[state=checked]:border-cursor-orange",
      "data-[state=indeterminate]:bg-cursor-orange data-[state=indeterminate]:border-cursor-orange",
      "transition-all duration-150",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-white")}>
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
