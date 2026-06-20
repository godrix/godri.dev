import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AniversarioBirthdayPopup } from "@/components/AniversarioBirthdayPopup";
import { AniversarioPix } from "@/components/AniversarioPix";
import { StandalonePageLogo } from "@/components/StandalonePageLogo";
import {
  ANIVERSARIO_GIF,
  ANIVERSARIO_PATH,
  ANIVERSARIO_REF,
  isAniversarioSeason,
} from "@/data/aniversario";
import { QUERO_CAFE_PATH } from "@/data/pix";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Aniversário chegando",
  description: "Presente de aniversário via Pix — copia e cola ou QR Code.",
  path: ANIVERSARIO_PATH,
  image: ANIVERSARIO_GIF,
});

export default function AniversarioPage() {
  if (!isAniversarioSeason()) {
    redirect(`${QUERO_CAFE_PATH}?ref=${ANIVERSARIO_REF}`);
  }

  return (
    <>
      <AniversarioBirthdayPopup storageKey="aniversario-page-popup" />

      <div className="relative flex min-h-screen flex-col items-center justify-center bg-nb-bg px-6 py-12 sm:py-16">
        <StandalonePageLogo />
        <header className="mb-8 max-w-md text-center animate-slide-up">
          <div className="mx-auto mb-6 w-full max-w-xs border-[3px] border-black bg-nb-accent shadow-nb-lg">
            <img
              src={ANIVERSARIO_GIF}
              alt="Bolo de aniversário com HAPPY BIRTHDAY"
              className="block h-auto w-full"
              width={600}
              height={475}
            />
          </div>
          <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
            Aniversário
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
            Aniversário chegando 🎂
          </h1>
          <p className="mt-3 text-base font-medium">
            Quer mandar um presente? O Pix tá aqui.
          </p>
        </header>

        <div className="w-full max-w-md animate-slide-up animate-delay-1">
          <AniversarioPix />
        </div>

        <footer className="mt-12 text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-nb-muted">
            godri.dev/aniversario
          </p>
        </footer>
      </div>
    </>
  );
}
