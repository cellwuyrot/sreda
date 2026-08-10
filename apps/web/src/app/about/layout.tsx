import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "О проекте — T.Р.И.О.Z",
  description: "T.Р.И.О.Z — масштабная вселенная, объединяющая игры, книги, IT-услуги и коммуникационную платформу.",
  openGraph: {
    title: "О проекте — T.Р.И.О.Z",
    description: "T.Р.И.О.Z — масштабная вселенная, объединяющая игры, книги, IT-услуги и коммуникационную платформу.",
    images: [{ url: "/api/og?page=about", width: 1200, height: 630, alt: "О проекте T.Р.И.О.Z" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og?page=about"],
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
