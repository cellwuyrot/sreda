"use client";

import { usePathname } from "next/navigation";
import Navbar from "./Navbar";

export default function ConditionalNavbar() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/about") {
    return null;
  }

  return (
    <div className="max-md:hidden">
      <Navbar />
      <div className="pt-16" />
    </div>
  );
}
