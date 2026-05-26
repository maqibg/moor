import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <FileQuestion className="h-12 w-12 text-[var(--fg-15)]" />
      <h2 className="font-headline text-xl text-[var(--fg-80)]">{t("Page not found")}</h2>
      <p className="text-sm text-[var(--fg-50)]">{t("The page you requested does not exist.")}</p>
      <Link to="/">
        <Button variant="outline">{t("Back to dashboard")}</Button>
      </Link>
    </div>
  );
}
