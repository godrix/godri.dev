import { NextResponse } from "next/server";
import {
  assertLinksAdminToken,
  getTokenFromRequest,
  LinksAdminUnauthorizedError,
} from "@/lib/links-admin";
import { fetchLinkMetadata } from "@/lib/link-metadata";

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

  try {
    const metadata = await fetchLinkMetadata(url);
    return NextResponse.json({ ok: true, metadata });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao extrair metadados do link.";

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
