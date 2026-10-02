/**
 * GET /api/departments — authority only; no input. Active departments, by name.
 * The assignment suggestion is the department whose `default_categories`
 * contains the issue's category.
 */
import { z } from "zod";
import { categorySchema, uuidSchema } from "./primitives";

export const departmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sla_hours: z.number().int().positive(),
  default_categories: z.array(categorySchema),
});
export type Department = z.infer<typeof departmentSchema>;

export const departmentsResponseSchema = z.array(departmentSchema);
export type DepartmentsResponse = z.infer<typeof departmentsResponseSchema>;
