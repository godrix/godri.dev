import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, IBM_Plex_Mono } from "next/font/google";
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
    default: "godri.dev — Portfólio & Blog",
    template: "%s | godri.dev",
  },
  description:
    "Portfólio pessoal em construção — projetos, livros e mini blog (conteúdo mock por enquanto).",
  metadataBase: new URL("https://godri.dev"),
  openGraph: {
    title: "godri.dev",
    description: "Portfólio pessoal em construção.",
    url: "https://godri.dev",
    siteName: "godri.dev",
    locale: "pt_BR",
    type: "website",
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
