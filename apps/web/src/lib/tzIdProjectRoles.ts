import { HubError, textField } from "./tzIdHub";
/** Global TrioZ roles are intentionally not accepted as project authorization. */
export function projectRoleInput(input: Record<string, unknown>) {
  const clientId = textField(input.clientId, "ID приложения", 100);
  const userId = textField(input.userId, "TZ ID пользователя (sub)", 100);
  if (typeof input.enabled !== "boolean") throw new HubError("Укажите назначение или отзыв прав");
  return { clientId, userId, enabled: input.enabled };
}
