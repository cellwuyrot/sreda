// Справочник городов → IANA таймзоны.
// Используется и в настройках профиля (выбор города), и на приветственном
// экране /connect (часы города пользователя). Единый источник правды.

export const CITY_TIMEZONES: Record<string, string> = {
  "Москва": "Europe/Moscow",
  "Санкт-Петербург": "Europe/Moscow",
  "Калининград": "Europe/Kaliningrad",
  "Самара": "Europe/Samara",
  "Екатеринбург": "Asia/Yekaterinburg",
  "Омск": "Asia/Omsk",
  "Новосибирск": "Asia/Novosibirsk",
  "Красноярск": "Asia/Krasnoyarsk",
  "Иркутск": "Asia/Irkutsk",
  "Якутск": "Asia/Yakutsk",
  "Владивосток": "Asia/Vladivostok",
  "Магадан": "Asia/Magadan",
  "Камчатка": "Asia/Kamchatka",
  "Минск": "Europe/Minsk",
  "Киев": "Europe/Kyiv",
  "Алматы": "Asia/Almaty",
  "Ташкент": "Asia/Tashkent",
  "Тбилиси": "Asia/Tbilisi",
  "Ереван": "Asia/Yerevan",
  "Баку": "Asia/Baku",
  "Лондон": "Europe/London",
  "Париж": "Europe/Paris",
  "Берлин": "Europe/Berlin",
  "Мадрид": "Europe/Madrid",
  "Рим": "Europe/Rome",
  "Амстердам": "Europe/Amsterdam",
  "Стокгольм": "Europe/Stockholm",
  "Варшава": "Europe/Warsaw",
  "Стамбул": "Europe/Istanbul",
  "Дубай": "Asia/Dubai",
  "Тель-Авив": "Asia/Jerusalem",
  "Дели": "Asia/Kolkata",
  "Бангкок": "Asia/Bangkok",
  "Пекин": "Asia/Shanghai",
  "Гонконг": "Asia/Hong_Kong",
  "Сингапур": "Asia/Singapore",
  "Сеул": "Asia/Seoul",
  "Токио": "Asia/Tokyo",
  "Сидней": "Australia/Sydney",
  "Нью-Йорк": "America/New_York",
  "Чикаго": "America/Chicago",
  "Денвер": "America/Denver",
  "Лос-Анджелес": "America/Los_Angeles",
  "Торонто": "America/Toronto",
  "Сан-Паулу": "America/Sao_Paulo",
  "Мехико": "America/Mexico_City"
};

export const CITY_NAMES: string[] = Object.keys(CITY_TIMEZONES).sort((a, b) => a.localeCompare(b, "ru"));

export function timezoneForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return CITY_TIMEZONES[city] ?? null;
}
