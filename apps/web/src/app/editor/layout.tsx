import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isStaffRole } from "@/lib/roles";

/**
 * ROLE-STRUCT: до этого /editor охранялся только в браузере (useSession +
 * router.replace), то есть страница успевала отрендериться и отдать данные
 * любому, кто открыл адрес напрямую. Проверяем роль на сервере.
 */
export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin?callbackUrl=/editor");
  if (!isStaffRole(session.user.role)) redirect("/connect");
  return <>{children}</>;
}
