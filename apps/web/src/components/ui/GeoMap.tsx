"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker as LeafletMarker, LeafletMouseEvent } from "leaflet";

// FIX-GEO-FREE: карта переведена с Google Maps (требовал платный API-ключ
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) на полностью бесплатный стек без ключей:
//   • рендер — Leaflet + тайлы OpenStreetMap;
//   • обратное геокодирование — Nominatim (OSM) через наш серверный прокси
//     /api/geo/reverse (политика Nominatim требует идентифицирующий User-Agent,
//     который браузер поставить не может, а CSP connect-src 'self' не пускает
//     клиентские запросы к сторонним доменам — прокси решает и то, и другое,
//     плюс даёт кеш и rate-limit).
// Публичный интерфейс сохранён: props GeoMap и exported reverseGeocode —
// потребители (GeoPicker, MessageArea, DMMessageList) не меняются.
//
// САМ Leaflet импортируется динамически ВНУТРИ эффекта: его код обращается к
// window, а этот модуль исполняется и на сервере (GeoPicker статически
// импортирует отсюда reverseGeocode). CSS-импорт выше безопасен — он
// извлекается сборщиком на этапе билда.

/**
 * Обратное геокодирование точки: возвращает строку вида «улица, дом, город»
 * (или полный адрес, если компоненты не распознаны). null — если адрес не
 * найден или сервис недоступен.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(
      `/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: string | null };
    return data.address ?? null;
  } catch {
    return null;
  }
}

// Маркер — inline-SVG через divIcon: дефолтные PNG-иконки Leaflet ломаются под
// сборщиками (пути к ассетам), а svg не тянет ни одного файла.
const PIN_SVG = `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35))">
  <path d="M15 0C6.716 0 0 6.716 0 15c0 11.25 15 27 15 27s15-15.75 15-27C30 6.716 23.284 0 15 0z" fill="#7c3aed"/>
  <circle cx="15" cy="15" r="5.5" fill="#ffffff"/>
</svg>`;

interface GeoMapProps {
  lat: number;
  lng: number;
  /** Render height of the map in pixels */
  height?: number;
  /** Optional click handler to pick a new location */
  onPick?: (lat: number, lng: number) => void;
  interactive?: boolean;
}

/**
 * Leaflet/OSM-карта с одним маркером. Клик по карте / перетаскивание маркера
 * вызывает onPick с новыми координатами. Ключи API не нужны.
 */
export default function GeoMap({ lat, lng, height = 200, onPick, interactive = true }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [failed, setFailed] = useState(false);
  const onPickRef = useRef(onPick);
  // FIX-GEO: обновляем ref в эффекте, а не во время рендера (react-hooks/refs).
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      let L: typeof import("leaflet");
      try {
        // Приведение покрывает обе формы интеропа CJS-модуля (namespace /
        // default) — leaflet собран как UMD.
        const leafletMod = (await import("leaflet")) as unknown as typeof import("leaflet") & {
          default?: typeof import("leaflet");
        };
        L = leafletMod.default ?? leafletMod;
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: interactive,
        dragging: interactive,
        touchZoom: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
      });
      // Убираем префикс «Leaflet», оставляя обязательную атрибуцию OSM.
      map.attributionControl.setPrefix("");
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        // Обязательное условие бесплатного использования тайлов OSM.
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).addTo(map);

      const icon = L.divIcon({
        className: "", // без класса по умолчанию (leaflet-div-icon рисует белый квадрат)
        html: PIN_SVG,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
      });
      const marker = L.marker([lat, lng], { icon, draggable: !!onPickRef.current }).addTo(map);

      if (onPickRef.current) {
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          onPickRef.current?.(pos.lat, pos.lng);
        });
        map.on("click", (e: LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
          onPickRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      }

      mapRef.current = map;
      markerRef.current = marker;
    })();

    return () => {
      disposed = true;
      // remove() полностью уничтожает карту и её обработчики — это же
      // защищает от «Map container is already initialized» при двойном
      // прогоне эффекта в React Strict Mode (dev).
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move marker when coords change (props update)
  useEffect(() => {
    markerRef.current?.setLatLng([lat, lng]);
    mapRef.current?.setView([lat, lng]);
  }, [lat, lng]);

  if (failed) {
    return (
      <div
        style={{ height, width: "100%", borderRadius: 12 }}
        className="flex items-center justify-center border border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-white/5 px-3 text-center"
      >
        <span className="text-xs text-neutral-400">Не удалось загрузить карту</span>
      </div>
    );
  }

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: 12, overflow: "hidden" }} />;
}
