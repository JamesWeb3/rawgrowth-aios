import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getOrgContext, listAllOrganizations } from "@/lib/auth/admin";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
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
      className={cn("dark antialiased", geist.variable, instrumentSerif.variable)}
    >
      <body className="min-h-screen font-sans">
        <AppShell
          orgName={ctx?.activeOrgName ?? null}
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
