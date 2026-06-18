export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  tags: string[];
  readTime: number;
};

export const posts: Post[] = [
  {
    slug: "post-mock-01",
    title: "Post Mock 01",
    excerpt:
      "Resumo placeholder para o mini blog. Conteúdo real será adicionado depois.",
    content: `Este é um post de exemplo para manter a estrutura do blog funcionando.

## Seção mock

Parágrafo placeholder. Quando você tiver um texto pronto, substitua título, excerpt e corpo em src/data/posts.ts.

## Próximos passos

- Escrever o conteúdo real
- Ajustar tags e data
- Publicar`,
    date: "2026-01-01",
    tags: ["mock", "placeholder"],
    readTime: 2,
  },
  {
    slug: "post-mock-02",
    title: "Post Mock 02",
    excerpt:
      "Outro item fictício só para preencher a listagem enquanto os posts reais não existem.",
    content: `Mais um post placeholder.

Use este arquivo como template: cada entrada precisa de slug, title, excerpt, content, date, tags e readTime.

Quando o conteúdo estiver pronto, apague os mocks e coloque os posts de verdade.`,
    date: "2026-01-15",
    tags: ["exemplo"],
    readTime: 1,
  },
  {
    slug: "post-mock-03",
    title: "Post Mock 03",
    excerpt:
      "Terceiro mock para completar o grid da home e da página /blog.",
    content: `Conteúdo temporário.

O mini blog está pronto estruturalmente — falta só o texto.

## Lista de exemplo

- Item um
- Item dois
- Item três`,
    date: "2026-02-01",
    tags: ["mock", "blog"],
    readTime: 2,
  },
];

export function getPostBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
