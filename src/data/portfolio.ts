export type PortfolioKind = "projeto" | "livro" | "outro";

export type PortfolioStatus = "publicado" | "em-progresso" | "planejado";

export type PortfolioItem = {
  slug: string;
  kind: PortfolioKind;
  title: string;
  subtitle?: string;
  description: string;
  year: number;
  color: "primary" | "secondary" | "accent" | "success" | "warning";
  tags?: string[];
  status?: PortfolioStatus;
  pages?: number;
  url?: string;
  github?: string;
};

export const kindLabels: Record<PortfolioKind, string> = {
  projeto: "Projeto",
  livro: "Livro",
  outro: "Outro",
};

export const kindColors: Record<
  PortfolioKind,
  "primary" | "secondary" | "accent" | "success" | "warning"
> = {
  projeto: "secondary",
  livro: "accent",
  outro: "success",
};

export const portfolio: PortfolioItem[] = [
  {
    slug: "cursor-toys",
    kind: "projeto",
    title: "CursorToys",
    subtitle: "Extensão para Cursor / VS Code",
    description:
      "Utilitários que mantêm você no editor: teste de APIs, compartilhamento de configs de IA, kanban, MCP server embutido e painel de controle unificado.",
    tags: ["TypeScript", "Cursor", "MCP", "VS Code"],
    github: "https://github.com/CursorToys/cursor-toys",
    status: "publicado",
    color: "primary",
    year: 2026,
  },
  {
    slug: "deep-spec",
    kind: "projeto",
    title: "DeepSpec",
    subtitle: "Spec-Driven Development para agentes de IA",
    description:
      "Framework zero-ceremony que guia agentes de IA da intenção à implementação via pipeline drafts → active → archive e fluxo A-B-C.",
    tags: ["TypeScript", "SDD", "AI", "CLI"],
    github: "https://github.com/godrix/deep-spec",
    url: "https://godrix.github.io/deep-spec/",
    status: "publicado",
    color: "accent",
    year: 2026,
  },
  {
    slug: "sonarqube-mcp",
    kind: "projeto",
    title: "SonarQube MCP",
    subtitle: "Integração SonarQube via MCP",
    description:
      "Servidor MCP com 15 ferramentas para análise de qualidade de código, issues, hotspots, quality gates e cobertura completa da Web API do SonarQube.",
    tags: ["TypeScript", "MCP", "SonarQube"],
    github: "https://github.com/godrix/sonarqube-mcp",
    status: "publicado",
    color: "secondary",
    year: 2026,
  },
  {
    slug: "mcp-businessmap",
    kind: "projeto",
    title: "MCP Businessmap",
    subtitle: "Servidor MCP para Businessmap (Kanbanize)",
    description:
      "Servidor MCP não oficial para gerenciar boards, cards, colunas, lanes, workspaces e comentários no Businessmap — publicado no npm como @godrix/mcp-businessmap.",
    tags: ["TypeScript", "MCP", "Kanban"],
    github: "https://github.com/godrix/mcp-businessmap",
    status: "publicado",
    color: "success",
    year: 2025,
  },
  {
    slug: "mcp-strawberry",
    kind: "projeto",
    title: "mcp-strawberry",
    subtitle: "Contador de R's para LLMs",
    description:
      "Ferramenta MCP que empodera LLMs a contar com precisão a quantidade de letras R em palavras. Sim, é real. Sim, funciona.",
    tags: ["TypeScript", "MCP", "Humor"],
    github: "https://github.com/godrix/mcp-strawberry",
    status: "publicado",
    color: "warning",
    year: 2025,
  },
  {
    slug: "lookup-mac-address",
    kind: "projeto",
    title: "Lookup MAC Address",
    subtitle: "Extensão Chrome",
    description:
      "Encontre o fabricante de um dispositivo pelo endereço MAC — pela barra do navegador ou selecionando o MAC na página.",
    tags: ["JavaScript", "Chrome Extension"],
    github: "https://github.com/godrix/lookup-mac-anddress-chrome-extension",
    status: "publicado",
    color: "primary",
    year: 2019,
  },
  {
    slug: "whatsapp-bot-covid19",
    kind: "projeto",
    title: "WhatsApp Bot COVID-19",
    subtitle: "Bot informativo",
    description:
      "Bot para WhatsApp que informa sobre COVID-19 — menu interativo via mensagem de texto, feito no início da pandemia.",
    tags: ["JavaScript", "Node.js", "WhatsApp"],
    github: "https://github.com/godrix/whatsapp-bot-covid19",
    status: "publicado",
    color: "secondary",
    year: 2020,
  },
];

export function getPortfolioByKind(kind: PortfolioKind): PortfolioItem[] {
  return portfolio.filter((item) => item.kind === kind);
}

export function getProjetos(): PortfolioItem[] {
  return portfolio.filter((item) => item.kind === "projeto");
}
