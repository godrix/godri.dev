export type Quote = {
  text: string;
  author: string;
};

const QUOTES: Quote[] = [
  {
    text: "Simplicidade é a sofisticação máxima.",
    author: "Leonardo da Vinci",
  },
  {
    text: "O código é lido muito mais vezes do que escrito.",
    author: "Guido van Rossum",
  },
  {
    text: "Faça funcionar, faça certo, faça rápido — nessa ordem.",
    author: "Kent Beck",
  },
  {
    text: "Premature optimization is the root of all evil.",
    author: "Donald Knuth",
  },
  {
    text: "Talk is cheap. Show me the code.",
    author: "Linus Torvalds",
  },
  {
    text: "A melhor forma de prever o futuro é inventá-lo.",
    author: "Alan Kay",
  },
  {
    text: "Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.",
    author: "Antoine de Saint-Exupéry",
  },
  {
    text: "Programs must be written for people to read, and only incidentally for machines to execute.",
    author: "Harold Abelson",
  },
  {
    text: "First, solve the problem. Then, write the code.",
    author: "John Johnson",
  },
  {
    text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
    author: "Martin Fowler",
  },
  {
    text: "A disciplina é a ponte entre metas e realizações.",
    author: "Jim Rohn",
  },
  {
    text: "Stay hungry, stay foolish.",
    author: "Steve Jobs",
  },
];

/** Stable daily pick from YYYY-MM-DD (or Date in local TZ string). */
export function quoteForDate(dateKey: string): Quote {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return QUOTES[hash % QUOTES.length]!;
}
