import type { Post } from "@/data/posts";

export const frontInFloripa2023Post: Post = {
  slug: "front-in-floripa-2023",
  title: "Aquele com o maior evento front-end de Santa Catarina",
  excerpt:
    "Resumo do Front in Floripa 2023: React Native, programação funcional, design system com Web Components, Next.js App Router e testes A/B na Globo.",
  date: "2023-11-27",
  tags: ["front-end", "eventos", "front-in-floripa"],
  readTime: 9,
  coverImage: "/artigos/front-in-floripa-2023-cover.jpg",
  content: `Quero mandar um salve para a galera do **#FrontInFloripa**, porque o evento de ontem foi sensacional! Sério, foi top demais, como diria o Erick Wendel.

É incrível ver pessoas tão bacanas compartilhando conhecimento e alimentando nossa vontade de aprender e nossa paixão por tecnologia.

Mas sem mais enrolação, vamos falar sobre as talks, bora!

O evento começou com o **Erick Wendel** como mestre de cerimônias, e cara, que figura kkkk quando crescer, quero ser como ele. Apresentou os convidados, fez umas piadas na hora certa, especialmente quando o espelhamento da tela não cooperava — afinal, evento de tecnologia sem bugs não é evento de tecnologia.

## "Tomorrow's React Native: o futuro do desenvolvimento de aplicações universais"

**Gabriel Donadel Dall'Agnol** abriu o dia mostrando como o React Native e o Expo estão de mãos dadas para tornar o desenvolvimento realmente universal. Abordou como as abstrações do Expo facilitam o desenvolvimento, inclusive em tecnologias novas como o Vision Pro da Apple. Uma questão que ficou no ar foi sobre a acessibilidade, já que não teve espaço para perguntas. Fiquei curioso para saber como o pessoal do Expo tem algum plano para isso — quem sabe uma abstração que unifica as diferentes plataformas, mantendo a universalidade das aplicações.

## "Uma introdução não convencional à programação funcional"

**Lucas da Costa** fez uma apresentação não convencional sobre programação funcional. Abriu o VIM e começou a escrever operações básicas de condicionais, lógicos e aritméticos, tudo em lambda functions. Aqui, uma observação: sei que a palestra foi mais para o lado da comédia, com o Lucas falando que arruinaria a programação funcional com passarinhos, mas para quem está começando na área, pode ter sido um susto. No final, acabou virando uma piada interna no evento. Vale a pena conferir a apresentação dele em outro momento para entender o contexto e dar umas risadas.

## "Web Components pra componentes web: a história do nosso Design System open-source"

[Felipe Fialho](https://www.linkedin.com/in/felipefialho/) e **Maurício M.** mostraram como conceberam e desenvolveram o design system utilizado por eles, utilizando web components para servir em suas aplicações. O DS serve tanto para React quanto Vue, ou qualquer outro framework batatajs. É encapsulado e servido através das ferramentas do StencilJS e Ionic, que pretendo brincar no meu próximo fim de semana.

## "Como padronizar stacks e automatizar processos no front-end em grandes empresas"

[Fernanda Kipper](https://www.linkedin.com/in/fernanda-kipper/) destacou a importância de automatizar processos, tirando a responsabilidade e a informação das pessoas e armazenando em código, como em scripts de Terraform ou CloudFormation provisionando infraestrutura como código. Essa ideia explodiu minha cabeça! Criar uma issue e isso já seria suficiente para preparar o ambiente.

## "Escalando Front End: Desafios de Trabalhar com Plataformas Web"

**Mario Souto** voltou para essa edição do FrontInFloripa para palestrar sem cair do palco (estamos na 1ª edição do FrontInFloripa sem o Mario cair do palco, nosso recorde é de 1 edição). Ele abordou as complexidades e desafios enfrentados pelos desenvolvedores/squad ao lidar com o crescimento e a expansão do projeto. Explorou questões práticas e estratégias para enfrentar os obstáculos associados à escalabilidade, detalhando as responsabilidades de cada parte.

## "Next.js - Exploring the App Router"

**Lucas Bordignon** trouxe uma das melhorias que chegou depois do React 13, onde o SSR, SSG e SSI mudaram a forma como usamos no nosso projeto. Como não utilizo muito o Next e atuo mais como dev mobile, fico um pouco fora desse mundo, mas o que o Next está fazendo com o React é realmente impressionante. Preciso tirar um tempinho para brincar com o Next.

## "Teste A/B em Larga Escala: Aprimorando o Player de Vídeo da Globo para Milhões de Usuários"

Essa palestra me surpreendeu bastante. Foi muito interessante ver como o pessoal da Globo utiliza teste A/B em seu player de vídeo para tomar decisões importantes. Criar hipóteses, disponibilizar para um grupo pequeno de usuários, definir as métricas a serem mensuradas. **Paulo Cesar Prado** deu um exemplo real onde um teste A/B validou a ideia de colocar anúncios em um momento específico do vídeo, aumentando significativamente a receita. Além disso, compartilhou outros testes, como o autoplay do vídeo.`,
};
