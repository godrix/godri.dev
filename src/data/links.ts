import { QUERO_CAFE_PATH } from "@/data/pix";
import { ANIVERSARIO_PATH } from "@/data/aniversario";

export type SocialIcon = "github" | "twitter" | "linkedin" | "instagram";

export type SocialLink = {
  id: string;
  label: string;
  url: string;
  icon: SocialIcon;
  color: "primary" | "secondary" | "accent" | "success" | "warning" | "white";
};

export type LinkTag =
  | "livro"
  | "produto"
  | "servico"
  | "ferramenta"
  | "apoio"
  | "perifericos"
  | "eletronicos"
  | "estilo"
  | "roupa"
  | "cupom"
  | "software"
  | "curso"
  | "casa"
  | "saude";

export const linkTagLabels: Record<LinkTag, string> = {
  livro: "Livro",
  produto: "Produto",
  servico: "Serviço",
  ferramenta: "Ferramenta",
  apoio: "Apoio",
  perifericos: "Periféricos",
  eletronicos: "Eletrônicos",
  estilo: "Estilo",
  roupa: "Roupa",
  cupom: "Cupom de desconto",
  software: "Software",
  curso: "Curso",
  casa: "Casa",
  saude: "Saúde",
};

export const linkTagColors: Record<
  LinkTag,
  "primary" | "secondary" | "accent" | "success" | "warning" | "white"
> = {
  livro: "warning",
  produto: "accent",
  servico: "secondary",
  ferramenta: "primary",
  apoio: "success",
  perifericos: "secondary",
  eletronicos: "accent",
  estilo: "white",
  roupa: "warning",
  cupom: "success",
  software: "primary",
  curso: "secondary",
  casa: "white",
  saude: "success",
};

export type LinkItem = {
  id: string;
  label: string;
  description?: string;
  url: string;
  tag?: LinkTag;
  color: "primary" | "secondary" | "accent" | "success" | "warning" | "white";
  external?: boolean;
};

export type LinkGroup = {
  id: string;
  title: string;
  links: LinkItem[];
};

export const profile = {
  name: "godri",
  bio: "open source · software engineer · tech lead",
  avatar: "G",
};

export const socialLinks: SocialLink[] = [
  {
    id: "github",
    label: "GitHub",
    url: "https://github.com/godrix",
    icon: "github",
    color: "white",
  },
  {
    id: "twitter",
    label: "Twitter / X",
    url: "https://twitter.com/godrizilla",
    icon: "twitter",
    color: "secondary",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    url: "https://www.linkedin.com/in/carlosgodri/",
    icon: "linkedin",
    color: "white",
  },
  {
    id: "instagram",
    label: "Instagram",
    url: "#",
    icon: "instagram",
    color: "accent",
  },
];

export const defaultRecommendations: LinkItem[] = [
  {
    id: "engenharia-de-ia",
    label: "Engenharia de IA",
    description:
      "Construindo aplicações com modelos de fundação — Chip Huyen · Amazon",
    url: "https://a.co/d/05fOO0bp",
    tag: "livro",
    color: "warning",
  },
  {
    id: "cursor-referral",
    label: "Cursor",
    description:
      "50% off no 1º mês pelo link · você ganha créditos, eu também",
    url: "https://cursor.com/referral?code=TL4STMV9GPXE",
    tag: "servico",
    color: "secondary",
  },
];

export const linkGroups: LinkGroup[] = [
  {
    id: "apoio",
    title: "Apoio",
    links: [
      {
        id: "quero-cafe",
        label: "Me paga um café ☕",
        description: "Pix — R$ 6,00 · copia e cola ou QR Code",
        url: QUERO_CAFE_PATH,
        color: "warning",
      },
      {
        id: "aniversario",
        label: "Aniversário chegando 🎂",
        description: "Pix presente — valor livre",
        url: ANIVERSARIO_PATH,
        color: "accent",
      },
    ],
  },
];
