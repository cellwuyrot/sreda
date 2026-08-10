"use client";

import { usePathname } from "next/navigation";

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bottomNavHidden =
    pathname === "/" ||
    pathname === "/about" ||
    pathname?.startsWith("/auth") ||
    pathname?.startsWith("/connect") ||
    pathname?.startsWith("/workspace");

  return (
    <main className={bottomNavHidden ? "" : "max-md:pb-[calc(56px+env(safe-area-inset-bottom,0px))]"}>
      {children}
    </main>
  );
}
