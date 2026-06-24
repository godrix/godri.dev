import { NextResponse } from "next/server";
import {
  assertLinksAdminToken,
  getTokenFromRequest,
  LinksAdminUnauthorizedError,
} from "@/lib/links-admin";
import {
  deleteRecommendation,
  updateRecommendation,
  type RecommendationInput,
} from "@/lib/recommendations";
import type { LinkItem, LinkTag } from "@/data/links";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

function parseId(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function requireAdmin(request: Request) {
  assertLinksAdminToken(getTokenFromRequest(request));
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin(request);
  } catch (error) {
    if (error instanceof LinksAdminUnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 401 },
      );
    }
    throw error;
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "ID inválido." },
      { status: 400 },
    );
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
    const item = await updateRecommendation(id, input);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao atualizar recomendação.";
    const status = message.includes("não encontrada") ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireAdmin(request);
  } catch (error) {
    if (error instanceof LinksAdminUnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 401 },
      );
    }
    throw error;
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "ID inválido." },
      { status: 400 },
    );
  }

  try {
    await deleteRecommendation(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao excluir recomendação.";
    const status = message.includes("não encontrada") ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
