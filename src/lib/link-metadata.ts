import { SITE_URL } from "@/lib/metadata";

export type LinkMetadata = {
  title?: string;
  description?: string;
};

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 256_000;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    );
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (host === "::1" || host === "[::1]") return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const parts = ipv4Match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function resolveMetadataUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return `${SITE_URL}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getMetaContent(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return undefined;
}

function getTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function pickFirst(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.length > 0);
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const fetchUrl = resolveMetadataUrl(url);
  if (!fetchUrl) {
    throw new Error("URL inválida ou não permitida para extração.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "godri.dev-link-metadata/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Não foi possível acessar o link (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error("O link não retornou uma página HTML.");
    }

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder("utf-8").decode(
      buffer.byteLength > MAX_HTML_BYTES
        ? buffer.slice(0, MAX_HTML_BYTES)
        : buffer,
    );

    const title = pickFirst(
      getMetaContent(html, "og:title"),
      getMetaContent(html, "twitter:title"),
      getTitleTag(html),
    );

    const description = pickFirst(
      getMetaContent(html, "og:description"),
      getMetaContent(html, "twitter:description"),
      getMetaContent(html, "description"),
    );

    if (!title && !description) {
      throw new Error("Nenhum metadado encontrado nesse link.");
    }

    return { title, description };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Tempo esgotado ao buscar metadados do link.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
