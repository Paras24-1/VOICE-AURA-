import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VoxAura AI | Multilingual Voice Agent SaaS",
  description: "Enterprise-grade multilingual AI voice agent platform with real-time analytics and custom integration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} h-full antialiased dark`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full flex flex-col bg-[#030303] text-zinc-100 font-sans selection:bg-violet-500/30 selection:text-violet-200">
        {children}
      </body>
    </html>
  );
}

