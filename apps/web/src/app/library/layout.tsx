import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TZ.Library — База знаний T.Р.И.О.Z",
  description: "Хранилище знаний и лора вселенной T.Р.И.О.Z. Статьи, история, мифология.",
  openGraph: {
    title: "TZ.Library — База знаний T.Р.И.О.Z",
    description: "Хранилище знаний и лора вселенной T.Р.И.О.Z.",
    images: [{ url: "/api/og?page=library", width: 1200, height: 630, alt: "TZ.Library" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og?page=library"],
  },
};

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
