"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// The dark colour scheme is now a single design ("Cyber"); the former "Velvet"
// variant has been removed. The premium "Monochrome" design lives in the global
// theme (see components/Providers.tsx). This context only carries the light
// theme variant.
export type LightVariant = "default" | "warm";

interface ThemeContextValue {
  lightVariant: LightVariant;
  setLightVariant: (v: LightVariant) => void;
  toggleLightVariant: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  lightVariant: "default",
  setLightVariant: () => {},
  toggleLightVariant: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [lightVariant, setLightVariantState] = useState<LightVariant>("default");

  useEffect(() => {
    const savedLight = localStorage.getItem("tz-connect-light-variant") as LightVariant | null;
    if (savedLight === "warm" || savedLight === "default") setLightVariantState(savedLight);
  }, []);

  const setLightVariant = (v: LightVariant) => {
    setLightVariantState(v);
    localStorage.setItem("tz-connect-light-variant", v);
    const html = document.documentElement;
    html.classList.toggle("warm", v === "warm");
  };

  const toggleLightVariant = () => setLightVariant(lightVariant === "default" ? "warm" : "default");

  // Apply on mount / when the variant changes.
  useEffect(() => {
    document.documentElement.classList.toggle("warm", lightVariant === "warm");
  }, [lightVariant]);

  return (
    <ThemeContext.Provider value={{ lightVariant, setLightVariant, toggleLightVariant }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useConnectTheme() {
  return useContext(ThemeContext);
}
