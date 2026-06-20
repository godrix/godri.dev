import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { PortfolioCard } from "@/components/PortfolioCard";
import { getProjetos } from "@/data/portfolio";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Projetos",
  description: "Projetos open source e software que construo.",
  path: "/projetos",
});

export default function ProjetosPage() {
  const projetos = getProjetos();

  return (
    <PageLayout>
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
        <SectionHeader
          label="Projetos"
          title="Coisas que construo"
          description="Open source, ferramentas MCP, extensões e side projects que construo e mantenho."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projetos.map((item) => (
            <PortfolioCard key={item.slug} item={item} />
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
