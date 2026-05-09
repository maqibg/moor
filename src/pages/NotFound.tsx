import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <FileQuestion className="h-12 w-12 text-[var(--fg-15)]" />
      <h2 className="font-headline text-xl text-[var(--fg-80)]">Page not found</h2>
      <p className="text-sm text-[var(--fg-50)]">The page you requested does not exist.</p>
      <Link to="/">
        <Button variant="outline">Back to dashboard</Button>
      </Link>
    </div>
  );
}
