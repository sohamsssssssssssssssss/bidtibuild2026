/**
 * GET /api/departments — authority only (02 §13). Active departments, by name,
 * for the assignment picker. A plain service-role select; no database function.
 */
import { departmentsResponseSchema } from "@/contracts/departments";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseDbResult, requireAuthority, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  await requireAuthority(req);

  const { data, error } = await getAdminClient()
    .from("departments")
    .select("id, name, sla_hours, default_categories")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`departments select failed: ${error.code ?? ""} ${error.message}`, { cause: error });

  return respondOk(parseDbResult(departmentsResponseSchema, data, "departments"));
});
