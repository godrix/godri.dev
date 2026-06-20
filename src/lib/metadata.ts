import type { Metadata } from "next";
import type { Post } from "@/data/posts";

export const SITE_URL = "https://godri.dev";
export const SITE_NAME = "godri.dev";
export const AUTHOR_NAME = "Carlos Godri";
export const AUTHOR_URL = "https://www.linkedin.com/in/carlosgodri/";

const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "godri.dev — Projetos & Artigos",
};

export function buildArticleMetadata(post: Post): Metadata {
  const url = `${SITE_URL}/artigos/${post.slug}`;
  const ogImage = post.coverImage
    ? {
        url: post.coverImage,
        width: 1200,
        height: 630,
        alt: post.title,
      }
    : DEFAULT_OG_IMAGE;

  return {
    title: post.title,
    description: post.excerpt,
    keywords: post.tags,
    authors: [{ name: AUTHOR_NAME, url: AUTHOR_URL }],
    creator: AUTHOR_NAME,
    publisher: SITE_NAME,
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url,
      siteName: SITE_NAME,
      locale: "pt_BR",
      type: "article",
      publishedTime: post.date,
      authors: [AUTHOR_URL],
      tags: post.tags,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [ogImage.url],
    },
  };
}

export function buildPageMetadata({
  title,
  description,
  path,
  image,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
}): Metadata {
  const url = `${SITE_URL}${path}`;
  const ogImage = image
    ? { url: image, width: 1200, height: 630, alt: title }
    : DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "pt_BR",
      type: "website",
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage.url],
    },
  };
}
