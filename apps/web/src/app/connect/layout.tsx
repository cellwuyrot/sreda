import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TZ.Connect — Мессенджер T.Р.И.О.Z",
  description: "Коммуникационная платформа T.Р.И.О.Z: групповые чаты, голосовые каналы, IT-услуги для бизнеса.",
  openGraph: {
    title: "TZ.Connect — Мессенджер T.Р.И.О.Z",
    description: "Коммуникационная платформа с голосовыми каналами и IT-услугами.",
    images: [{ url: "/api/og?page=connect", width: 1200, height: 630, alt: "TZ.Connect" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/api/og?page=connect"],
  },
};

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
