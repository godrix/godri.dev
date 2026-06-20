import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AnimatedLink } from "@/components/AnimatedLink";
import { PageLayout } from "@/components/PageLayout";
import { Badge } from "@/components/Badge";
import { posts, getPostBySlug, formatDate } from "@/data/posts";
import { buildArticleMetadata } from "@/lib/metadata";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Artigo não encontrado" };
  return buildArticleMetadata(post);
}

function renderContent(content: string) {
  const blocks = content.split("\n\n");

  return blocks.map((block, i) => {
    if (block.startsWith("## ")) {
      return <h2 key={i}>{block.replace("## ", "")}</h2>;
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
    const imageMatch = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      const [, alt, src] = imageMatch;
      return (
        <figure key={i} className="my-8 border-[3px] border-black shadow-nb-lg">
          <Image
            src={src}
            alt={alt || ""}
            width={1280}
            height={720}
            className="h-auto w-full"
          />
          {alt && (
            <figcaption className="border-t-2 border-black bg-nb-bg-secondary px-4 py-2 text-sm font-medium">
              {alt}
            </figcaption>
          )}
        </figure>
      );
    }
    return <p key={i}>{renderInline(block)}</p>;
  });
}

function renderBoldAndCode(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.flatMap((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return [<code key={`${keyPrefix}-c-${i}`}>{part.slice(1, -1)}</code>];
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${keyPrefix}-b-${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      if (!bp) return null;
      return <span key={`${keyPrefix}-t-${i}-${j}`}>{bp}</span>;
    });
  });
}

function renderInline(text: string, keyPrefix = "inline") {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...renderBoldAndCode(
          text.slice(lastIndex, match.index),
          `${keyPrefix}-${key++}`
        )
      );
    }
    nodes.push(
      <a
        key={`${keyPrefix}-link-${key++}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold underline underline-offset-2 hover:bg-nb-primary"
      >
        {match[1]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      ...renderBoldAndCode(text.slice(lastIndex), `${keyPrefix}-${key++}`)
    );
  }

  return nodes;
}

export default async function ArtigoPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  return (
    <PageLayout>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <AnimatedLink
          href="/artigos"
          className="mb-8 inline-block border-2 border-black bg-white px-4 py-2 text-sm font-bold shadow-nb-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb"
        >
          ← Voltar aos artigos
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
          {post.source && (
            <p className="mt-4 text-sm font-medium">
              Publicado originalmente no{" "}
              <a
                href={post.source}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline underline-offset-2 hover:bg-nb-primary"
              >
                LinkedIn
              </a>
            </p>
          )}
        </header>

        {post.coverImage && (
          <div className="mb-10 border-[3px] border-black shadow-nb-lg">
            <Image
              src={post.coverImage}
              alt={`Capa: ${post.title}`}
              width={540}
              height={720}
              className="h-auto w-full"
              priority
            />
          </div>
        )}

        <div className="prose-nb text-base leading-relaxed">
          {renderContent(post.content)}
        </div>
      </article>
    </PageLayout>
  );
}
