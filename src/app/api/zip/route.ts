import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/metadata";
import { createShortLink, isValidUrl } from "@/lib/short-links";

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
    const link = await createShortLink(url);
    return NextResponse.json({
      ok: true,
      shortUrl: `${SITE_URL}/zip/${link.hash}`,
      originalUrl: link.url,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erro ao encurtar a URL. Tente novamente." },
      { status: 500 },
    );
  }
}
