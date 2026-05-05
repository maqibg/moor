interface PageHeaderProps {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
          {title}
        </h1>
        <p className="font-body text-sm text-[var(--fg-50)] mt-1.5">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
