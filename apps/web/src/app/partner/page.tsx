"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import { alertDialog } from "@/components/ui/ConfirmDialog";
import { stageStatusLabel } from "@/lib/orderStages";
/* ARCHIVE: тот же механизм архива, что и у разговоров: копия файлом на
   устройство плюс скрытие записи из активного списка этого же устройства. Сам
   проект на сервере не трогается: за ним стоит работа администрации. */
import {
  ARCHIVE_EVENT,
  addToArchive,
  archiveFileName,
  downloadJson,
  lastActivityAt,
  readArchive,
  removeFromArchive,
} from "@/lib/localArchive";
import {
  FileChips,
  ProgressBar,
  ProjectChatLink,
  StatusChip,
  StepList,
  doneOf,
  filesOf,
  formatSize,
  progressOf,
  stagesOf,
  type ProjectFileItem,
  type ProjectItem,
} from "@/components/cabinet/ProjectWidgets";

// FIX-CABINET: «Партнёрская» переименована в «Личный кабинет». Добавлен раздел
// «Мои проекты»: список проектов с полоской прогресса, всплывающее окно
// добавления проекта (материалы не более 25 МБ на файл, название и назначение,
// домен) и переход в деловой чат с администрацией, которая ведёт заявку
// в /admin/projects.
//
// STAGES: этапы каждого проекта берутся из его УСЛУГИ. Поэтому услуга
// выбирается при создании и обязательна: без неё неизвестно, по каким этапам
// вести работу, и кабинет обещал бы всем подряд вёрстку и хостинг.

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 10;

/** Услуга в выпадающем списке добавления проекта. */
interface ServiceOption { id: string; title: string }

function OrdersIcon() {
  return <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>;
}

function ProjectsIcon() {
  return <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>;
}

