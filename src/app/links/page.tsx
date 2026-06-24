import type { Metadata } from "next";
import { LinkTreeItem } from "@/components/LinkTreeItem";
import { SocialIconGrid } from "@/components/SocialIconGrid";
import { StandalonePageLogo } from "@/components/StandalonePageLogo";
import { profile, socialLinks, linkGroups, defaultRecommendations } from "@/data/links";
import { buildPageMetadata } from "@/lib/metadata";
import { listRecommendations } from "@/lib/recommendations";

export const metadata: Metadata = buildPageMetadata({
  title: "Links",
  description: "Links, redes sociais e recomendações do godri.",
  path: "/links",
});

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  let recommendations = await listRecommendations().catch(() => []);

  if (recommendations.length === 0) {
    recommendations = defaultRecommendations;
  }

  const apoioGroup = linkGroups.find((group) => group.id === "apoio");

  return (
    <div className="relative min-h-screen bg-nb-bg">
      <StandalonePageLogo />
      <div className="mx-auto max-w-md px-6 py-12 sm:py-16">
        <header className="mb-10 text-center animate-slide-up">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center border-[3px] border-black bg-nb-primary font-display text-3xl font-black shadow-nb-lg">
            {profile.avatar}
          </div>
          <h1 className="font-display text-3xl font-black tracking-tight">
            {profile.name}
          </h1>
          <p className="mt-2 font-mono text-xs font-bold uppercase tracking-widest">
            {profile.bio}
          </p>
        </header>

        <section className="mb-8 animate-slide-up animate-delay-1">
          <SocialIconGrid links={socialLinks} />
        </section>

        <div className="space-y-8">
          <section className="animate-slide-up animate-delay-2">
            <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest">
              Recomendações
            </h2>
            <div className="flex flex-col gap-3">
              {recommendations.length > 0 ? (
                recommendations.map((link) => (
                  <LinkTreeItem key={link.id} link={link} />
                ))
              ) : (
                <p className="font-mono text-xs text-nb-muted">
                  Nenhuma recomendação no momento.
                </p>
              )}
            </div>
          </section>

          {apoioGroup && (
            <section className="animate-slide-up animate-delay-3">
              <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest">
                {apoioGroup.title}
              </h2>
              <div className="flex flex-col gap-3">
                {apoioGroup.links.map((link) => (
                  <LinkTreeItem key={link.id} link={link} />
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="mt-12 border-t-2 border-black pt-6 text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-nb-muted">
            godri.dev/links
          </p>
        </footer>
      </div>
    </div>
  );
}
