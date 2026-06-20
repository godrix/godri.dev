import type { Metadata } from "next";
import { Suspense } from "react";
import { PixCoffee } from "@/components/PixCoffee";
import { QueroCafeRefBanner } from "@/components/QueroCafeRefBanner";
import { StandalonePageLogo } from "@/components/StandalonePageLogo";
import { QUERO_CAFE_GIF, QUERO_CAFE_PATH } from "@/data/pix";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Me paga um café",
  description: "Apoie com um Pix — copia e cola ou QR Code. R$ 6,00.",
  path: QUERO_CAFE_PATH,
  image: QUERO_CAFE_GIF,
});

export default function QueroCafePage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-nb-bg px-6 py-12 sm:py-16">
      <StandalonePageLogo />
      <header className="mb-8 max-w-md text-center animate-slide-up">
        <div className="mx-auto mb-6 w-full max-w-xs border-[3px] border-black bg-nb-warning shadow-nb-lg">
          <img
            src={QUERO_CAFE_GIF}
            alt="Homem gritando QUERO CAFÉ"
            className="block h-auto w-full"
            width={600}
            height={475}
          />
        </div>
        <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
          Apoio
        </p>
        <h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
          Quero um café ☕
        </h1>
        <p className="mt-3 text-base font-medium">
          Curtiu algo? Manda um Pix e me paga um café.
        </p>
      </header>

      <div className="w-full max-w-md animate-slide-up animate-delay-1">
        <Suspense fallback={null}>
          <QueroCafeRefBanner />
        </Suspense>
        <PixCoffee />
      </div>

      <footer className="mt-12 text-center">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-nb-muted">
          godri.dev/quero-cafe
        </p>
      </footer>
    </div>
  );
}
