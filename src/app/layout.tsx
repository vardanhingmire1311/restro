import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });


export const metadata: Metadata = {
  title: "Restro",
  description: "Service floor, kitchen, and billing for a 15-table dining room.",
  manifest: "/manifest.webmanifest",
  applicationName: "Restro",
};

export const viewport: Viewport = { themeColor: "#0f0f11", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${manrope.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
