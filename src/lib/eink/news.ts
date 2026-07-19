export type NewsItem = {
  title: string;
  link: string;
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

export function parseRssOrAtom(xml: string, limit = 5): NewsItem[] {
  const items: NewsItem[] = [];

  // RSS <item>
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title =
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link =
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ??
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      "";
    const cleanTitle = stripTags(decodeXmlEntities(title));
    if (cleanTitle) {
      items.push({ title: cleanTitle, link: stripTags(decodeXmlEntities(link)) });
    }
    if (items.length >= limit) return items;
  }

  if (items.length > 0) return items.slice(0, limit);

  // Atom <entry>
  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of entryBlocks) {
    const title =
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link =
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ??
      "";
    const cleanTitle = stripTags(decodeXmlEntities(title));
    if (cleanTitle) {
      items.push({ title: cleanTitle, link: stripTags(decodeXmlEntities(link)) });
    }
    if (items.length >= limit) break;
  }

  return items.slice(0, limit);
}

export async function fetchNews(
  urls: string[],
  limit = 5,
): Promise<NewsItem[] | null> {
  if (urls.length === 0) return null;

  try {
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            next: { revalidate: 300 },
            signal: AbortSignal.timeout(8000),
            headers: {
              Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
              "User-Agent": "godri.dev-eink/1.0",
            },
          });
          if (!res.ok) return [] as NewsItem[];
          const xml = await res.text();
          return parseRssOrAtom(xml, limit);
        } catch {
          return [] as NewsItem[];
        }
      }),
    );

    const merged: NewsItem[] = [];
    const seen = new Set<string>();
    for (const batch of results) {
      for (const item of batch) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= limit) return merged;
      }
    }

    return merged.length > 0 ? merged : null;
  } catch {
    return null;
  }
}
