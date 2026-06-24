import { randomBytes } from "crypto";
import { getSql } from "@/lib/db";

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const HASH_LENGTH = 7;
const MAX_COLLISION_RETRIES = 5;
const CUSTOM_SLUG_MIN_LENGTH = 2;
const CUSTOM_SLUG_MAX_LENGTH = 48;
const RESERVED_SLUGS = new Set(["health"]);

export class CustomSlugTakenError extends Error {
  constructor() {
    super("Este caminho já está em uso por outro link.");
    this.name = "CustomSlugTakenError";
  }
}

export class InvalidCustomSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomSlugError";
  }
}

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

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidCustomSlug(value: string): boolean {
  const slug = normalizeSlug(value);

  if (
    slug.length < CUSTOM_SLUG_MIN_LENGTH ||
    slug.length > CUSTOM_SLUG_MAX_LENGTH
  ) {
    return false;
  }

  if (RESERVED_SLUGS.has(slug)) {
    return false;
  }

  return /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(slug);
}

export async function getShortLinkByHash(hash: string): Promise<ShortLink | null> {
  return getShortLink(hash);
}

export async function createShortLink(
  url: string,
  customSlug?: string,
): Promise<ShortLink> {
  const sql = getSql();
  const normalizedUrl = normalizeUrl(url);

  if (customSlug) {
    const slug = normalizeSlug(customSlug);

    if (!isValidCustomSlug(slug)) {
      throw new InvalidCustomSlugError(
        "Caminho inválido. Use 2–48 caracteres: letras minúsculas, números, - ou _.",
      );
    }

    const existingBySlug = await getShortLink(slug);
    if (existingBySlug) {
      if (existingBySlug.url === normalizedUrl) {
        return existingBySlug;
      }
      throw new CustomSlugTakenError();
    }

    const existingByUrl = await getShortLinkByUrl(normalizedUrl);
    if (existingByUrl) {
      const rows = await sql`
        UPDATE short_links
        SET hash = ${slug}
        WHERE url = ${normalizedUrl}
        RETURNING hash, url, created_at
      `;

      const row = rows[0];
      if (!row) throw new Error("Falha ao atualizar link encurtado");

      return toShortLink(row);
    }

    const rows = await sql`
      INSERT INTO short_links (hash, url)
      VALUES (${slug}, ${normalizedUrl})
      RETURNING hash, url, created_at
    `;

    const row = rows[0];
    if (!row) throw new Error("Falha ao criar link encurtado");

    return toShortLink(row);
  }

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
