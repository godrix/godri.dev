import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/metadata";
import {
  createShortLink,
  CustomSlugTakenError,
  InvalidCustomSlugError,
  isValidUrl,
} from "@/lib/short-links";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Corpo da requisição inválido." },
      { status: 400 },
    );
  }

  const url =
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof body.url === "string"
      ? body.url.trim()
      : "";

  const slug =
    typeof body === "object" &&
    body !== null &&
    "slug" in body &&
    typeof body.slug === "string"
      ? body.slug.trim()
      : undefined;

  if (!url) {
    return NextResponse.json(
      { ok: false, error: "Informe uma URL." },
      { status: 400 },
    );
  }

  if (!isValidUrl(url)) {
    return NextResponse.json(
      { ok: false, error: "URL inválida. Use http:// ou https://." },
      { status: 400 },
    );
  }

  try {
    const link = await createShortLink(url, slug || undefined);
    return NextResponse.json({
      ok: true,
      shortUrl: `${SITE_URL}/zip/${link.hash}`,
      originalUrl: link.url,
    });
  } catch (error) {
    console.error("[zip] Falha ao encurtar URL:", error);

    if (error instanceof CustomSlugTakenError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }

    if (error instanceof InvalidCustomSlugError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const isDev = process.env.NODE_ENV === "development";
    const detail =
      error instanceof Error ? error.message : "Erro desconhecido";

    return NextResponse.json(
      {
        ok: false,
        error: isDev
          ? detail
          : "Erro ao encurtar a URL. Tente novamente.",
        ...(isDev ? { hint: "Abra GET /api/zip/health para diagnosticar." } : {}),
      },
      { status: 500 },
    );
  }
}
