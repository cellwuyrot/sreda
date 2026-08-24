"use client";

/* GROUP-SKIN: редактор оформления сообщества (раздел «Дизайн»).

   Доступен создателю и администраторам. Состояние правится локально и
   отправляется одним PUT по кнопке: автосохранение на каждый ползунок завалило бы
   сервер записями и спамом в журнале действий.

   Превью рисуется теми же функциями (`surfaceLayer`, `bannerCss`), что и боевой слой —
   иначе картинка в настройках расходилась бы с реальным видом группы. */

import { useMemo, useRef, useState } from "react";
import {
	FIT_OPTIONS,
	GROUP_FONTS,
	GROUP_PRESETS,
	PARTICLE_OPTIONS,
	SURFACE_MODE_OPTIONS,
	bannerCss,
	defaultGroupTheme,
	fontStack,
	hexToRgba,
	parseGroupTheme,
	serializeGroupTheme,
	surfaceLayer,
	surfaceRepeat,
	surfaceSize,
	type GroupBannerCfg,
	type GroupSurface,
	type GroupTheme,
	type SurfaceFit,
	type SurfaceMode,
} from "@/lib/groupTheme";
import ParticleField from "../ParticleField";
import { alertDialog } from "@/components/ui/ConfirmDialog";

interface Props {
	groupId: string;
	/** Сырое значение `Group.theme` из карточки сообщества. */
	theme: string | null | undefined;
	/** Сообщить родителю о сохранённом оформлении, чтобы вид обновился без перезагрузки. */
	onSaved?: (theme: string) => void;
}

const LABEL = "text-[11px] uppercase tracking-wide text-white/40";
const CARD = "rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3";
const BTN = "px-3 py-1.5 rounded-lg text-xs transition";

/** Баннер и фоны в data URL раздувают запись в базе, поэтому потолок скромный. */
const MAX_UPLOAD = 600 * 1024;

function Slider({
	label,
	value,
	min,
	max,
	step = 1,
	suffix = "",
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	suffix?: string;
	onChange: (v: number) => void;
}) {
	return (
		<label className="block">
			<span className="flex items-center justify-between text-xs text-white/60">
				<span>{label}</span>
				<span className="tabular-nums text-white/40">
					{value}
					{suffix}
				</span>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="mt-1 w-full accent-[var(--cn-accent)]"
			/>
		</label>
	);
}

function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
	return (
		<label className="flex items-center gap-2 text-xs text-white/60">
			<input
				type="color"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent p-0"
			/>
			<span>{label}</span>
		</label>
	);
}

function Toggle({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onChange(!value)}
			className="flex w-full items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left transition hover:bg-white/[0.05]"
		>
			<span>
				<span className="block text-sm text-white/80">{label}</span>
				{hint ? <span className="block text-[11px] leading-snug text-white/40">{hint}</span> : null}
			</span>
			<span
				className={`mt-0.5 h-5 w-9 flex-shrink-0 rounded-full p-0.5 transition ${value ? "bg-[var(--cn-accent)]" : "bg-white/15"}`}
			>
				<span className={`block h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-4" : ""}`} />
			</span>
		</button>
	);
}

