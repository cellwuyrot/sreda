import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { LRUCache } from "lru-cache";

// FIX-GEO-FREE: серверный прокси обратного геокодирования через Nominatim
// (OpenStreetMap) — бесплатно, без API-ключей. Прокси (а не запрос из
// браузера) нужен по трём причинам:
//   1) политика Nominatim требует идентифицирующий User-Agent — браузер этот
//      заголовок поставить не может;
//   2) наш CSP connect-src 'self' не пускает клиентские fetch к сторонним
//      доменам (и расширять его ради одного сервиса не хочется);
//   3) здесь мы кешируем ответы и глобально ограничиваем темп до ~1 запроса
//      в секунду (абсолютный лимит публичного Nominatim).

// Кеш адресов: координаты округляются до 4 знаков (~11 м) — для «улица, дом,
// город» этого достаточно, а повторные клики рядом не дёргают сервис.
// Значение LRUCache не может быть null (constraint V extends {}), поэтому
// «адрес не найден» кешируем пустой строкой.
const addressCache = new LRUCache<string, string>({
  max: 5000,
  ttl: 24 * 60 * 60 * 1000, // сутки
});

// Глобальный «водитель ритма»: публичный Nominatim разрешает не более
// 1 запроса/сек с приложения. Цепочка промисов сериализует обращения и
// выдерживает паузу между ними (кеш и клиентский дебаунс сводят её к редкой).
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let nominatimChain: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;

function paceNominatim(): Promise<void> {
  const run = nominatimChain.then(async () => {
    const wait = lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
  });
  nominatimChain = run.catch(() => {});
  return run;
}

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
}

interface NominatimReverse {
  display_name?: string;
  address?: NominatimAddress;
  error?: string;
}

// Собираем «улица, дом, город» — тот же формат, что был у Google-версии.
function formatAddress(data: NominatimReverse): string | null {
  const a = data.address ?? {};
  const street = a.road ?? a.pedestrian ?? a.footway;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const parts: string[] = [];
  if (street) parts.push(a.house_number ? `${street}, ${a.house_number}` : street);
  if (city) parts.push(city);
  if (parts.length > 0) return parts.join(", ");
  return data.display_name || null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Некорректные координаты" }, { status: 400 });
  }

  const limited = await rateLimit(req, `geo-reverse:${session.user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (addressCache.has(cacheKey)) {
    return NextResponse.json({ address: addressCache.get(cacheKey) || null });
  }

  try {
    await paceNominatim();
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
      "&zoom=18&accept-language=ru";
    const res = await fetch(url, {
      headers: {
        // Требование политики Nominatim: идентифицирующий User-Agent.
        "User-Agent": "trioz-messenger/1.0 (+https://trioz.ru)",
      },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    // Сбой сервиса — не ошибка для клиента: точка отправится без адреса
    // (то же поведение, что было при недоступном Google Geocoder).
    if (!res.ok) return NextResponse.json({ address: null });
    const data = (await res.json()) as NominatimReverse;
    const address = data.error ? null : formatAddress(data);
    addressCache.set(cacheKey, address ?? "");
    return NextResponse.json({ address });
  } catch {
    return NextResponse.json({ address: null });
  }
}
