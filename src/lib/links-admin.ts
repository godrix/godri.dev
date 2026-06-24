export function getLinksAdminToken(): string | undefined {
  return process.env.LINKS_ADMIN_TOKEN;
}

export function isValidLinksAdminToken(token: string | null | undefined): boolean {
  const expected = getLinksAdminToken();
  if (!expected || !token) return false;
  return token === expected;
}

export function assertLinksAdminToken(token: string | null | undefined): void {
  if (!isValidLinksAdminToken(token)) {
    throw new LinksAdminUnauthorizedError();
  }
}

export class LinksAdminUnauthorizedError extends Error {
  constructor() {
    super("Token inválido ou ausente.");
    this.name = "LinksAdminUnauthorizedError";
  }
}

export function getTokenFromRequest(request: Request): string | null {
  const headerToken = request.headers.get("x-links-admin-token");
  if (headerToken) return headerToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  try {
    const { searchParams } = new URL(request.url);
    return searchParams.get("token");
  } catch {
    return null;
  }
}
