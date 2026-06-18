export type SocialIcon = "github" | "twitter" | "linkedin" | "instagram";

export type SocialLink = {
  id: string;
  label: string;
  url: string;
  icon: SocialIcon;
  color: "primary" | "secondary" | "accent" | "success" | "warning" | "white";
};

export type LinkItem = {
  id: string;
  label: string;
  description?: string;
  url: string;
  color: "primary" | "secondary" | "accent" | "success" | "warning" | "white";
};

export type LinkGroup = {
  id: string;
  title: string;
  links: LinkItem[];
};

export const profile = {
  name: "godri",
  bio: "links · mock · em breve",
  avatar: "G",
};

export const socialLinks: SocialLink[] = [
  {
    id: "github",
    label: "GitHub",
    url: "#",
    icon: "github",
    color: "white",
  },
  {
    id: "twitter",
    label: "Twitter / X",
    url: "#",
    icon: "twitter",
    color: "secondary",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    url: "#",
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

export const linkGroups: LinkGroup[] = [
  {
    id: "livros",
    title: "Livros",
    links: [
      {
        id: "livro-mock-01",
        label: "Livro Mock 01",
        description: "Link placeholder — Amazon em breve",
        url: "#",
        color: "warning",
      },
      {
        id: "livro-mock-02",
        label: "Livro Mock 02",
        description: "Link placeholder — afiliado em breve",
        url: "#",
        color: "accent",
      },
    ],
  },
  {
    id: "afiliados",
    title: "Recomendações",
    links: [
      {
        id: "afiliado-mock-01",
        label: "Recomendação Mock 01",
        description: "Link de afiliado placeholder",
        url: "#",
        color: "secondary",
      },
      {
        id: "afiliado-mock-02",
        label: "Recomendação Mock 02",
        description: "Outro link placeholder",
        url: "#",
        color: "white",
      },
      {
        id: "afiliado-mock-03",
        label: "Recomendação Mock 03",
        description: "Substituir quando tiver links reais",
        url: "#",
        color: "success",
      },
    ],
  },
];
