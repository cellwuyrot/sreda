"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
/* FIX-IMGMENU: тот же модуль скачивания, что и у документов и контекстного меню. */
import { startFileDownload } from "@/lib/downloadFile";
import ImageContextMenu, { useImageContextMenu } from "@/components/ui/ImageContextMenu";

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  /** Имя файла для сохранения. Без него файл ляжет на диск под uuid. */
  name?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, name, onClose }: ImageLightboxProps) {
  /* Правый клик и долгое нажатие работают и внутри лайтбокса: именно здесь
     картинку рассматривают перед тем, как сохранить. */
  const imageMenu = useImageContextMenu();
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (!src) return;
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey, src]);

  return (
    <AnimatePresence>
      {src && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 cursor-zoom-out"
        onClick={onClose}
      >
        {/* FIX-IMGMENU: кнопка скачивания. Раньше из лайтбокса картинку нельзя было забрать
            никак: оверлей закрывается по клику, а штатное меню браузера сохранило бы
            файл под uuid. Стоит слева от крестика и не даёт клику всплыть на оверлей. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (src) startFileDownload(src, name);
          }}
          className="absolute top-4 right-16 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          aria-label="Скачать"
          title="Скачать"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          aria-label="Закрыть"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Hint */}
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-xs">
          Нажмите Esc или кликните вне изображения, чтобы закрыть
        </p>

        {/* Image */}
        <motion.img
          src={src}
          alt={alt ?? ""}
          initial={{ scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.88, opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="max-w-full max-h-[90vh] rounded-xl object-contain shadow-2xl cursor-default"
          onClick={e => e.stopPropagation()}
          draggable={false}
          {...imageMenu.bind(src, name)}
        />

        {imageMenu.menu && (
          <ImageContextMenu
            src={imageMenu.menu.src}
            name={imageMenu.menu.name}
            x={imageMenu.menu.x}
            y={imageMenu.menu.y}
            onClose={imageMenu.close}
          />
        )}
      </motion.div>
      )}
    </AnimatePresence>
  );
}