/** Редактор одной поверхности: чат, текстовые каналы или голосовые. */
function SurfaceEditor({
	title,
	hint,
	surface,
	onChange,
}: {
	title: string;
	hint: string;
	surface: GroupSurface;
	onChange: (patch: Partial<GroupSurface>) => void;
}) {
	const fileRef = useRef<HTMLInputElement | null>(null);

	const pickImage = (file: File | null | undefined) => {
		if (!file) return;
		if (file.size > MAX_UPLOAD) {
			void alertDialog(`Файл больше ${Math.round(MAX_UPLOAD / 1024)} КБ. Выберите картинку поменьше или укажите ссылку.`);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => onChange({ image: String(reader.result || ""), mode: "image" });
		reader.readAsDataURL(file);
	};

	const preview = useMemo(
		() => ({
			backgroundImage: surfaceLayer(surface),
			backgroundSize: surfaceSize(surface),
			backgroundRepeat: surfaceRepeat(surface),
			backgroundPosition: "center",
		}),
		[surface],
	);

	return (
		<div className={CARD}>
			<div>
				<div className="text-sm text-white/85">{title}</div>
				<div className="text-[11px] leading-snug text-white/40">{hint}</div>
			</div>

			<div className="flex flex-wrap gap-1.5">
				{SURFACE_MODE_OPTIONS.map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange({ mode: opt.value as SurfaceMode })}
						className={`${BTN} ${
							surface.mode === opt.value
								? "bg-[var(--cn-accent)] text-white"
								: "border border-white/10 text-white/60 hover:bg-white/5"
						}`}
					>
						{opt.label}
					</button>
				))}
			</div>

			{surface.mode === "solid" ? <ColorPick label="Цвет фона" value={surface.color} onChange={(v) => onChange({ color: v })} /> : null}

			{surface.mode === "gradient" ? (
				<div className="space-y-2">
					<div className="flex flex-wrap gap-3">
						<ColorPick label="Начало" value={surface.from} onChange={(v) => onChange({ from: v })} />
						{surface.useVia ? (
							<ColorPick label="Середина" value={surface.via} onChange={(v) => onChange({ via: v })} />
						) : null}
						<ColorPick label="Конец" value={surface.to} onChange={(v) => onChange({ to: v })} />
					</div>
					<Toggle label="Три цвета" value={surface.useVia} onChange={(v) => onChange({ useVia: v })} />
					<Slider label="Угол" value={surface.angle} min={0} max={360} suffix="°" onChange={(v) => onChange({ angle: v })} />
				</div>
			) : null}

			{surface.mode === "image" ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<button type="button" onClick={() => fileRef.current?.click()} className={`${BTN} border border-white/10 text-white/70 hover:bg-white/5`}>
							Загрузить
						</button>
						{surface.image ? (
							<button type="button" onClick={() => onChange({ image: "" })} className={`${BTN} text-red-300 hover:bg-red-500/10`}>
								Убрать
							</button>
						) : null}
						<input
							ref={fileRef}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							className="hidden"
							onChange={(e) => pickImage(e.target.files?.[0])}
						/>
					</div>
					<input
						type="url"
						value={surface.image.startsWith("data:") ? "" : surface.image}
						placeholder="или ссылка https://…"
						onChange={(e) => onChange({ image: e.target.value })}
						className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80 outline-none focus:border-white/25"
					/>
					<div className="flex flex-wrap gap-1.5">
						{FIT_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								type="button"
								onClick={() => onChange({ fit: opt.value as SurfaceFit })}
								className={`${BTN} ${
									surface.fit === opt.value ? "bg-white/15 text-white" : "border border-white/10 text-white/60 hover:bg-white/5"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
					<Slider label="Затемнение" value={surface.dim} min={0} max={85} suffix="%" onChange={(v) => onChange({ dim: v })} />
				</div>
			) : null}

			{surface.mode !== "theme" ? (
				<div className="h-16 rounded-lg border border-white/10" style={preview} />
			) : (
				<div className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/35">
					Останется фон темы — включая личное оформление участника.
				</div>
			)}
		</div>
	);
}

function BannerEditor({ banner, onChange }: { banner: GroupBannerCfg; onChange: (patch: Partial<GroupBannerCfg>) => void }) {
	const fileRef = useRef<HTMLInputElement | null>(null);

	const pick = (file: File | null | undefined) => {
		if (!file) return;
		if (file.size > MAX_UPLOAD) {
			void alertDialog(
				`Файл больше ${Math.round(MAX_UPLOAD / 1024)} КБ. Для видео-баннера укажите ссылку https:// — видео в базу не кладётся.`,
			);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => onChange({ url: String(reader.result || ""), kind: "image" });
		reader.readAsDataURL(file);
	};

	return (
		<div className={CARD}>
			<div>
				<div className="text-sm text-white/85">Баннер сообщества</div>
				<div className="text-[11px] leading-snug text-white/40">
					Картинка, GIF, живой градиент или видео по ссылке (mp4/webm, без звука).
				</div>
			</div>

			<div className="flex flex-wrap gap-1.5">
				{[
					{ value: "none", label: "Нет" },
					{ value: "image", label: "Картинка" },
					{ value: "gradient", label: "Градиент" },
					{ value: "video", label: "Видео" },
				].map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange({ kind: opt.value as GroupBannerCfg["kind"] })}
						className={`${BTN} ${
							banner.kind === opt.value ? "bg-[var(--cn-accent)] text-white" : "border border-white/10 text-white/60 hover:bg-white/5"
						}`}
					>
						{opt.label}
					</button>
				))}
			</div>

			{banner.kind === "image" ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<button type="button" onClick={() => fileRef.current?.click()} className={`${BTN} border border-white/10 text-white/70 hover:bg-white/5`}>
							Загрузить
						</button>
						<input
							ref={fileRef}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							className="hidden"
							onChange={(e) => pick(e.target.files?.[0])}
						/>
						<span className="text-[11px] text-white/35">GIF анимируется сам</span>
					</div>
					<input
						type="url"
						value={banner.url.startsWith("data:") ? "" : banner.url}
						placeholder="или ссылка https://…"
						onChange={(e) => onChange({ url: e.target.value })}
						className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80 outline-none focus:border-white/25"
					/>
				</div>
			) : null}

			{banner.kind === "video" ? (
				<input
					type="url"
					value={banner.url}
					placeholder="https://…/banner.mp4"
					onChange={(e) => onChange({ url: e.target.value })}
					className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80 outline-none focus:border-white/25"
				/>
			) : null}

			{banner.kind === "gradient" ? (
				<div className="space-y-2">
					<div className="flex flex-wrap gap-3">
						<ColorPick label="Начало" value={banner.from} onChange={(v) => onChange({ from: v })} />
						{banner.useVia ? <ColorPick label="Середина" value={banner.via} onChange={(v) => onChange({ via: v })} /> : null}
						<ColorPick label="Конец" value={banner.to} onChange={(v) => onChange({ to: v })} />
					</div>
					<Toggle label="Три цвета" value={banner.useVia} onChange={(v) => onChange({ useVia: v })} />
					<Slider label="Угол" value={banner.angle} min={0} max={360} suffix="°" onChange={(v) => onChange({ angle: v })} />
				</div>
			) : null}

			{banner.kind !== "none" ? (
				<>
					<Toggle
						label="Анимация"
						hint="Градиент плывёт, видео играет. Участникам с «уменьшением анимации» покажется статика."
						value={banner.animated}
						onChange={(v) => onChange({ animated: v })}
					/>
					<Slider label="Затемнение под названием" value={banner.overlay} min={0} max={85} suffix="%" onChange={(v) => onChange({ overlay: v })} />
					<div
						className="relative h-20 overflow-hidden rounded-lg border border-white/10"
						style={{ backgroundImage: bannerCss(banner), backgroundSize: "cover", backgroundPosition: "center" }}
					>
						{banner.kind === "video" && banner.url ? (
							<video src={banner.url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
						) : null}
						<div className="absolute inset-0" style={{ background: hexToRgba("#000000", banner.overlay / 100) }} />
						<div className="absolute bottom-2 left-3 text-sm font-medium text-white/90">Превью баннера</div>
					</div>
				</>
			) : null}
		</div>
	);
}

