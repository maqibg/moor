import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} className={cn("h-8 w-8", className)}>
      {copied ? (
        <Check className="h-[18px] w-[18px] text-success-muted" />
      ) : (
        <Copy className="h-[18px] w-[18px]" />
      )}
    </Button>
  );
}
