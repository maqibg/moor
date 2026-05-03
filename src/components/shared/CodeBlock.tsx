import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  code: string;
  label?: string;
}

export function CodeBlock({ code, label }: CodeBlockProps) {
  return (
    <div className="relative group">
      {label && (
        <p className="font-headline text-[11px] text-[rgba(38,37,30,0.5)] mb-1.5 uppercase tracking-wider">
          {label}
        </p>
      )}
      <div className="bg-cursor-dark rounded-xl border border-[rgba(38,37,30,0.15)] p-4 relative overflow-hidden">
        <pre className="font-mono text-[12px] leading-relaxed text-[rgba(242,241,237,0.85)] overflow-x-auto whitespace-pre-wrap pr-10">
          {code}
        </pre>
        <CopyButton
          text={code}
          className="absolute top-2.5 right-2.5 h-7 w-7 text-[rgba(242,241,237,0.3)] hover:text-[rgba(242,241,237,0.8)] hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>
    </div>
  );
}
