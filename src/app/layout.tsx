import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getOrgContext, listAllOrganizations } from "@/lib/auth/admin";

// Rawgrowth brand fonts. Files in public/fonts/, sourced from Chris's
// brand kit (NeueHaasDisplay Medium for UI/body, Editor's Note Regular
// for serif headings + brand surfaces).
const neueHaas = localFont({
  src: "../../public/fonts/NeueHaasDisplay-Medium.ttf",
  variable: "--font-sans",
  display: "swap",
  weight: "500",
});

const editorsNote = localFont({
  src: "../../public/fonts/EditorsNote-Regular.otf",
  variable: "--font-serif",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Rawgrowth",
  description: "Rawgrowth AIOS",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ctx = await getOrgContext();
  const orgs = ctx?.isAdmin ? await listAllOrganizations() : [];

  return (
    <html
      lang="en"
      className={cn("dark antialiased", neueHaas.variable, editorsNote.variable)}
    >
      <body className="min-h-screen font-sans">
        <AppShell
          orgName={ctx?.activeOrgName ?? null}
          userEmail={ctx?.userEmail ?? null}
          userName={ctx?.userName ?? null}
          isAdmin={ctx?.isAdmin ?? false}
          isImpersonating={ctx?.isImpersonating ?? false}
          homeOrgId={ctx?.homeOrgId ?? null}
          activeOrgId={ctx?.activeOrgId ?? null}
          orgs={orgs}
        >
          {children}
        </AppShell>
        <Toaster />
      </body>
    </html>
  );
}
