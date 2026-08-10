"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { reverseGeocode } from "./GeoMap";
import InfoTooltip from "@/components/ui/InfoTooltip";

// FIX-GEO-FREE: карта — Leaflet + OpenStreetMap (бесплатно, без API-ключей);
// при выборе точки адрес (улица, дом, город) определяется через Nominatim
// (наш серверный прокси /api/geo/reverse) и отправляется вместе с точкой.
const GeoMap = dynamic(() => import("./GeoMap"), { ssr: false });

interface GeoPickerProps {
  open: boolean;
  onClose: () => void;
  onSend: (lat: number, lng: number, address?: string | null) => void;
}

export default function GeoPicker({ open, onClose, onSend }: GeoPickerProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);

  // Request geolocation when the picker opens
  useEffect(() => {
    if (!open) {
      setCoords(null);
      setError(null);
      setAddress(null);
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("Геолокация не поддерживается этим браузером");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoading(false);
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Доступ к геолокации запрещён"
            : err.code === err.POSITION_UNAVAILABLE
              ? "Местоположение недоступно"
              : err.code === err.TIMEOUT
                ? "Превышено время ожидания"
                : "Ошибка геолокации";
        setError(msg);
        // Default to a fallback so the user can still pick manually
        setCoords({ lat: 55.751244, lng: 37.618423 }); // Moscow
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [open]);

  // FIX-GEO: обратное геокодирование выбранной точки (с небольшим дебаунсом,
  // чтобы не дёргать Geocoder на каждый пиксель перетаскивания маркера).
  useEffect(() => {
    if (!open || !coords) {
      setAddress(null);
      return;
    }
    let cancelled = false;
    setAddressLoading(true);
    const t = setTimeout(() => {
      reverseGeocode(coords.lat, coords.lng)
        .then((a) => {
          if (!cancelled) setAddress(a);
        })
        .catch(() => {
          if (!cancelled) setAddress(null);
        })
        .finally(() => {
          if (!cancelled) setAddressLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, coords]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 shadow-2xl overflow-hidden"
          >
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/icons/geoposition.png" alt="" className="w-6 h-6 cn-icon" />
                <span className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Поделиться геолокацией{" "}
                  <InfoTooltip
                    side="bottom"
                    text="Точку можно поправить: кликните по карте в нужном месте или просто перетащите маркер."
                  />
                </span>
              </div>
              <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white" aria-label="Закрыть">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-4">
              {error && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{error}</p>
              )}
              {loading ? (
                <div className="h-[200px] flex items-center justify-center bg-neutral-100 dark:bg-white/5 rounded-xl">
                  <span className="text-xs text-neutral-400">Определение местоположения…</span>
                </div>
              ) : coords ? (
                <GeoMap lat={coords.lat} lng={coords.lng} onPick={(lat, lng) => setCoords({ lat, lng })} />
              ) : null}
              {coords && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs text-neutral-700 dark:text-gray-200 font-medium min-h-[16px]">
                    {addressLoading ? "Определение адреса…" : address ?? "Адрес не определён"}
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </p>
                </div>
              )}
            </div>

            <div className="px-4 py-3 mt-2 flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-600 dark:text-gray-300"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  if (coords) onSend(coords.lat, coords.lng, address);
                }}
                disabled={!coords}
                className="px-3 py-1.5 text-sm rounded-lg bg-violet-500 dark:bg-cyan-600 text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <img src="/icons/send.png" alt="" className="w-3.5 h-3.5" style={{ filter: "brightness(0) invert(1)" }} />
                Отправить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
