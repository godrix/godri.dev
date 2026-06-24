import type { Metadata } from "next";
import { ZipForm } from "@/app/zip/ZipForm";
import { StandalonePageLogo } from "@/components/StandalonePageLogo";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Zip — Encurtador de links",
  description: "Encurte URLs e compartilhe links curtos em godri.dev/zip.",
  path: "/zip",
});

export default function ZipPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-nb-bg px-6 py-12 sm:py-16">
      <StandalonePageLogo />
      <header className="mb-8 max-w-lg text-center animate-slide-up">
        <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
          Ferramenta
        </p>
        <h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
          Zip 🔗
        </h1>
        <p className="mt-3 text-base font-medium">
          Cole uma URL longa e receba um link curto — ou escolha um caminho
          personalizado como{" "}
          <span className="font-mono font-bold">godri.dev/zip/novidades</span>
        </p>
      </header>

      <div className="animate-slide-up animate-delay-1">
        <ZipForm />
      </div>

      <footer className="mt-12 text-center">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-nb-muted">
          godri.dev/zip
        </p>
      </footer>
    </div>
  );
}
