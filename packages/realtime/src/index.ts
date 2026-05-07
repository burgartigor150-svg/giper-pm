/**
 * Public types only. The real entry points are split because they have
 * different runtime requirements:
 *
 *   - `@giper/realtime/server` runs in Node (server actions, route handlers)
 *     and never touches the DOM.
 *   - `@giper/realtime/client` runs in the browser and pulls in React.
 *
 * Importing them through the right subpath keeps the wrong runtime from
 * accidentally bundling code it can't use.
 */

export type RealtimeEventEnvelope<T = unknown> = {
  type: 'event';
  channel: string;
  payload: T;
};

export type RealtimeChannelKind = 'user' | 'task' | 'project';

/**
 * Conventional channel names — keep them centralised so the publisher
 * and the subscribers can't drift.
 */
export function channelForUser(userId: string): string {
  return `user:${userId}`;
}
export function channelForTask(taskId: string): string {
  return `task:${taskId}`;
}
export function channelForProject(projectId: string): string {
  return `project:${projectId}`;
}
