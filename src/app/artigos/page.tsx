import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { BlogCard } from "@/components/BlogCard";
import { posts } from "@/data/posts";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Artigos",
  description:
    "Artigos sobre dev, liderança técnica, eventos e open source por Carlos Godri.",
  path: "/artigos",
});

export default function ArtigosPage() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
        <SectionHeader
          label="Artigos"
          title="Textos e reflexões"
          description="Artigos sobre dev, liderança técnica, eventos e open source."
        />
        <div className="grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
