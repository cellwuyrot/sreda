"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode, createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { InlineEditProvider } from "./InlineEditContext";
import InlineEditOverlay from "./InlineEditOverlay";
import { HeartbeatProvider } from "./HeartbeatProvider";
import { DesktopActivityBridge } from "./DesktopActivityBridge"; // FIX-ACT
import { DesktopNavigationBridge } from "./DesktopNavigationBridge"; // FIX-NAV1
import { AndroidShellGuard } from "./AndroidShellGuard"; // ANDROID-LOCK
import { IdleAnimationGuard } from "./IdleAnimationGuard"; // PERF-GPU
import { VoiceProvider } from "@/contexts/VoiceContext";
import VoiceOverlayBridge from "@/components/voice/VoiceOverlayBridge"; // FIX-OVL
import VoiceMiniWidget from "@/components/voice/VoiceMiniWidget";
import { CallProvider } from "@/components/call/CallProvider"; // CALL
import WelcomeModal from "@/components/WelcomeModal";
import { ConfirmDialogHost } from "@/components/ui/ConfirmDialog";
import { ThemeProvider as ConnectThemeProvider } from "@/contexts/ThemeContext";
import { normalizeTheme } from "@/lib/themeNormalization";
import { LanguageProvider } from "@/lib/i18n"; // FIX-I18N

// Семейства тем:
//   dark / light      — базовая пара (Cyber / Light)
//   mono / mono-lite  — премиум-пара Monochrome (ночь / день)
// mono строится на dark (классы dark+mono), mono-lite — на light
// (классы light+mono-lite), поэтому Tailwind-утилиты `dark:` работают как раньше.
type Theme = "dark" | "light" | "mono" | "mono-lite";

/** Apply a theme to <html> by toggling the base classes. */
function applyThemeClasses(t: Theme) {
  const d = document.documentElement;
  d.classList.toggle("dark", t === "dark" || t === "mono");
  d.classList.toggle("light", t === "light" || t === "mono-lite");
  d.classList.toggle("mono", t === "mono");
  d.classList.toggle("mono-lite", t === "mono-lite");
}

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("trioz-theme");
    const saved: Theme = normalizeTheme(stored);
    setThemeState(saved);
    localStorage.setItem("trioz-theme", saved);
    applyThemeClasses(saved);
  }, []);

  // FIX-PERF: setTheme стабилен (useCallback), чтобы не пересоздавать
  // toggleTheme и value контекста на каждый рендер.
  const setTheme = useCallback((next: Theme) => {
    const normalized: Theme = normalizeTheme(next);
    setThemeState(normalized);
    localStorage.setItem("trioz-theme", normalized);
    applyThemeClasses(normalized);
  }, []);

  // Legacy API only. Theme selection, including the Premium entitlement check,
  // lives in appearance settings; no quick toggle may bypass that check.
  const toggleTheme = useCallback(() => {}, []);

  // FIX-PERF: мемоизируем значение контекста — потребители useTheme()
  // перерисовываются только при реальной смене темы, а не на каждый рендер
  // провайдера.
  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LanguageProvider>{/* FIX-I18N */}
        <ConnectThemeProvider>
          <HeartbeatProvider />
          <DesktopActivityBridge />{/* FIX-ACT */}
          <DesktopNavigationBridge />{/* FIX-NAV1: мягкая навигация из десктоп-оболочки без перезагрузки */}
          <AndroidShellGuard />{/* ANDROID-LOCK: в Android-оболочке глушим переходы вне /connect */}
          <IdleAnimationGuard />{/* PERF-GPU: скрытое окно не должно грузить видеокарту */}
          <VoiceProvider>
            {/* CALL: личные звонки — вызов может прийти на любой странице, поэтому провайдер глобальный */}
            <CallProvider>
            <InlineEditProvider>
              {children}
              <InlineEditOverlay />
            </InlineEditProvider>
            </CallProvider>
            <VoiceMiniWidget />
            <VoiceOverlayBridge />{/* FIX-OVL */}
            <WelcomeModal />
            <ConfirmDialogHost />
          </VoiceProvider>
        </ConnectThemeProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
