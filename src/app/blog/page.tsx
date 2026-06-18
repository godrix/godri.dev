import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { BlogCard } from "@/components/BlogCard";
import { posts } from "@/data/posts";

export const metadata: Metadata = {
  title: "Blog",
  description: "Mini blog com pensamentos sobre dev, design e produtividade.",
};

export default function BlogPage() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-16">
        <SectionHeader
          label="Mini blog"
          title="Blog"
          description="Posts mock para testar o layout. Textos reais entram em src/data/posts.ts."
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
