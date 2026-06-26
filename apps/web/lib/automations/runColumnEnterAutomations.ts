import { prisma } from '@giper/db';
import { applyAutomationAction } from './applyAutomationAction';

/**
 * Run a project's enabled CARD_ENTERS_COLUMN automation rules for a task that
 * just moved into `status` (and, when known, the specific board `columnId` it
 * landed in).
 *
 * Two flavours of CARD_ENTERS_COLUMN rule:
 *   - CATEGORY rule (`triggerConfig = { status }`): fires on every move into that
 *     status category, regardless of which free-form column the card lands in.
 *     This is the original behaviour and stays byte-identical.
 *   - COLUMN rule (`triggerConfig = { columnId }`): fires ONLY when the card
 *     entered that exact column. It needs the column context, so it never fires
 *     for a move where `columnId` is unknown (e.g. the task-detail status picker
 *     or the MCP server, which change the category without a column).
 *
 * Best-effort by contract: never throws — a misconfigured or failing rule must
 * never affect the status change that triggered it. Call it AFTER the status
 * update is committed.
 */
export async function runColumnEnterAutomations(
  taskId: string,
  status: string,
  columnId?: string,
  opts: { columnRulesOnly?: boolean } = {},
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return;

    const rules = await prisma.automationRule.findMany({
      where: {
        projectId: task.projectId,
        enabled: true,
        trigger: 'CARD_ENTERS_COLUMN',
      },
      orderBy: { order: 'asc' },
    });

    for (const rule of rules) {
      try {
        const trig = (rule.triggerConfig ?? {}) as { status?: string; columnId?: string };
        if (opts.columnRulesOnly && !trig.columnId) {
          // Intra-category move (card changed COLUMN but not CATEGORY): the card
          // did not "enter the category", so category-keyed rules must not fire
          // (else a {status} rule would re-apply on every same-category shuffle).
          // Only the destination column's column-keyed rules run.
          continue;
        }
        if (trig.columnId) {
          // Per-column rule: needs an exact column match. Skip when the move
          // carried no column context, so it can never fire on a category-only
          // change where we don't know the destination column.
          if (trig.columnId !== columnId) continue;
        } else if (trig.status !== status) {
          // Category rule (back-compat): match by status category.
          continue;
        }
        await applyAutomationAction(
          taskId,
          task.projectId,
          rule.actionType,
          (rule.actionConfig ?? {}) as Record<string, unknown>,
        );
      } catch (e) {
        console.warn('automation rule failed', rule.id, e);
      }
    }
  } catch (e) {
    console.warn('runColumnEnterAutomations failed', e);
  }
}
