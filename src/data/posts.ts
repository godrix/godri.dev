import { ateLogoCaptchasPost } from "@/data/posts/ate-logo-captchas";
import { casamentoGravataSapatoPost } from "@/data/posts/casamento-gravata-sapato";
import { frontInFloripa2023Post } from "@/data/posts/front-in-floripa-2023";
import { frontInFloripa2025Post } from "@/data/posts/front-in-floripa-2025";

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  tags: string[];
  readTime: number;
  source?: string;
  coverImage?: string;
};

export const posts: Post[] = [
  ateLogoCaptchasPost,
  casamentoGravataSapatoPost,
  frontInFloripa2025Post,
  frontInFloripa2023Post,
];

export function getPostBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
