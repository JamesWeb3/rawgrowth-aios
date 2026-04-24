import Image from "next/image";

import { getOrgContext } from "@/lib/auth/admin";
import { computeOnboardingProgress } from "@/lib/onboarding";
import OnboardingChat from "./OnboardingChat";

export default async function OnboardingPage() {
  const ctx = await getOrgContext();
  const firstName = ctx?.userName ? ctx.userName.split(" ")[0] : null;
  const initialProgress = ctx?.activeOrgId
    ? await computeOnboardingProgress(ctx.activeOrgId)
    : { current: 0, total: 14, completed: [] };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="rg-fade-in shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0A1210]/60">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-4 md:px-8">
          <Image
            src="/rawgrowth.png"
            alt="Rawgrowth"
            width={28}
            height={28}
            priority
            className="h-7 w-7 object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-[#0CBF6A]">
              Onboarding
            </p>
            <p className="text-sm text-[rgba(255,255,255,0.85)]">
              Let's get to know your business
            </p>
          </div>
        </div>
      </header>

      {/* Chat */}
      <div className="min-h-0 flex-1">
        <OnboardingChat firstName={firstName} initialProgress={initialProgress} />
      </div>
    </div>
  );
}
