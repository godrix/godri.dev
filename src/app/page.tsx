import { AnimatedLink } from "@/components/AnimatedLink";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { WaveHand } from "@/components/WaveHand";
import { PortfolioCard } from "@/components/PortfolioCard";
import { BlogCard } from "@/components/BlogCard";
import { portfolio } from "@/data/portfolio";
import { posts } from "@/data/posts";

export default function HomePage() {
  const featuredItems = portfolio.slice(0, 3);
  const latestPosts = posts.slice(0, 2);

  return (
    <PageLayout>
      {/* Hero */}
      <section className="border-b-[3px] border-black bg-nb-primary">
        <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16 sm:py-24">
          <div className="animate-slide-up">
            <Badge color="accent" className="mb-6">
              em construção · mock
            </Badge>
            <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight sm:text-7xl">
              Oi, eu sou o{" "}
              <span className="inline-block border-2 border-black bg-white px-2 py-1 shadow-nb -rotate-1">
                godri
              </span>{" "}
              <WaveHand />
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-relaxed sm:text-xl">
              Site pessoal em montagem. Portfólio e blog abaixo são placeholders
              até o conteúdo real ficar pronto.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button href="/portfolio">Ver portfólio</Button>
              <Button href="/blog" variant="secondary">
                Ler o blog
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b-[3px] border-black bg-white">
        <div className="mx-auto grid max-w-[var(--nb-max-width)] grid-cols-1 divide-y-2 divide-black sm:grid-cols-2 sm:divide-x-2 sm:divide-y-0">
          {[
            {
              label: "Portfólio",
              value: `${portfolio.length}`,
              color: "bg-nb-secondary",
              href: "/portfolio",
              sectionId: "portfolio",
            },
            {
              label: "Posts",
              value: `${posts.length}`,
              color: "bg-nb-success",
              href: "/blog",
              sectionId: "blog",
            },
          ].map((stat) => (
            <AnimatedLink
              key={stat.label}
              href={stat.href}
              scrollOnHome
              sectionId={stat.sectionId}
              className={`block px-6 py-8 text-center transition-all duration-150 hover:-translate-y-1 ${stat.color}`}
            >
              <p className="font-display text-4xl font-black">{stat.value}</p>
              <p className="mt-1 font-mono text-xs font-bold uppercase tracking-widest">
                {stat.label}
              </p>
            </AnimatedLink>
          ))}
        </div>
      </section>

      {/* Portfólio */}
      <section
        id="portfolio"
        className="border-b-[3px] border-black bg-nb-bg-secondary scroll-mt-20"
      >
        <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
                Portfólio
              </p>
              <h2 className="font-display text-3xl font-black">
                Projetos, livros e mais
              </h2>
            </div>
            <AnimatedLink
              href="/portfolio"
              className="shrink-0 border-2 border-black bg-white px-4 py-2 text-sm font-bold shadow-nb-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb"
            >
              Ver todos →
            </AnimatedLink>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredItems.map((item) => (
              <PortfolioCard key={item.slug} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Blog */}
      <section
        id="blog"
        className="mx-auto max-w-[var(--nb-max-width)] scroll-mt-20 px-6 py-16"
      >
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
              Mini blog
            </p>
            <h2 className="font-display text-3xl font-black">Últimos posts</h2>
          </div>
          <AnimatedLink
            href="/blog"
            className="shrink-0 border-2 border-black bg-nb-primary px-4 py-2 text-sm font-bold shadow-nb-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb"
          >
            Ver todos →
          </AnimatedLink>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {latestPosts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </PageLayout>
  );
}
