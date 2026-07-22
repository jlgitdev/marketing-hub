import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./polish.css";
import "./assistant.css";
import "./summit-agenda.css";
import { AppShell } from "@/components/app-shell";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Marketing Hub",
  description: "Local-only opportunity research, outreach preparation, and campaign content workspace.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
