"use client";

import dynamic from "next/dynamic";
import { useTheme } from "@/components/Providers";

const Topography = dynamic(() => import("./Topography"), { ssr: false });
const ParticleImage = dynamic(() => import("./ParticleImage"), { ssr: false });

export default function ConnectWelcome({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const { theme } = useTheme();
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[#070a12]">
      <div className="absolute inset-0" aria-hidden="true">
        {theme === "mono" ? (
          <ParticleImage style={{ width: "100%", height: "100%" }} hoverEnabled={false} />
        ) : (
          <Topography dpr={0.75} glow={0.2} depthOfField={0.15} speed={0.15} morph={0.12} />
        )}
      </div>
      <div className="absolute bottom-6 inset-x-0 z-10 flex flex-wrap gap-3 justify-center px-4">
        <button type="button" onClick={onCreate} className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Создать пространство</button>
        <button type="button" onClick={onJoin} className="rounded-xl border border-white/30 bg-slate-950/90 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Присоединиться</button>
      </div>
    </div>
  );
}
