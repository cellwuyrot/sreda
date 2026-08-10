import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Перо Измерений — T.Р.И.О.Z",
  description: "Книги и настольные игры вселенной T.Р.И.О.Z. Развлекательные товары для развития мышления.",
  openGraph: {
    title: "Перо Измерений — T.Р.И.О.Z",
    description: "Книги и настольные игры вселенной T.Р.И.О.Z.",
    images: [{ url: "/api/og?page=pero", width: 1200, height: 630, alt: "Перо Измерений" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og?page=pero"],
  },
};

export default function PeroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
