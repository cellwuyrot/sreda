import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdminRole, isPartnerRole } from "@/lib/roles";

/**
 * ROLE-STRUCT: серверная проверка входа в личный кабинет партнёра.
 * Раньше доступ ограничивался только клиентским редиректом.
 */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin?callbackUrl=/partner");
  if (!isPartnerRole(session.user.role) && !isAdminRole(session.user.role)) redirect("/connect");
  return <>{children}</>;
}
