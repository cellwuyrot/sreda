"use client";

import CnnctElectricLogo from "./CnnctElectricLogo";
import { cnnctElectricLogoConfig } from "./electricLogoConfig";
import { useTheme } from "@/components/Providers";

export default function ConnectWelcome({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const { theme } = useTheme();
  return (
    <div
      className={`relative flex-1 min-h-0 overflow-hidden ${
        theme === "mono" ? "bg-black" : "bg-gradient-to-br from-black via-[#020916] to-[#061429]"
      }`}
      data-welcome-background={theme === "mono" ? "black" : "dark-gradient"}
    >
      <div className="absolute inset-0 flex items-center justify-center pb-16"><CnnctElectricLogo {...cnnctElectricLogoConfig} /></div>
      <div className="tz-micro-enter absolute bottom-6 inset-x-0 z-10 flex flex-wrap gap-3 justify-center px-4">
        <button type="button" onClick={onCreate} className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Создать пространство</button>
        <button type="button" onClick={onJoin} className="rounded-xl border border-white/30 bg-slate-950/90 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Присоединиться</button>
      </div>
    </div>
  );
}
