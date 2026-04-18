import type { Metadata } from "next";
import { Inter, Instrument_Serif, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rawgrowth — Install Your Company's In-House AI Department",
  description:
    "We install done-for-you in-house AI departments for 7-9 figure businesses. Content, sales, and operations — running 24/7.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("antialiased", instrumentSerif.variable, "font-sans", geist.variable)}
    >
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
