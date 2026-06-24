import { NextResponse } from "next/server";
import {
  assertLinksAdminToken,
  getTokenFromRequest,
  LinksAdminUnauthorizedError,
} from "@/lib/links-admin";
import {
  createRecommendation,
  listRecommendationRecords,
  listRecommendations,
  type RecommendationInput,
} from "@/lib/recommendations";
import type { LinkItem, LinkTag } from "@/data/links";

function parseInput(body: unknown): RecommendationInput | null {
  if (typeof body !== "object" || body === null) return null;

  const record = body as Record<string, unknown>;

  if (typeof record.label !== "string" || typeof record.url !== "string") {
    return null;
  }

  if (typeof record.color !== "string") return null;

  return {
    label: record.label,
    url: record.url,
    color: record.color as LinkItem["color"],
    description:
      typeof record.description === "string" ? record.description : null,
    tag:
      typeof record.tag === "string" ? (record.tag as LinkTag) : null,
    slug: typeof record.slug === "string" ? record.slug : undefined,
    sortOrder:
      typeof record.sortOrder === "number" ? record.sortOrder : undefined,
  };
}

export async function GET(request: Request) {
  const token = getTokenFromRequest(request);

  if (token) {
    try {
      assertLinksAdminToken(token);
      const items = await listRecommendationRecords();
      return NextResponse.json({ ok: true, items });
    } catch (error) {
      if (error instanceof LinksAdminUnauthorizedError) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 401 },
        );
      }
      throw error;
    }
  }

  try {
    const items = await listRecommendations();
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[recommendations] Falha ao listar:", error);
    return NextResponse.json(
      { ok: false, error: "Erro ao carregar recomendações." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertLinksAdminToken(getTokenFromRequest(request));
  } catch (error) {
    if (error instanceof LinksAdminUnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 401 },
      );
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Corpo da requisição inválido." },
      { status: 400 },
    );
  }

  const input = parseInput(body);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "Dados inválidos." },
      { status: 400 },
    );
  }

  try {
    const item = await createRecommendation(input);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao criar recomendação.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
