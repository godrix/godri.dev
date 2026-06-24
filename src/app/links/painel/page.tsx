import type { Metadata } from "next";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { StandalonePageLogo } from "@/components/StandalonePageLogo";
import { isValidLinksAdminToken } from "@/lib/links-admin";

export const metadata: Metadata = {
  title: "Painel de recomendações",
  robots: { index: false, follow: false },
};

type PainelPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function LinksPainelPage({ searchParams }: PainelPageProps) {
  const { token } = await searchParams;

  if (!isValidLinksAdminToken(token)) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-nb-bg px-6 py-12">
        <StandalonePageLogo />
        <div className="mt-8 max-w-md border-[3px] border-black bg-nb-danger p-6 text-center shadow-nb">
          <h1 className="font-display text-2xl font-black">Acesso negado</h1>
          <p className="mt-3 font-mono text-sm">
            Token inválido ou ausente. Use{" "}
            <span className="font-bold">/links/painel?token=…</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-nb-bg px-6 py-12 sm:py-16">
      <StandalonePageLogo />
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center animate-slide-up">
          <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
            Admin
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight">
            Recomendações
          </h1>
          <p className="mt-3 text-sm font-medium text-nb-muted">
            Gerencie os links da seção Recomendações em /links
          </p>
        </header>

        <div className="animate-slide-up animate-delay-1">
          <RecommendationsPanel token={token} />
        </div>
      </div>
    </div>
  );
}
