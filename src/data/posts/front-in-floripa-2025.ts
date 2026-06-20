import type { Post } from "@/data/posts";

export const frontInFloripa2025Post: Post = {
  slug: "front-in-floripa-2025",
  title: "De Volta ao maior evento front-end de Santa Catarina!",
  excerpt:
    "Resumo do Front in Floripa 2025: palestras sobre Next.js, observabilidade, IA, microfrontends, processos de engenharia e muito mais.",
  source:
    "https://www.linkedin.com/pulse/de-volta-ao-maior-evento-front-end-santa-catarina-gabriel-godri-g0zgf/",
  date: "2025-11-16",
  tags: ["front-end", "eventos", "front-in-floripa", "ia"],
  readTime: 14,
  coverImage: "/artigos/front-in-floripa-2025-cover.jpg",
  content: `Nesse findz semana fui até o Front in Floripa, e foi **muito bom ter voltado ao evento**! No ano passado não consegui ir porque foi no período que acabei virando TL, então eu fiquei no famoso **sem tempo, irmão**. Então, vamos ao resumo de tudo que aconteceu, minhas anotações e opiniões!

É incrível ver pessoas tão bacanas compartilhando conhecimento e alimentando nossa vontade de aprender e nossa paixão por tecnologia. Afinal, como o **Thor** disse em algum filme, **"qualquer tecnologia suficientemente avançada é indistinguível de magia"**!

Mas sem mais enrolação, vamos falar sobre as talks, bora!

O evento começou com a [Fernanda Kipper](https://www.linkedin.com/in/fernanda-kipper/) como host. Ela falou que foi a primeira vez que foi host de evento, mas se saiu muito bem. OK, tirando as piadas e a história triste do **PlayStation** (entendedores entenderão), ela mandou muito bem no palco!

A Fernanda começou o evento chamando o [Rafael R. Camargo](https://www.linkedin.com/in/rafaelrcamargo/) com a palestra sobre:

## "Como reescrevi 500 mil linhas de Next.js (e sobrevivi para contar a história)"

A palestra foi muito boa, ele falou sobre como ele reescreveu o projeto que ele estava atuando e como resolveu os problemas depois. E também que levou pra alma o que o pessoal da bolha tech do Xwitter.

Mostrou seu aprendizado sobre isso e os aprendizados e desafios dessa migração.

Em seguida tivemos a palestra de [Larissa Azevedo](https://www.linkedin.com/in/larissasazevedo/):

## "Código à prova de falhas no Front-end: observabilidade, bugs e cases de prevenção"

Falando sobre observabilidade, muitas coisas de bom senso, mas cá entre nós, já vimos muitas vezes não serem seguidas, como mutar canal de alertas. O que mais gostei foi: **"Prever o imprevisível é impossível."**

E então depois, começou os temas de IA, IA, IA...

**"IA, IA por toda parte!"** Coloquei emoji aqui porque todo texto sobre IA precisa de um emoji para ser validado 😉. Mas também não era de se esperar outra coisa, estamos vivendo um novo normal com IA.

Começamos com [Fabio Vedovelli](https://www.linkedin.com/in/vedovelli/) falando sobre:

## "Do caos à entrega: como organizar o trabalho para ter resultados reais com IA"

Segunda vez que eu vejo uma palestra dele na FrontIn, uma foi sobre Remix.js. Rapaz, ele tem uma elasticidade pra se adaptar como um jovem, e no fim, tecnologia é sobre isso: se adaptar e se manter atualizado. Ele falou sobre como organizar o trabalho para ter resultados reais com IA, sobre seus workflows e o uso de **MCP**. Gostei bastante, o fluxo de trabalho dele é muito parecido com o meu! Ele fala que usa o **Claude** e o **Cursor** (Cursor é o meu queridinho, então achei muito bom o conteúdo). Eu também sigo o fluxo de trabalho integrando com MCP que buscam as histórias e vamos escrevendo junto com a IA. Ele usa um documento chamado **PRD**, no meu caso eu mais uso **ADRs** e **RFCs**, mas o fluxo é basicamente o mesmo. Quero trazer pra cá um conteúdo sobre isso!

Depois do almoço tivemos [Erasmo Hernández](https://www.linkedin.com/in/erasmohernandez/) falando sobre:

## "Microfrontends a gran escala: aprendizajes al escalar Design System y librerías"

Rapaz, vou te falar que brasileiro acha que sabe ouvir e falar em espanhol, até vir alguém falando em espanhol na FrontIn! Mas não achei muito bom o meu espanhol. Gostei bastante sobre como os microfrontends resolvem bastante problemas, mas pra falar a verdade, acho que faltou trazer também os problemas de cada _trade-off_ ou eu não peguei, porque meu espanhol eu só uso quando vou pro Paraguai.

Depois tivemos **Paulo De Mitri & Felipe Maffezzolli**, falando sobre:

## "Novo Next.js 16: escalando seu front para milhões de acessos simultâneos"

Falando sobre Next, Vercel, escalabilidade com Next e também com o case da loja da Virgínia, que descobri que tem mais de 50 milhões de seguidores e é ex do RezendeEvil... Sim, o youtuber! Cada um vive uma bolha.

Depois tivemos um painel muito da hora com [Rodrigo Branas](https://www.linkedin.com/in/rodrigobranas/) (que foi o host desse painel), [Felipe Fialho](https://www.linkedin.com/in/felipefialho/), Fabio Vedovelli & Michelle Horn, falando sobre:

## Painel: Fluxo de desenvolvimento & mercado de trabalho

Cara, sério, IA! Estamos de novo falando de IA! Se você acha que isso é apenas _hype_ ou modinha, essa galera também estava entregando muito mais, e esse é o ponto aqui: se você não se adaptar, outros vão. Foi um ótimo painel, com visões bem otimistas e digamos, realistas.

Depois do painel tivemos o [Augusto Galego](https://www.linkedin.com/in/augusto-galego/) falando sobre:

## "Processos de engenharia que realmente funcionam"

Rapaz, esse eu estava muito empolgado pra ver, acompanho o conteúdo do Galego no YouTube e é muito estranho ver ele falar sobre conteúdo sem aparecer um _jaba_ do [Abacus.AI](https://www.linkedin.com/company/abacusai/) kkkkkk. Ótima palestra também! Ele começa mostrando como processos são importantes, o exemplo é da aviação e como um CRM faz com que o número de acidentes da aviação comercial seja baixíssimo, por causa de processos. Porém, também fala que pra tecnologia não é tão trivial, porque cada vez mais tem mais coisas a serem feitas e mais coisas a serem melhoradas, variáveis a serem planejadas que se perde o controle. Não que seja mais difícil que aviação, mas mais imprevisível.

E por último tivemos a palestra da [Michelle Horn](https://www.linkedin.com/in/michelle-horn/) falando sobre:

## "IA no Frontend: Marco Zero para Criação de Herói ou Vilão"

Do fluxo de trabalho agora envolvendo ferramentas mais de front, como o **Figma Maker** e o **Lovable**, e uma comparação dos dois. Eu particularmente não gosto desse nível de _promptização_ para gerar conteúdo, porém o ponto que traz para o produto validar conceito e o uso do MCP do Figma são pontos bem interessantes a se avaliar.

## 🤖 Prompt: "Agora quero um texto para finalizar o texto sobre o evento"

O evento foi muito bom, tivemos muitas coisas interessantes, muitas palestras bem legais, muito conteúdo pra absorver. O jacaré da Hostigator estava incrível! Eu não ganhei nenhum prêmio... OK, ganhei uma torta na cara, mas não vem ao caso (**CSS TE ODEIO!**) e deveria ter uma competição para quem não tivesse derramado café na camisa ganhar um prêmio.`,
};
