import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnimatedLink } from "@/components/AnimatedLink";
import { PageLayout } from "@/components/PageLayout";
import { Badge } from "@/components/Badge";
import { posts, getPostBySlug, formatDate } from "@/data/posts";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post não encontrado" };
  return {
    title: post.title,
    description: post.excerpt,
  };
}

function renderContent(content: string) {
  const blocks = content.split("\n\n");

  return blocks.map((block, i) => {
    if (block.startsWith("## ")) {
      return (
        <h2 key={i}>{block.replace("## ", "")}</h2>
      );
    }
    if (block.startsWith("- ")) {
      const items = block.split("\n").map((line) => line.replace(/^- /, ""));
      return (
        <ul key={i}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }
    if (/^\d+\. /.test(block)) {
      const items = block.split("\n").map((line) => line.replace(/^\d+\. /, ""));
      return (
        <ol key={i}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    }
    return <p key={i}>{renderInline(block)}</p>;
  });
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      return <span key={`${i}-${j}`}>{bp}</span>;
    });
  });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  return (
    <PageLayout>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <AnimatedLink
          href="/blog"
          className="mb-8 inline-block border-2 border-black bg-white px-4 py-2 text-sm font-bold shadow-nb-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb"
        >
          ← Voltar ao blog
        </AnimatedLink>

        <header className="mb-10 border-b-[3px] border-black pb-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <time className="font-mono text-xs font-bold">
              {formatDate(post.date)}
            </time>
            <span className="font-mono text-xs">·</span>
            <span className="font-mono text-xs font-bold">
              {post.readTime} min de leitura
            </span>
          </div>
          <h1 className="font-display text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Badge key={tag} color="accent">
                {tag}
              </Badge>
            ))}
          </div>
        </header>

        <div className="prose-nb text-base leading-relaxed">
          {renderContent(post.content)}
        </div>
      </article>
    </PageLayout>
  );
}