export default function DesignPanel({ groupId, theme, onSaved }: Props) {
	const initial = useMemo(() => parseGroupTheme(theme ?? null), [theme]);
	const [draft, setDraft] = useState<GroupTheme>(initial);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	/* Любая правка сразу включает оформление. Раньше можно было собрать тему,
	   нажать «Сохранить» и не увидеть ничего: верхний тумблер оставался выключенным.
	   Выключить тему по-прежнему можно — тем же тумблером или кнопкой сброса. */
	const patch = (p: Partial<GroupTheme>) => {
		setDraft((d) => ({ ...d, ...p, preset: "custom", enabled: true }));
		setSaved(false);
	};

	const save = async () => {
		setSaving(true);
		try {
			const payload = serializeGroupTheme(draft);
			const res = await fetch(`/api/groups/${groupId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ theme: payload }),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				await alertDialog(data.error || "Не удалось сохранить оформление");
				return;
			}
			setSaved(true);
			onSaved?.(payload);
		} catch {
			await alertDialog("Сеть недоступна. Повторите позже.");
		} finally {
			setSaving(false);
		}
	};

	const reset = () => {
		setDraft(defaultGroupTheme());
		setSaved(false);
	};

	const previewFont = fontStack(draft.font);

	return (
		<div className="space-y-4">
			<div className={CARD}>
				<Toggle
					label="Оформление сообщества"
					hint="Выключено — участники видят обычную тему и своё личное оформление."
					value={draft.enabled}
					onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
				/>
				<Toggle
					label="Главнее личного оформления"
					hint="Включено — внутри сообщества фон группы перекрывает Premium-скин участника."
					value={draft.priority}
					onChange={(v) => patch({ priority: v })}
				/>
			</div>

			<div className={CARD}>
				<div className={LABEL}>Пресеты</div>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{GROUP_PRESETS.map((p) => (
						<button
							key={p.id}
							type="button"
							title={p.hint}
							onClick={() => {
								setDraft({ ...p.build(), enabled: true });
								setSaved(false);
							}}
							className={`rounded-xl border p-2 text-left transition ${
								draft.preset === p.id ? "border-[var(--cn-accent)] bg-white/[0.06]" : "border-white/10 hover:bg-white/5"
							}`}
						>
							<span
								className="mb-1.5 block h-8 rounded-lg"
								style={{ backgroundImage: `linear-gradient(120deg, ${p.swatch[0]}, ${p.swatch[1]}, ${p.swatch[2]})` }}
							/>
							<span className="block text-xs text-white/80">{p.label}</span>
							<span className="block text-[10px] leading-snug text-white/35">{p.hint}</span>
						</button>
					))}
				</div>
				<p className="text-[11px] text-white/35">Пресет — только стартовая точка: любой параметр ниже можно поменять.</p>
			</div>

			<SurfaceEditor
				title="Область переписки"
				hint="Фон чата внутри сообщества."
				surface={draft.chat}
				onChange={(p) => patch({ chat: { ...draft.chat, ...p } })}
			/>
			<SurfaceEditor
				title="Текстовые каналы"
				hint="Боковая панель со списком каналов."
				surface={draft.channels}
				onChange={(p) => patch({ channels: { ...draft.channels, ...p } })}
			/>
			<SurfaceEditor
				title="Голосовые каналы"
				hint="Список голосовых комнат и панель участников звонка."
				surface={draft.voice}
				onChange={(p) => patch({ voice: { ...draft.voice, ...p } })}
			/>

			<div className={CARD}>
				<div className="text-sm text-white/85">Акцент и шрифт</div>
				<Toggle
					label="Свой акцентный цвет"
					hint="Кнопки, активные каналы, выделения."
					value={draft.useAccent}
					onChange={(v) => patch({ useAccent: v })}
				/>
				{draft.useAccent ? <ColorPick label="Акцент" value={draft.accent} onChange={(v) => patch({ accent: v })} /> : null}

				<div className="flex flex-wrap gap-1.5">
					<button
						type="button"
						onClick={() => patch({ font: { ...draft.font, mode: "theme" } })}
						className={`${BTN} ${
							draft.font.mode === "theme" ? "bg-white/15 text-white" : "border border-white/10 text-white/60 hover:bg-white/5"
						}`}
					>
						Шрифт темы
					</button>
					<button
						type="button"
						onClick={() => patch({ font: { ...draft.font, mode: "builtin" } })}
						className={`${BTN} ${
							draft.font.mode === "builtin" ? "bg-white/15 text-white" : "border border-white/10 text-white/60 hover:bg-white/5"
						}`}
					>
						Шрифт сообщества
					</button>
				</div>

				{draft.font.mode === "builtin" ? (
					<div className="space-y-2">
						<select
							value={draft.font.family}
							onChange={(e) => patch({ font: { ...draft.font, family: e.target.value } })}
							className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80 outline-none focus:border-white/25"
						>
							{GROUP_FONTS.map((f) => (
								<option key={f.id} value={f.id} className="bg-[#15151c]">
									{f.label}
								</option>
							))}
						</select>
						<Slider
							label="Размер текста"
							value={draft.font.scale}
							min={90}
							max={115}
							suffix="%"
							onChange={(v) => patch({ font: { ...draft.font, scale: v } })}
						/>
						<div
							className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/75"
							style={{ fontFamily: previewFont || undefined, fontSize: `${draft.font.scale}%` }}
						>
							Съешь ещё этих мягких французских булок — The quick brown fox 0123456789
						</div>
					</div>
				) : null}
			</div>

			<BannerEditor banner={draft.banner} onChange={(p) => patch({ banner: { ...draft.banner, ...p } })} />

			<div className={CARD}>
				<div>
					<div className="text-sm text-white/85">Частицы</div>
					<div className="text-[11px] leading-snug text-white/40">
						Фоновый слой поверх интерфейса. Не перехватывает клики и не мешает чтению.
					</div>
				</div>

				<div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
					{PARTICLE_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							title={opt.hint}
							onClick={() => patch({ particles: { ...draft.particles, kind: opt.value } })}
							className={`${BTN} ${
								draft.particles.kind === opt.value
									? "bg-[var(--cn-accent)] text-white"
									: "border border-white/10 text-white/60 hover:bg-white/5"
							}`}
						>
							{opt.label}
						</button>
					))}
				</div>

				{draft.particles.kind !== "none" ? (
					<div className="space-y-2">
						<Slider
							label="Плотность"
							value={draft.particles.density}
							min={5}
							max={100}
							suffix="%"
							onChange={(v) => patch({ particles: { ...draft.particles, density: v } })}
						/>
						<Slider
							label="Скорость"
							value={draft.particles.speed}
							min={20}
							max={200}
							suffix="%"
							onChange={(v) => patch({ particles: { ...draft.particles, speed: v } })}
						/>
						<Slider
							label="Размер"
							value={draft.particles.size}
							min={1}
							max={16}
							onChange={(v) => patch({ particles: { ...draft.particles, size: v } })}
						/>
						<Slider
							label="Прозрачность"
							value={draft.particles.opacity}
							min={5}
							max={60}
							suffix="%"
							onChange={(v) => patch({ particles: { ...draft.particles, opacity: v } })}
						/>
						<ColorPick
							label="Цвет частиц"
							value={draft.particles.color}
							onChange={(v) => patch({ particles: { ...draft.particles, color: v } })}
						/>
						<Toggle
							label="Реагировать на курсор"
							hint="Частицы разлетаются от указателя мыши."
							value={draft.particles.interactive}
							onChange={(v) => patch({ particles: { ...draft.particles, interactive: v } })}
						/>

						<div
							className="relative h-28 overflow-hidden rounded-lg border border-white/10"
							style={{
								backgroundImage: draft.chat.mode === "theme" ? "linear-gradient(#101018, #101018)" : surfaceLayer(draft.chat),
								backgroundSize: surfaceSize(draft.chat),
								backgroundRepeat: surfaceRepeat(draft.chat),
								backgroundPosition: "center",
							}}
						>
							<ParticleField particles={draft.particles} inline />
							<div className="absolute bottom-2 left-3 text-[11px] text-white/50">Превью над фоном чата</div>
						</div>
					</div>
				) : null}
			</div>

			<div className="flex flex-wrap items-center gap-2 pt-1">
				<button
					type="button"
					onClick={() => void save()}
					disabled={saving}
					className="rounded-lg bg-[var(--cn-accent)] px-4 py-2 text-sm text-white transition disabled:opacity-50"
				>
					{saving ? "Сохранение…" : "Сохранить оформление"}
				</button>
				<button
					type="button"
					onClick={reset}
					className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5"
				>
					Сбросить
				</button>
				{saved ? <span className="text-xs text-emerald-300">Сохранено</span> : null}
			</div>
		</div>
	);
}
