/**
 * FIX-UPLOAD: загрузка файла с прогрессом.
 *
 * fetch() не отдаёт прогресс ОТПРАВКИ тела запроса, поэтому для полоски
 * загрузки используется XMLHttpRequest с событием upload.onprogress.
 * Интерфейс результата повторяет минимально нужную часть Response
 * (ok / status / json()), чтобы вызовы почти не менялись.
 */

export interface UploadResult {
  ok: boolean;
  status: number;
  json<T = unknown>(): Promise<T>;
}

export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "text";

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress(Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100))));
      };
    }

    xhr.onload = () => {
      const text = xhr.responseText;
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(text),
      });
    };
    xhr.onerror = () => reject(new Error("Сетевая ошибка при загрузке файла"));
    xhr.onabort = () => reject(new Error("Загрузка файла отменена"));

    xhr.send(formData);
  });
}
