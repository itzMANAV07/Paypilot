import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayPilot — AI Invoicing Agent",
  description:
    "Chat-first AI accounts-receivable agent. Turn a message into a PayPal invoice in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-zinc-50 font-sans">{children}</body>
    </html>
  );
}
