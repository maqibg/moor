import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full font-headline text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-surface-300 text-[var(--fg-60)] px-2.5 py-0.5",
        success:
          "bg-success-muted/12 text-success-muted px-2 py-0.5 border border-success-muted/20",
        error: "bg-error-warm/12 text-error-warm px-2 py-0.5 border border-error-warm/20",
        warning: "bg-gold/12 text-gold px-2 py-0.5 border border-gold/20",
        outline: "border border-[var(--fg-12)] text-[var(--fg-55)] px-2 py-0.5",
        subtle: "bg-[var(--fg-06)] text-[var(--fg-50)] px-2 py-0.5",
        accent: "bg-cursor-orange/10 text-cursor-orange px-2 py-0.5 border border-cursor-orange/20",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
