import { redirect } from "next/navigation";

/** Payments are administered in Business, never in the main project's UI.
 * Old bookmarks remain safe; historical payment records are not deleted. */
export default function RetiredPaymentsPage() {
  redirect("/admin/premium");
}
