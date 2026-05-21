import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface KeyValueEditorProps {
  entries: Array<[string, string]>;
  onChange: (entries: Array<[string, string]>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  keyLabel?: string;
  valueLabel?: string;
  disabled?: boolean;
}

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  keyLabel = "Key",
  valueLabel = "Value",
  disabled = false,
}: KeyValueEditorProps) {
  const update = (index: number, field: 0 | 1, value: string) => {
    const next = entries.map(([k, v], i) =>
      i === index
        ? ((field === 0 ? [value, v] : [k, value]) as [string, string])
        : ([k, v] as [string, string]),
    );
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...entries, ["", ""]]);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
        <span className="font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-1">
          {keyLabel}
        </span>
        <span className="font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-1">
          {valueLabel}
        </span>
        <span />
      </div>
      {entries.map(([key, value], index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
          <Input
            placeholder={keyPlaceholder}
            value={key}
            onChange={(e) => update(index, 0, e.target.value)}
            disabled={disabled}
            className="h-9 text-xs font-mono"
          />
          <Input
            placeholder={valuePlaceholder}
            value={value}
            onChange={(e) => update(index, 1, e.target.value)}
            disabled={disabled}
            className="h-9 text-xs font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[var(--fg-40)] hover:text-error-warm shrink-0"
            onClick={() => remove(index)}
            disabled={disabled}
            aria-label={`Remove ${keyLabel.toLowerCase()} row`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-[var(--fg-55)] hover:text-cursor-dark"
        onClick={add}
        disabled={disabled}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
      </Button>
    </div>
  );
}
