import { Shield } from "lucide-react";

export function AdminBanner({ orgName }: { orgName: string | null }) {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
      <Shield className="h-3.5 w-3.5" />
      <span>
        Admin View{orgName ? ` — viewing ${orgName}` : ""}
      </span>
    </div>
  );
}
