import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string }[];
  className?: string;
}

export function Tabs({ value, onValueChange, tabs, className }: TabsProps) {
  return (
    <div className={cn("flex gap-1 bg-surface-300/60 rounded-xl p-1 w-fit", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onValueChange(tab.value)}
          className={cn(
            "font-headline text-sm px-4 py-2 rounded-lg transition-all",
            value === tab.value
              ? "bg-surface-100 text-cursor-dark shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
              : "text-[var(--fg-45)] hover:text-[var(--fg-70)]",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
