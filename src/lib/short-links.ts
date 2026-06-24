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

export async function createShortLink(url: string): Promise<ShortLink> {
  const sql = getSql();

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const hash = generateHash();

    try {
      const rows = await sql`
        INSERT INTO short_links (hash, url)
        VALUES (${hash}, ${url})
        RETURNING hash, url, created_at
      `;

      const row = rows[0];
      if (!row) throw new Error("Falha ao criar link encurtado");

      return {
        hash: row.hash as string,
        url: row.url as string,
        createdAt: new Date(row.created_at as string),
      };
    } catch (error) {
      const isUniqueViolation =
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "23505";

      if (!isUniqueViolation || attempt === MAX_COLLISION_RETRIES - 1) {
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
  if (!row) return null;

  return {
    hash: row.hash as string,
    url: row.url as string,
    createdAt: new Date(row.created_at as string),
  };
}
