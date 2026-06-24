import { linkTagLabels, type LinkItem, type LinkTag } from "@/data/links";
import { getSql } from "@/lib/db";

const LINK_COLORS = new Set([
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "white",
]);

const LINK_TAGS = new Set<string>(Object.keys(linkTagLabels));

export type RecommendationInput = {
  label: string;
  description?: string | null;
  url: string;
  tag?: LinkTag | null;
  color: LinkItem["color"];
  slug?: string;
  sortOrder?: number;
};

type RecommendationRow = {
  id: number;
  slug: string;
  label: string;
  description: string | null;
  url: string;
  tag: string | null;
  color: string;
  sort_order: number;
};

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toLinkItem(row: RecommendationRow): LinkItem {
  return {
    id: row.slug,
    label: row.label,
    description: row.description ?? undefined,
    url: row.url,
    tag: row.tag ? (row.tag as LinkTag) : undefined,
    color: row.color as LinkItem["color"],
    external: row.url.startsWith("http") || row.url.startsWith("//"),
  };
}

export function validateRecommendationInput(
  input: RecommendationInput,
): string | null {
  if (!input.label.trim()) return "Informe um título.";
  if (!input.url.trim()) return "Informe uma URL.";
  if (!LINK_COLORS.has(input.color)) return "Cor inválida.";
  if (input.tag && !LINK_TAGS.has(input.tag)) return "Tag inválida.";
  return null;
}

async function ensureUniqueSlug(base: string, excludeId?: number): Promise<string> {
  const sql = getSql();
  const candidate = base || "link";
  let suffix = 0;

  while (suffix < 100) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const rows = await sql`
      SELECT id
      FROM link_recommendations
      WHERE slug = ${slug}
      LIMIT 1
    `;

    const existingId = rows[0]?.id as number | undefined;
    if (!existingId || existingId === excludeId) return slug;

    suffix += 1;
  }

  throw new Error("Não foi possível gerar um identificador único.");
}

export async function listRecommendations(): Promise<LinkItem[]> {
  const sql = getSql();

  const rows = await sql`
    SELECT id, slug, label, description, url, tag, color, sort_order
    FROM link_recommendations
    ORDER BY sort_order ASC, id ASC
  `;

  return rows.map((row) => toLinkItem(row as RecommendationRow));
}

export async function createRecommendation(
  input: RecommendationInput,
): Promise<LinkItem> {
  const validationError = validateRecommendationInput(input);
  if (validationError) throw new Error(validationError);

  const sql = getSql();
  const baseSlug = slugify(input.slug?.trim() || input.label);
  const slug = await ensureUniqueSlug(baseSlug);

  const rows = await sql`
    INSERT INTO link_recommendations (
      slug,
      label,
      description,
      url,
      tag,
      color,
      sort_order
    )
    VALUES (
      ${slug},
      ${input.label.trim()},
      ${input.description?.trim() || null},
      ${input.url.trim()},
      ${input.tag ?? null},
      ${input.color},
      ${input.sortOrder ?? 0}
    )
    RETURNING id, slug, label, description, url, tag, color, sort_order
  `;

  const row = rows[0];
  if (!row) throw new Error("Falha ao criar recomendação.");

  return toLinkItem(row as RecommendationRow);
}

export async function updateRecommendation(
  id: number,
  input: RecommendationInput,
): Promise<LinkItem> {
  const validationError = validateRecommendationInput(input);
  if (validationError) throw new Error(validationError);

  const sql = getSql();
  const baseSlug = slugify(input.slug?.trim() || input.label);
  const slug = await ensureUniqueSlug(baseSlug, id);

  const rows = await sql`
    UPDATE link_recommendations
    SET
      slug = ${slug},
      label = ${input.label.trim()},
      description = ${input.description?.trim() || null},
      url = ${input.url.trim()},
      tag = ${input.tag ?? null},
      color = ${input.color},
      sort_order = ${input.sortOrder ?? 0},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, slug, label, description, url, tag, color, sort_order
  `;

  const row = rows[0];
  if (!row) throw new Error("Recomendação não encontrada.");

  return toLinkItem(row as RecommendationRow);
}

export async function deleteRecommendation(id: number): Promise<void> {
  const sql = getSql();

  const rows = await sql`
    DELETE FROM link_recommendations
    WHERE id = ${id}
    RETURNING id
  `;

  if (!rows[0]) throw new Error("Recomendação não encontrada.");
}

export type RecommendationRecord = LinkItem & { dbId: number; sortOrder: number };

export async function listRecommendationRecords(): Promise<RecommendationRecord[]> {
  const sql = getSql();

  const rows = await sql`
    SELECT id, slug, label, description, url, tag, color, sort_order
    FROM link_recommendations
    ORDER BY sort_order ASC, id ASC
  `;

  return rows.map((row) => {
    const typed = row as RecommendationRow;
    return {
      ...toLinkItem(typed),
      dbId: typed.id,
      sortOrder: typed.sort_order,
    };
  });
}
