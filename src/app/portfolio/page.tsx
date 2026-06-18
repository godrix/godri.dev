import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { PortfolioCard } from "@/components/PortfolioCard";
import { portfolio } from "@/data/portfolio";

export const metadata: Metadata = {
  title: "Portfólio",
  description:
    "Portfólio unificado — projetos, livros e outras implementações.",
};

export default function PortfolioPage() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
        <SectionHeader
          label="Portfólio"
          title="Tudo em um lugar"
          description="Projetos, livros e outras coisas que faço — mocks por enquanto. Edite src/data/portfolio.ts quando tiver o conteúdo real."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {portfolio.map((item) => (
            <PortfolioCard key={item.slug} item={item} />
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