// Всплывающее окно добавления проекта: материалы (до 25 МБ на файл),
// название, назначение и домен.
function AddProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: ProjectItem) => void }) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [domain, setDomain] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* Список услуг тот же, что и в заявке на сотрудничество: только включённые.
     Отключённую услугу заказать нельзя, значит и вести по ней проект незачем. */
  useEffect(() => {
    fetch("/api/services", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setServices(Array.isArray(d) ? d : []))
      .catch(() => setServices([]));
  }, []);

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length || uploading) return;
    setError("");
    setUploading(true);
    let count = files.length;
    try {
      for (const file of Array.from(list)) {
        if (count >= MAX_FILES) { setError(`Не более ${MAX_FILES} файлов на проект`); break; }
        if (file.size > MAX_FILE_SIZE) { setError(`«${file.name}»: файл больше 25 МБ`); continue; }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/projects/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok) { setError(data?.error || `Не удалось загрузить «${file.name}»`); continue; }
        count += 1;
        setFiles((prev) => [...prev, { url: data.url, name: data.name, size: data.size }]);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!name.trim() || !purpose.trim() || !serviceId || sending || uploading) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), purpose: purpose.trim(), domain: domain.trim(), serviceId, files }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось создать проект"); return; }
      if (data?.project) onCreated(data.project);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSending(false);
    }
  };

  const inputCls = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-violet-400 dark:border-white/10 dark:bg-neutral-950 dark:text-white dark:focus:border-cyan-400/60";

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-left shadow-2xl dark:border-white/10 dark:bg-neutral-900" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Добавить проект</h3>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">Заявка появится у администрации — прогресс будет виден здесь</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Закрыть">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-gray-400">Название проекта</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Например: интернет-магазин TrioZ" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-gray-400">Услуга</label>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputCls}>
              <option value="">Выберите услугу</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-gray-400">Назначение проекта</label>
            <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={2000} rows={3} placeholder="Для чего нужен проект, какие задачи он решает" className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-gray-400">Домен</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={120} placeholder="example.ru (если ещё нет — оставьте пустым)" className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-gray-400">Материалы по проекту <span className="text-neutral-400">(не более 25 МБ на файл)</span></label>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || files.length >= MAX_FILES} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-3 text-sm text-neutral-500 transition hover:border-violet-400 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-gray-400 dark:hover:border-cyan-400/60 dark:hover:text-cyan-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              {uploading ? "Загрузка…" : "Загрузить материалы"}
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.url}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 dark:border-white/10 dark:text-gray-300">
                    <span className="min-w-0 truncate">{f.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-neutral-400">{formatSize(f.size)}</span>
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-neutral-400 transition hover:text-red-500" aria-label={`Убрать файл ${f.name}`}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5">Отмена</button>
            <button type="button" onClick={() => void submit()} disabled={!name.trim() || !purpose.trim() || !serviceId || sending || uploading} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400">
              {sending ? "Создание…" : "Создать проект"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PartnerPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  const role = sessionUser?.role;
  const allowed = role === "CONSULTANT" || role === "ADMIN";
  const [mobileContentOpen, setMobileContentOpen] = useState(false);
  const [tab, setTab] = useState<"projects" | "orders">("projects");

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  /* ARCHIVE: убранные с этого устройства проекты, режим просмотра архива,
     контекстное меню по ПКМ и отметка текущей выгрузки. */
  const [archivedProjects, setArchivedProjects] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/signin");
    else if (status === "authenticated" && !allowed) router.replace("/connect");
  }, [status, allowed, router]);

  const fetchProjects = useCallback(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d.projects) ? d.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (status === "authenticated" && allowed) fetchProjects();
  }, [status, allowed, fetchProjects]);

  /* ARCHIVE: архив живёт в хранилище браузера, поэтому читаем его после
     монтирования, а не при первом расчёте: на сервере его просто нет. */
  useEffect(() => {
    const sync = () => setArchivedProjects(readArchive("project"));
    sync();
    window.addEventListener(ARCHIVE_EVENT, sync);
    return () => window.removeEventListener(ARCHIVE_EVENT, sync);
  }, []);

  // Меню закрывается от любого действия мимо него — как и в списке разговоров.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /**
   * ARCHIVE: выгрузка проекта файлом и уборка его из активного списка.
   *
   * Сначала файл, потом скрытие: если выгрузка не удалась, проект остаётся
   * на месте и человек не решит, что потерял его вместе с историей этапов.
   */
  const archiveProject = useCallback(async (project: ProjectItem) => {
    setMenu(null);
    setBusyId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}/export`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alertDialog(data.error || "Не удалось выгрузить проект");
        return;
      }
      downloadJson(archiveFileName("проект", project.name), await res.json());
      addToArchive("project", project.id);
      setOpenId((prev) => (prev === project.id ? null : prev));
    } catch {
      await alertDialog("Сеть недоступна: проект не выгружен и остался в списке");
    } finally {
      setBusyId(null);
    }
  }, []);

  /* ARCHIVE: порядок списка — по убыванию последнего взаимодействия. Сервер уже
     отдаёт их так, но после добавления проекта без перезагрузки порядок держится
     только на том, что новая запись приклеивается в начало. Явная сортировка
     делает правило одинаковым в любой момент. */
  const visibleProjects = useMemo(() => {
    const archivedSet = new Set(archivedProjects);
    return projects
      .filter((p) => (showArchived ? archivedSet.has(p.id) : !archivedSet.has(p.id)))
      .sort((a, b) => lastActivityAt(b.updatedAt, b.createdAt) - lastActivityAt(a.updatedAt, a.createdAt));
  }, [projects, archivedProjects, showArchived]);

  if (status === "loading" || (status === "authenticated" && !allowed)) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (!allowed) return null;

  /* ARCHIVE: счётчики считают то, что видно в списке. Иначе «Всего: 8» над тремя
     строками выглядело бы как ошибка загрузки. */
  const total = visibleProjects.length;
  const launched = visibleProjects.filter((p) => progressOf(p) >= 100 || p.status === "LAUNCHED").length;
  const inWork = visibleProjects.filter((p) => { const pr = progressOf(p); return pr > 0 && pr < 100 && p.status !== "LAUNCHED"; }).length;

  const navItemCls = (active: boolean) => active
    ? "flex w-full items-center gap-3 rounded-xl bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-700 dark:bg-cyan-500/10 dark:text-cyan-300"
    : "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:text-gray-300 dark:hover:bg-white/5";
  const navIconCls = (active: boolean) => active ? "text-violet-600 dark:text-cyan-400" : "text-neutral-400 dark:text-gray-500";

  return (
    <div className="min-h-screen bg-neutral-50 px-4 pb-12 pt-8 dark:bg-neutral-950 max-md:px-3">
      <div className="mx-auto max-w-5xl md:flex md:gap-6">
        <aside className={`md:w-64 md:flex-shrink-0 ${mobileContentOpen ? "hidden md:block" : "block"}`}>
          <div className="md:sticky md:top-8">
            <div className="mb-4 flex items-center gap-3 px-1">
              <Link href="/connect" className="text-neutral-500 transition-opacity hover:opacity-70 dark:text-gray-400" aria-label="Назад в TZ Connect">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </Link>
              <div><h1 className="text-xl font-bold text-neutral-900 dark:text-white">Личный кабинет</h1><p className="text-xs text-neutral-500 dark:text-gray-400">Ваш кабинет клиента TrioZ</p></div>
            </div>
            <nav className="space-y-0.5">
              <button onClick={() => { setTab("projects"); setMobileContentOpen(true); }} className={navItemCls(tab === "projects")}>
                <span className={navIconCls(tab === "projects")}><ProjectsIcon /></span>Мои проекты
              </button>
              <button onClick={() => { setTab("orders"); setMobileContentOpen(true); }} className={navItemCls(tab === "orders")}>
                <span className={navIconCls(tab === "orders")}><OrdersIcon /></span>Заказы
              </button>
            </nav>
          </div>
        </aside>

        <main className={`min-w-0 flex-1 ${mobileContentOpen ? "block" : "hidden md:block"}`}>
          <button onClick={() => setMobileContentOpen(false)} className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-gray-300 md:hidden">← {tab === "projects" ? "Мои проекты" : "Заказы"}</button>

          {tab === "projects" ? (
            <motion.div key="projects" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
                {[["Всего", total], ["В работе", inWork], ["Запущено", launched]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
                    <p className="text-2xl font-bold text-neutral-900 dark:text-white">{value}</p><p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">{label}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-900">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-white/10">
                  <div>
                    <h2 className="font-semibold text-neutral-900 dark:text-white">{showArchived ? "Архив проектов" : "Мои проекты"}</h2>
                    <p className="text-xs text-neutral-500 dark:text-gray-400">
                      {showArchived
                        ? "Убраны с этого устройства — в работе у администрации они остаются"
                        : "Активные проекты и заявки в работе · правая кнопка мыши — архив"}
                    </p>
                  </div>
                  {/* ARCHIVE: переключатель архива появляется только когда там что-то есть. */}
                  {(archivedProjects.length > 0 || showArchived) && (
                    <button
                      onClick={() => setShowArchived((v) => !v)}
                      className="ml-auto mr-1 flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      {showArchived ? "К активным" : `Архив (${archivedProjects.length})`}
                    </button>
                  )}
                  <button onClick={() => setShowAdd(true)} className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                    Добавить проект
                  </button>
                </div>

                {loadingProjects ? (
                  <div className="grid min-h-72 place-items-center px-6 py-12"><Spinner /></div>
                ) : visibleProjects.length === 0 ? (
                  <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
                    <div>
                      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400"><ProjectsIcon /></div>
                      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{showArchived ? "В архиве пусто" : "Проектов пока нет"}</p>
                      <p className="mt-1 max-w-sm text-xs text-neutral-400">{showArchived ? "Здесь окажутся проекты, скачанные файлом и убранные из активного списка." : "Добавьте текущий проект — заявка появится у администрации, а здесь будет виден прогресс вплоть до запуска."}</p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-200 dark:divide-white/10">
                    {visibleProjects.map((p) => {
                      const stages = stagesOf(p);
                      const done = doneOf(p, stages);
                      const progress = progressOf(p, stages);
                      const isOpen = openId === p.id;
                      return (
                        <div
                          key={p.id}
                          /* ARCHIVE: ПКМ по строке проекта — то же место действий, что и в
                             списке разговоров. */
                          onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }); }}
                        >
                          <button onClick={() => setOpenId(isOpen ? null : p.id)} className="w-full px-5 py-4 text-left transition hover:bg-neutral-50 dark:hover:bg-white/5">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate font-medium text-neutral-900 dark:text-white">{p.name}</p>
                                <StatusChip status={p.status} progress={progress} />
                              </div>
                              <span className="flex-shrink-0 text-xs text-neutral-400">{p.service?.title || p.domain}</span>
                            </div>
                            <ProgressBar value={progress} label={stageStatusLabel(progress, p.status, stages)} />
                          </button>
                          {isOpen && (
                            <div className="space-y-4 border-t border-neutral-200 bg-neutral-50/50 px-5 py-4 dark:border-white/10 dark:bg-white/[.02]">
                              <div>
                                <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-gray-400">Назначение</p>
                                <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">{p.purpose}</p>
                              </div>
                              <div>
                                <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-gray-400">Материалы</p>
                                <FileChips files={filesOf(p)} />
                              </div>
                              <div>
                                <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-gray-400">Этапы работы — заполняет администратор или редактор</p>
                                <StepList stages={stages} done={done} />
                              </div>
                              <ProjectChatLink projectId={p.id} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="orders" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Новых", 0], ["В работе", 0], ["Завершено", 0], ["Всего", 0]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
                    <p className="text-2xl font-bold text-neutral-900 dark:text-white">{value}</p><p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">{label}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-900">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-white/10">
                  <div><h2 className="font-semibold text-neutral-900 dark:text-white">Заказы партнёра</h2><p className="text-xs text-neutral-500 dark:text-gray-400">Назначенные вам клиентские заказы</p></div>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500 dark:bg-white/10 dark:text-gray-400">0 заказов</span>
                </div>
                <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
                  <div><div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400"><OrdersIcon /></div><p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Заказов пока нет</p><p className="mt-1 max-w-sm text-xs text-neutral-400">Структура заказа, статусы и действия будут подключены после описания бизнес-процесса.</p></div>
                </div>
              </div>
            </motion.div>
          )}
        </main>
      </div>

      {/* ARCHIVE: контекстное меню проекта. Безвозвратного удаления здесь нет
          сознательно: проект — это заявка, которую ведёт администрация, и его удаление
          одной стороной стёрло бы чужую работу. */}
      {menu && (
        <div
          className="fixed z-[100] min-w-[220px] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-white/10 dark:bg-neutral-900"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {archivedProjects.includes(menu.id) ? (
            <button
              type="button"
              onClick={() => { removeFromArchive("project", menu.id); setMenu(null); }}
              className="w-full px-3 py-2 text-left text-neutral-700 transition hover:bg-neutral-100 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Вернуть из архива
            </button>
          ) : (
            <button
              type="button"
              disabled={busyId === menu.id}
              onClick={() => { const p = projects.find((x) => x.id === menu.id); if (p) archiveProject(p); }}
              className="w-full px-3 py-2 text-left text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-white/5"
            >
              {busyId === menu.id ? "Выгружаем…" : "В архив (скачать файл)"}
            </button>
          )}
        </div>
      )}

      {showAdd && (
        <AddProjectModal
          onClose={() => setShowAdd(false)}
          onCreated={(p) => { setShowAdd(false); setProjects((prev) => [p, ...prev]); setOpenId(p.id); }}
        />
      )}
    </div>
  );
}
