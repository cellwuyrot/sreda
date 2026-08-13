import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/roles";

/**
 * ROLE-STRUCT: серверный guard для разделов /admin/*, закрытых для редактора.
 *
 * /admin/layout.tsx пускает ADMIN и EDITOR (иначе у редактора не работала бы ни
 * одна кнопка «Редакторской»), поэтому разделы уровня проекта закрываются здесь —
 * до рендера страницы и до отправки её данных в браузер. Проверок в клиентском
 * коде для этого недостаточно: они защищают вид, а не данные.
 */
export default async function AdminOnlySection({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin?callbackUrl=/admin");
  if (!isAdminRole(session.user.role)) redirect("/admin");
  return <>{children}</>;
}
