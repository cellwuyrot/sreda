/* ══════════════════════════════════════════════════════════════════════════
   REG-VALIDATE: проверки регистрации ДО отправки кода подтверждения
   ══════════════════════════════════════════════════════════════════════════

   Раньше имя, логин и пароль проверялись внутри `sendCode`: человек заполнял
   форму, жал «Получить код», и только тогда узнавал, что логину нужна цифра.
   Хуже того, часть требований жила только на сервере — письмо с кодом уже
   ушло, а регистрация всё равно падала на следующем шаге.

   Здесь собраны все требования к полям в одном месте и в виде данных, а не
   ветвлений: форма показывает их списком с галочками, кнопка «Получить код»
   недоступна, пока хоть одно не закрыто, и тот же модуль переиспользует
   серверный маршрут регистрации. Одно требование — одна строка в списке.

   Сообщения намеренно написаны как требования («Логин: минимум одна цифра»),
   а не как упрёки: список висит перед человеком постоянно, пока он печатает. */

export const NAME_MIN = 2;
export const NAME_MAX = 32;
export const USERNAME_MIN = 6;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Одно требование к полю: подпись и признак выполнения. */
export interface Requirement {
	id: string;
	label: string;
	ok: boolean;
}

export interface FieldCheck {
	/** Все требования закрыты. */
	valid: boolean;
	/** Первое незакрытое требование — его показываем текстом ошибки. */
	error: string | null;
	/** Пусто, пока поле не тронули: пустая форма не должна краснеть. */
	touchedValid: boolean;
	requirements: Requirement[];
}

/* Имя человека, а не логин: буквы любого алфавита, пробел, дефис, апостроф.
   Цифры и знаки запрещены — иначе «имя» превращается во второй никнейм. */
const NAME_SHAPE = /^[\p{L}][\p{L} '’-]*$/u;
const USERNAME_SHAPE = /^[a-zA-Z0-9_]+$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

function finish(value: string, reqs: Requirement[]): FieldCheck {
	const failed = reqs.find((r) => !r.ok) ?? null;
	const valid = !failed;
	return {
		valid,
		error: failed ? failed.label : null,
		touchedValid: value.length === 0 ? true : valid,
		requirements: reqs,
	};
}

export function checkName(raw: string): FieldCheck {
	const v = (raw ?? "").trim();
	return finish(v, [
		{ id: "len", label: `Имя: от ${NAME_MIN} до ${NAME_MAX} символов`, ok: v.length >= NAME_MIN && v.length <= NAME_MAX },
		{ id: "shape", label: "Имя: только буквы, пробел и дефис", ok: v.length === 0 ? false : NAME_SHAPE.test(v) },
		{ id: "double", label: "Имя: без двойных пробелов", ok: !/\s{2,}/.test(v) },
	]);
}

export function checkUsername(raw: string): FieldCheck {
	const v = (raw ?? "").trim();
	return finish(v, [
		{ id: "len", label: `Логин: от ${USERNAME_MIN} до ${USERNAME_MAX} символов`, ok: v.length >= USERNAME_MIN && v.length <= USERNAME_MAX },
		{ id: "shape", label: "Логин: латиница, цифры и _", ok: v.length === 0 ? false : USERNAME_SHAPE.test(v) },
		{ id: "digit", label: "Логин: минимум одна цифра", ok: /\d/.test(v) },
		{ id: "letter", label: "Логин: начинается с латинской буквы", ok: /^[a-zA-Z]/.test(v) },
	]);
}

/**
 * Пароль. Логин и почта передаются, чтобы отсечь самый частый плохой пароль —
 * копию собственного логина: серверу он тоже не понравится, но узнать об этом
 * лучше здесь.
 */
export function checkPassword(raw: string, opts?: { username?: string; email?: string }): FieldCheck {
	const v = raw ?? "";
	const username = (opts?.username ?? "").trim().toLowerCase();
	const emailLocal = (opts?.email ?? "").trim().toLowerCase().split("@")[0] ?? "";
	const lower = v.toLowerCase();
	return finish(v, [
		{ id: "len", label: `Пароль: от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`, ok: v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX },
		{ id: "lower", label: "Пароль: строчная буква", ok: /\p{Ll}/u.test(v) },
		{ id: "upper", label: "Пароль: заглавная буква", ok: /\p{Lu}/u.test(v) },
		{ id: "digit", label: "Пароль: цифра", ok: /\d/.test(v) },
		{ id: "space", label: "Пароль: без пробелов", ok: v.length === 0 ? false : !/\s/.test(v) },
		{
			id: "unique",
			label: "Пароль: не совпадает с логином или почтой",
			ok: v.length === 0 ? false : !(username.length >= 3 && lower.includes(username)) && !(emailLocal.length >= 3 && lower.includes(emailLocal)),
		},
	]);
}

export function checkEmail(raw: string): FieldCheck {
	const v = (raw ?? "").trim();
	return finish(v, [
		{ id: "shape", label: "Почта: вида name@example.com", ok: EMAIL_SHAPE.test(v) },
		{ id: "len", label: "Почта: до 190 символов", ok: v.length > 0 && v.length <= 190 },
	]);
}

export interface RegisterValues {
	name: string;
	username: string;
	email: string;
	password: string;
}

export interface RegisterChecks {
	name: FieldCheck;
	username: FieldCheck;
	email: FieldCheck;
	password: FieldCheck;
	/** Можно запрашивать код подтверждения. */
	ready: boolean;
	/** Первое незакрытое требование по порядку полей формы. */
	firstError: string | null;
}

export function checkRegister(values: RegisterValues): RegisterChecks {
	const name = checkName(values.name);
	const username = checkUsername(values.username);
	const email = checkEmail(values.email);
	const password = checkPassword(values.password, { username: values.username, email: values.email });
	const ready = name.valid && username.valid && email.valid && password.valid;
	const firstError = name.error ?? username.error ?? email.error ?? password.error ?? null;
	return { name, username, email, password, ready, firstError };
}

/** Грубая оценка пароля для полоски силы: 0…4. */
export function passwordStrength(raw: string): number {
	const v = raw ?? "";
	if (!v) return 0;
	let score = 0;
	if (v.length >= PASSWORD_MIN) score += 1;
	if (v.length >= 12) score += 1;
	if (/\p{Lu}/u.test(v) && /\p{Ll}/u.test(v) && /\d/.test(v)) score += 1;
	if (/[^\p{L}\d]/u.test(v)) score += 1;
	return Math.min(4, score);
}
