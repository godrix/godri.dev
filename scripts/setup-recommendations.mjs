import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!url) {
  console.error("DATABASE_URL ou POSTGRES_URL não configurado.");
  process.exit(1);
}

const sql = neon(url);

const seed = [
  {
    slug: "engenharia-de-ia",
    label: "Engenharia de IA",
    description:
      "Construindo aplicações com modelos de fundação — Chip Huyen · Amazon",
    url: "https://a.co/d/05fOO0bp",
    tag: "livro",
    color: "warning",
    sort_order: 0,
  },
  {
    slug: "cursor-referral",
    label: "Cursor",
    description:
      "50% off no 1º mês pelo link · você ganha créditos, eu também",
    url: "https://cursor.com/referral?code=TL4STMV9GPXE",
    tag: "servico",
    color: "secondary",
    sort_order: 1,
  },
];

await sql`
  CREATE TABLE IF NOT EXISTS link_recommendations (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(64) UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    tag VARCHAR(32),
    color VARCHAR(32) NOT NULL DEFAULT 'primary',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS link_recommendations_sort_idx
  ON link_recommendations (sort_order, id)
`;

const existing = await sql`SELECT COUNT(*)::int AS count FROM link_recommendations`;
const count = existing[0]?.count ?? 0;

if (count === 0) {
  for (const item of seed) {
    await sql`
      INSERT INTO link_recommendations (
        slug, label, description, url, tag, color, sort_order
      )
      VALUES (
        ${item.slug},
        ${item.label},
        ${item.description},
        ${item.url},
        ${item.tag},
        ${item.color},
        ${item.sort_order}
      )
    `;
  }
  console.log(`Seed: ${seed.length} recomendações inseridas.`);
} else {
  console.log(`Seed ignorado: ${count} recomendações já existem.`);
}

console.log("Tabela link_recommendations pronta.");
