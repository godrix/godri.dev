import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!url) {
  console.error("DATABASE_URL ou POSTGRES_URL não configurado.");
  process.exit(1);
}

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS short_links (
    id SERIAL PRIMARY KEY,
    hash VARCHAR(12) UNIQUE NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS short_links_hash_idx ON short_links (hash)
`;

try {
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS short_links_url_idx ON short_links (url)
  `;
} catch (error) {
  const code =
    error instanceof Error && "code" in error
      ? (error as { code: string }).code
      : null;

  if (code === "23505") {
    console.warn(
      "Índice único em url ignorado: já existem URLs duplicadas no banco.",
    );
  } else {
    throw error;
  }
}

console.log("Tabela short_links pronta.");
