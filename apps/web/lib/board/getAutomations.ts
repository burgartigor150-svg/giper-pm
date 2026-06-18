import { prisma } from '@giper/db';

export type AutomationView = {
  id: string;
  name: string;
  enabled: boolean;
  /** Column (status) whose entry fires the rule. */
  triggerStatus: string;
  actionType: string;
  /** userId / priority / swimlaneId, flattened from actionConfig. */
  actionValue: string;
  order: number;
};

/**
 * Load a project's automation rules (ordered), flattening the stored
 * trigger/action JSON into a UI-friendly shape. Fault-tolerant → [].
 */
export async function getAutomations(projectId: string): Promise<AutomationView[]> {
  try {
    const rows = await prisma.automationRule.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return rows.map((r) => {
      const trig = (r.triggerConfig ?? {}) as { status?: string };
      const cfg = (r.actionConfig ?? {}) as Record<string, unknown>;
      let actionValue = '';
      if (r.actionType === 'SET_ASSIGNEE' && typeof cfg.userId === 'string') {
        actionValue = cfg.userId;
      } else if (r.actionType === 'SET_PRIORITY' && typeof cfg.priority === 'string') {
        actionValue = cfg.priority;
      } else if (r.actionType === 'SET_SWIMLANE' && typeof cfg.swimlaneId === 'string') {
        actionValue = cfg.swimlaneId;
      }
      return {
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        triggerStatus: trig.status ?? '',
        actionType: r.actionType,
        actionValue,
        order: r.order,
      };
    });
  } catch {
    return [];
  }
}
