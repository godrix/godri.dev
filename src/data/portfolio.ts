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
    slug: "item-mock-projeto-01",
    kind: "projeto",
    title: "Projeto Mock 01",
    description:
      "Placeholder de projeto. Em breve entra aqui contexto, stack e links reais.",
    tags: ["Tag A", "Tag B"],
    color: "secondary",
    year: 2026,
  },
  {
    slug: "item-mock-livro-01",
    kind: "livro",
    title: "Livro Mock 01",
    subtitle: "Subtítulo placeholder",
    description:
      "Placeholder de livro. Quando estiver pronto, entra sinopse e link de compra.",
    status: "planejado",
    color: "accent",
    year: 2026,
  },
  {
    slug: "item-mock-projeto-02",
    kind: "projeto",
    title: "Projeto Mock 02",
    description: "Outro item de exemplo para preencher o portfólio unificado.",
    tags: ["React", "Mock"],
    github: "#",
    color: "primary",
    year: 2025,
  },
  {
    slug: "item-mock-livro-02",
    kind: "livro",
    title: "Livro Mock 02",
    subtitle: "Em construção",
    description: "Exemplo com status em progresso — útil para validar o layout.",
    status: "em-progresso",
    pages: 0,
    color: "warning",
    year: 2025,
  },
  {
    slug: "item-mock-outro-01",
    kind: "outro",
    title: "Implementação Mock",
    description:
      "Tipo genérico para qualquer coisa: talk, curso, side project, experimento…",
    url: "#",
    color: "success",
    year: 2024,
  },
];

export function getPortfolioByKind(kind: PortfolioKind): PortfolioItem[] {
  return portfolio.filter((item) => item.kind === kind);
}
