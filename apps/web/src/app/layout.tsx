import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import ConditionalNavbar from "@/components/ui/ConditionalNavbar";
import BottomNav from "@/components/mobile/BottomNav";
import MainWrapper from "@/components/mobile/MainWrapper";
import MobileThemeToggle from "@/components/mobile/MobileThemeToggle";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin", "cyrillic"],
  variable: "--font-playfair",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const BASE_URL = "https://connect.trioz.ru";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "TrioZ — Экосистема проектов",
  description: "T.Р.И.О.Z — масштабная экосистема проектов. Игры, книги, коммуникации, IT-услуги для бизнеса.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "T.Р.И.О.Z",
    title: "T.Р.И.О.Z — Экосистема проектов",
    description: "Масштабная экосистема проектов. Игры, книги, коммуникации, IT-услуги для бизнеса.",
    url: BASE_URL,
    images: [{ url: "/api/og?page=main", width: 1200, height: 630, alt: "T.Р.И.О.Z" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "T.Р.И.О.Z — Экосистема проектов",
    description: "Масштабная экосистема проектов. Игры, книги, коммуникации, IT-услуги.",
    images: ["/api/og?page=main"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        {/* Anti-flash: apply saved theme (dark/light/mono/mono-lite) AND light variant (warm) before first paint */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var d = document.documentElement;
            var t = localStorage.getItem('trioz-theme') || 'dark';
            if (t !== 'dark' && t !== 'light' && t !== 'mono' && t !== 'mono-lite') t = 'dark';
            d.classList.toggle('dark', t === 'dark' || t === 'mono');
            d.classList.toggle('light', t === 'light' || t === 'mono-lite');
            d.classList.toggle('mono', t === 'mono');
            d.classList.toggle('mono-lite', t === 'mono-lite');
            d.classList.toggle('warm', localStorage.getItem('tz-connect-light-variant') === 'warm' && t === 'light');
            /* FIX-B6: помечаем Electron-оболочку до первой отрисовки (нет вспышки веб-навигации) */
            if (window.triozDesktop || navigator.userAgent.indexOf('Electron') !== -1) d.classList.add('tz-desktop');
            /* ANDROID-LOCK: помечаем Android-оболочку до первой отрисовки — CSS скрывает сайтовые ссылки без вспышки */
            if (navigator.userAgent.indexOf('ConnectAndroid/') !== -1) d.classList.add('tz-android');
            /* MOBILE-FIX: честная высота вьюпорта. В Android WebView юнит dvh может
               не поддерживаться или не пересчитываться при клавиатуре (adjustResize),
               из-за чего каркас мессенджера разваливался. innerHeight обновляется
               всегда — держим её в --tz-app-h и слушаем resize/visualViewport. */
            var setH = function(){ d.style.setProperty('--tz-app-h', window.innerHeight + 'px'); };
            setH();
            window.addEventListener('resize', setH);
            if (window.visualViewport) window.visualViewport.addEventListener('resize', setH);
          })();
        `}} />
      </head>
      <body className={`${inter.variable} ${playfair.variable} font-sans antialiased
        bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 min-h-screen transition-colors duration-300`}>
        <Providers>
          <ConditionalNavbar />
          <MainWrapper>{children}</MainWrapper>
          <MobileThemeToggle />
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
