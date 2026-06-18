import { prisma, type CustomFieldType } from '@giper/db';

export type CustomFieldView = {
  id: string;
  name: string;
  type: CustomFieldType;
  /** Options for SELECT / MULTI_SELECT; [] otherwise. */
  options: string[];
  order: number;
};

/**
 * Load a project's custom field definitions (ordered). Fault-tolerant: a
 * missing table (deploy→migrate window) falls back to [].
 */
export async function getCustomFields(
  projectId: string,
): Promise<CustomFieldView[]> {
  try {
    const rows = await prisma.customFieldDefinition.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, type: true, options: true, order: true },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      options: Array.isArray(r.options) ? (r.options as string[]) : [],
      order: r.order,
    }));
  } catch {
    return [];
  }
}
