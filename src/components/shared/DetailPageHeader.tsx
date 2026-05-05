import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface DetailPageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  onBack: () => void;
}

export function DetailPageHeader({ title, subtitle, badge, onBack }: DetailPageHeaderProps) {
  return (
    <div className="flex items-center gap-3 animate-fade-in-up">
      <Button variant="ghost" size="icon" className="mt-0.5" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-headline text-xl font-medium text-cursor-dark tracking-tight truncate">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="font-body text-sm text-[var(--fg-45)] mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
