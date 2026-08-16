import BrandLoader from "@/components/ui/BrandLoader";

export default function RootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="text-center">
        {/* BRAND-LOADER: кольцо здесь было 40 px и пустым внутри. Сохраняем внешний
            диаметр 40 px, чтобы верстка не дёрнулась: круг 28 px плюс зазор по 6 px. */}
        <BrandLoader size={28} gap={6} className="mx-auto mb-4" />
        <p className="text-neutral-400 text-sm">Загрузка...</p>
      </div>
    </div>
  );
}
