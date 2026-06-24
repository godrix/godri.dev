import { randomBytes } from "crypto";
import { getSql } from "@/lib/db";

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const HASH_LENGTH = 7;
const MAX_COLLISION_RETRIES = 5;

export type ShortLink = {
  hash: string;
  url: string;
  createdAt: Date;
};

function generateHash(): string {
  const bytes = randomBytes(HASH_LENGTH);
  let result = "";
  for (let i = 0; i < HASH_LENGTH; i++) {
    result += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return result;
}

export function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function toShortLink(row: {
  hash: unknown;
  url: unknown;
  created_at: unknown;
}): ShortLink {
  return {
    hash: row.hash as string,
    url: row.url as string,
    createdAt: new Date(row.created_at as string),
  };
}

export async function getShortLinkByUrl(url: string): Promise<ShortLink | null> {
  const sql = getSql();

  const rows = await sql`
    SELECT hash, url, created_at
    FROM short_links
    WHERE url = ${url}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? toShortLink(row) : null;
}

export async function createShortLink(url: string): Promise<ShortLink> {
  const sql = getSql();
  const normalizedUrl = normalizeUrl(url);

  const existing = await getShortLinkByUrl(normalizedUrl);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const hash = generateHash();

    try {
      const rows = await sql`
        INSERT INTO short_links (hash, url)
        VALUES (${hash}, ${normalizedUrl})
        RETURNING hash, url, created_at
      `;

      const row = rows[0];
      if (!row) throw new Error("Falha ao criar link encurtado");

      return toShortLink(row);
    } catch (error) {
      const pgCode =
        error instanceof Error && "code" in error
          ? (error as { code: string }).code
          : null;

      if (pgCode === "23505") {
        const duplicate = await getShortLinkByUrl(normalizedUrl);
        if (duplicate) return duplicate;
      }

      if (pgCode !== "23505" || attempt === MAX_COLLISION_RETRIES - 1) {
        throw error;
      }
    }
  }

  throw new Error("Não foi possível gerar um hash único");
}

export async function getShortLink(hash: string): Promise<ShortLink | null> {
  const sql = getSql();

  const rows = await sql`
    SELECT hash, url, created_at
    FROM short_links
    WHERE hash = ${hash}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? toShortLink(row) : null;
}
