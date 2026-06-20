import type { Post } from "@/data/posts";

export const casamentoGravataSapatoPost: Post = {
  slug: "casamento-gravata-sapato-pix",
  title:
    "Transformando a Brincadeira da Gravata e do Sapato em Competição Digital",
  excerpt:
    "Como levei tech pro casamento: PIX, webhooks, PostgreSQL e um placar em tempo real com React e Next.js para a tradicional arrecadação da lua de mel.",
  source:
    "https://www.linkedin.com/posts/carlosgodri_tecnologia-casamentotech-desenvolvimentoweb-activity-7400126355134197761-F8SJ/",
  date: "2025-11-28",
  tags: ["react", "nextjs", "pix", "webhooks", "casamento"],
  readTime: 5,
  coverImage: "/artigos/casamento-gravata-sapato-qr.jpg",
  content: `Há um ano, eu e minha esposa dissemos "sim" e, revendo as memórias no Google Fotos, percebi que nunca havia compartilhado o toque de tecnologia que implementei no nosso grande dia.

Quebrando o ditado de que "em casa de ferreiro, o espeto é de pau", decidi trazer o meu background para tornar a tradicional arrecadação para a lua de mel mais engajadora e divertida para os convidados.

![Diagrama da arquitetura: QR Codes PIX, webhook Asaas, banco de dados e placar em tempo real](/artigos/casamento-gravata-sapato-diagrama.jpg)

## O Desafio e a Solução Tech

A ideia era criar uma competição em tempo real, onde os convidados votavam no Noivo ou na Noiva doando via PIX.

## O Fluxo da Solução

- **PIX & QR Codes:** Criamos dois "cofrinhos" digitais, cada um com um QR Code PIX dedicado (um para mim, um para minha esposa).
- **Gateway de Pagamento:** Utilizei a API da [Asaas](https://www.linkedin.com/company/asaasbrasil/) (que na minha opinião é a mais dev friendly) como gateway de pagamento para gerenciar as transações PIX.
- **Webhook:** Após a confirmação de cada PIX, um webhook era instantaneamente enviado ao meu backend.
- **Backend & Database:** O backend processava a informação e salvava o valor arrecadado em um banco de dados PostgreSQL.
- **API em Tempo Real:** Uma API específica era alimentada com esses dados para retornar o placar atualizado de cada um.
- **Frontend:** Construído com React e Next.js (e hospedado na Vercel para aproveitar a infraestrutura serverless), consumia essa API e exibia o placar em tempo real para todos os convidados durante a festa!

![Placar em tempo real: Gravata vs. Sapato durante a festa](/artigos/casamento-gravata-sapato-duelo.jpg)

O resultado foi um alto engajamento, com as doações sendo acompanhadas ao vivo, transformando uma simples arrecadação em um momento interativo e de muita risada.`,
};
