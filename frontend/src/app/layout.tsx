import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Miramath",
  description: "パーソナル数学学習アプリ",
  applicationName: "Miramath",
  icons: {
    icon: "/miramath-favicon.svg",
    shortcut: "/miramath-favicon.svg",
    apple: "/miramath-favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background overflow-hidden`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
