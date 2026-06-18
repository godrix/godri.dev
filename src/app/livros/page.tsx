import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Portfólio",
};

export default function LivrosRedirect() {
  redirect("/portfolio");
}
