"use client";
import LinkPreviewCard from "./LinkPreviewCard";
export default function LinkPreviewDraft({
  url,
  suppressed,
  onChange,
}: {
  url: string | null;
  suppressed: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!url) return null;
  return (
    <div className="link-preview-draft" aria-label="Превью перед отправкой">
      {suppressed ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>Сообщение будет отправлено без превью</span>
          <button type="button" onClick={() => onChange(false)}>
            Вернуть карточку
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span>Превью ссылки</span>
            <button
              type="button"
              aria-label="Отправить без превью"
              title="Убрать карточку для всех перед отправкой"
              onClick={() => onChange(true)}
            >
              × Без превью
            </button>
          </div>
          <LinkPreviewCard url={url} compact />
        </>
      )}
    </div>
  );
}
