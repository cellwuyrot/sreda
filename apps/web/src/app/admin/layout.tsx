import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Server-side guard for all /admin/* routes.
 * Runs on the server before any admin page is rendered or any JS is sent to the client.
 * "use client" pages inside /admin/ are still protected because this layout wraps them.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/admin");
  }

  // FIX-EDR: раньше сюда пускали только ADMIN, поэтому у редактора (EDITOR) любая
  // кнопка в «Редакторской» мгновенно редиректила на главный экран — все её
  // ссылки ведут на /admin/*. Пускаем ADMIN и EDITOR; страницы, доступные только
  // админу (О проекте, Контент и т.д.), дополнительно защищены собственными
  // проверками роли.
  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    redirect("/");
  }

  return <>{children}</>;
}
