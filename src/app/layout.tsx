import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { SITE_NAME, SITE_URL } from "@/lib/metadata";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["700"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: {
    default: "godri.dev — Projetos & Artigos",
    template: "%s | godri.dev",
  },
  description:
    "Open source, software engineer e tech lead — projetos e artigos sobre dev e liderança técnica.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: SITE_NAME,
    description: "Projetos e artigos de um dev da dimensão C-137.",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "pt_BR",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: "Projetos e artigos de um dev da dimensão C-137.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${ibmPlexMono.variable}`}
    >
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
