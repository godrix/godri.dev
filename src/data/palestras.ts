export type Palestra = {
  slug: string;
  title: string;
  event: string;
  date: string;
  description?: string;
  url?: string;
  slides?: string;
  video?: string;
};

/** Talks e palestras — preencher quando estiver pronto. */
export const palestras: Palestra[] = [];

export const PALESTRAS_PATH = "/palestras";
