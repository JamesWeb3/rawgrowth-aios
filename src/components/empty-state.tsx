import type { ComponentType, ReactNode } from "react";

type EmptyStateProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-card/40 px-5 py-10 text-center">
      <div className="mb-4 flex size-10 items-center justify-center rounded-md border border-border bg-card/40 text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mb-1 text-[13px] font-medium text-foreground">{title}</h3>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
