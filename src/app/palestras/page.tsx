import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { buildPageMetadata } from "@/lib/metadata";
import { PALESTRAS_PATH } from "@/data/palestras";

export const metadata: Metadata = buildPageMetadata({
  title: "Palestras",
  description: "Talks e palestras em eventos — catálogo em construção.",
  path: PALESTRAS_PATH,
});

export default function PalestrasPage() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
        <SectionHeader
          label="Palestras"
          title="Talks & palco"
          description="Eventos, conferências e meetups — em breve você encontra tudo aqui."
        />

        <div className="border-2 border-black bg-white p-8 text-center shadow-nb">
          <p className="font-display text-xl font-bold sm:text-2xl">
            Catálogo em construção
          </p>
          <p className="mt-3 text-sm font-medium opacity-80">
            Palestras e slides entram em breve.
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
