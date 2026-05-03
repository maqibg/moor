import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-[rgba(38,37,30,0.08)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
