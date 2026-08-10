"use client";

import { useBackStep } from "@/hooks/useBackStep";

/**
 * BACK-STEP: кнопка «назад», которая возвращает туда, откуда пришли.
 *
 * Раньше на её месте стояла обычная ссылка с постоянным адресом, поэтому «назад»
 * означало «в такое-то место»: из настроек — в мессенджер, из подраздела админки —
 * в её корень. Пришёл в настройки из панели администратора — и «назад» уносило
 * совсем не туда, откуда человек пришёл.
 *
 * Вид не меняется: компонент принимает те же `className` и содержимое, что были у
 * ссылки, — иконки и цвета остаются прежними. Меняется только поведение.
 *
 * `fallback` — прежний постоянный адрес. Он остаётся запасным путём: страницу
 * могли открыть по прямой ссылке первой в этой вкладке, и тогда возвращаться
 * некуда.
 */
export default function BackButton({
  fallback,
  className,
  children,
  "aria-label": ariaLabel,
  title,
}: {
  fallback: string;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  const { onBack } = useBackStep(fallback);

  return (
    <button type="button" onClick={onBack} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </button>
  );
}
