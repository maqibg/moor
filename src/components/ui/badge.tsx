import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full font-headline text-xs px-2 py-0.5",
  {
    variants: {
      variant: {
        default: "bg-surface-300 text-[rgba(38,37,30,0.6)]",
        success: "bg-success-muted/15 text-success-muted",
        error: "bg-error-warm/15 text-error-warm",
        warning: "bg-gold/15 text-gold",
        outline: "border border-[rgba(38,37,30,0.1)] text-[rgba(38,37,30,0.55)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
