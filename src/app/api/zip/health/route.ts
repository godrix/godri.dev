import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  const hasDatabaseUrl = Boolean(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  );

  if (!hasDatabaseUrl) {
    return NextResponse.json({
      ok: false,
      connected: false,
      tableReady: false,
      env: { databaseUrl: false },
      error: "DATABASE_URL ou POSTGRES_URL não está definido no servidor.",
    });
  }

  try {
    const sql = getSql();

    await sql`SELECT 1 AS ping`;

    const tables = await sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'short_links'
      ) AS exists
    `;

    const tableReady = Boolean(tables[0]?.exists);

    return NextResponse.json({
      ok: true,
      connected: true,
      tableReady,
      env: { databaseUrl: true },
      ...(tableReady
        ? {}
        : {
            error:
              "Conectou no banco, mas a tabela short_links não existe. Rode scripts/create-short-links-table.sql no Neon.",
          }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido de conexão";

    console.error("[zip/health] Falha ao conectar no banco:", error);

    return NextResponse.json(
      {
        ok: false,
        connected: false,
        tableReady: false,
        env: { databaseUrl: true },
        error: message,
      },
      { status: 500 },
    );
  }
}
