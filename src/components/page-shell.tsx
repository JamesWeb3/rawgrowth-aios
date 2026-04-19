import type { ReactNode } from "react";

type PageShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, description, actions, children }: PageShellProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl font-normal tracking-tight text-foreground">
                {title}
              </h2>
              {description && (
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
