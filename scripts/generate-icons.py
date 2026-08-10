#!/usr/bin/env python3
"""
Фавиконы сайта из общего исходника логотипа.

Исходник один на весь проект — docs/logostol.png. Прозрачность сохраняется:
логотип нигде не «кладётся» на непрозрачный квадрат, поля добираются пустыми
пикселями.

Использование:
    pip install pillow
    python scripts/generate-icons.py            # возьмёт docs/logostol.png
    python scripts/generate-icons.py <файл.png> # другой исходник

Результат (apps/web/public/):
    favicon.ico            16 + 32 + 48 (многоразмерный ICO)
    favicon-16x16.png
    favicon-32x32.png
    apple-touch-icon.png   180×180
    icon-192.png           192×192 (PWA)
    icon-512.png           512×512 (PWA)

Иконок приложений здесь больше нет — они собираются из того же файла сами:
    • десктоп  — apps/desktop/scripts/prepare-icons.mjs на шаге npm run build
                 (.ico для Windows делает electron-builder);
    • Android  — задача syncLauncherIcon в apps/android/app/build.gradle.kts.
Так копия логотипа в репозитории остаётся одна и расходиться нечему.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
WEB_PUBLIC = ROOT / "apps" / "web" / "public"


def load_source(path: Path) -> Image.Image:
    """Load the logo, keep alpha, trim empty transparent borders and pad to
    a square canvas *without* filling the background (stays transparent)."""
    img = Image.open(path).convert("RGBA")

    # Trim fully transparent borders so the logo is centered tightly.
    bbox = img.getchannel("A").getbbox()
    if bbox:
        img = img.crop(bbox)

    # Pad to square with transparent pixels (logo centered, ~4% margin).
    side = max(img.size)
    margin = round(side * 0.04)
    canvas_side = side + margin * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(img, ((canvas_side - img.width) // 2, (canvas_side - img.height) // 2), img)
    return canvas


def save_png(src: Image.Image, size: int, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    src.resize((size, size), Image.LANCZOS).save(dest, "PNG")
    print(f"  {dest.relative_to(ROOT)}  {size}x{size}")


def save_ico(src: Image.Image, sizes: list[int], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    base = src.resize((max(sizes), max(sizes)), Image.LANCZOS)
    base.save(dest, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  {dest.relative_to(ROOT)}  ICO {sizes}")


def main() -> None:
    if len(sys.argv) > 2:
        sys.exit(__doc__)

    # Без аргумента берём общий исходник проекта.
    source_path = Path(sys.argv[1]) if len(sys.argv) == 2 else ROOT / "docs" / "logostol.png"
    if not source_path.exists():
        sys.exit(f"Не найден исходный PNG: {source_path}")

    src = load_source(source_path)
    print(f"Source: {source_path} -> trimmed square {src.size[0]}px, alpha preserved")

    print("Сайт (apps/web/public):")
    save_ico(src, [16, 32, 48], WEB_PUBLIC / "favicon.ico")
    save_png(src, 16, WEB_PUBLIC / "favicon-16x16.png")
    save_png(src, 32, WEB_PUBLIC / "favicon-32x32.png")
    save_png(src, 180, WEB_PUBLIC / "apple-touch-icon.png")
    save_png(src, 192, WEB_PUBLIC / "icon-192.png")
    save_png(src, 512, WEB_PUBLIC / "icon-512.png")

    print("Иконки десктопа и Android здесь не собираются — они берутся из того же")
    print("файла при сборке (см. описание в начале скрипта).")


if __name__ == "__main__":
    main()
