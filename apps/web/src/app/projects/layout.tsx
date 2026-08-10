import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Проекты — T.Р.И.О.Z",
  description: "Проекты вселенной T.Р.И.О.Z: MMORPG «Осколок Измерений», стратегии, онлайн-игры.",
  openGraph: {
    title: "Проекты — T.Р.И.О.Z",
    description: "Проекты вселенной T.Р.И.О.Z: MMORPG, стратегии, онлайн-игры.",
    images: [{ url: "/api/og?page=projects", width: 1200, height: 630, alt: "Проекты T.Р.И.О.Z" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og?page=projects"],
  },
};

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
