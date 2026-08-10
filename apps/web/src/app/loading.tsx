import Spinner from "@/components/ui/Spinner";

export default function RootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="text-center">
        <Spinner size="xl" className="mx-auto mb-4" />
        <p className="text-neutral-400 text-sm">Загрузка...</p>
      </div>
    </div>
  );
}
