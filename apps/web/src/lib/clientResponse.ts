/** fetch does not reject HTTP errors. Never announce success before checking it. */
export async function checkedJson<T = Record<string, unknown>>(response: Response, fallback = "Не удалось сохранить изменения"): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : fallback);
  }
  if (data === null) throw new Error("Сервер вернул неполный ответ. Проверьте результат перед повтором.");
  return data as T;
}
