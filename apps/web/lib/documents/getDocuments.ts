import { prisma } from '@giper/db';

export type DocumentListItem = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
};

/** All documents of a project (flat, ordered) for the tree/list. Fault-tolerant. */
export async function getDocuments(projectId: string): Promise<DocumentListItem[]> {
  try {
    return await prisma.document.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, parentId: true, order: true },
    });
  } catch {
    return [];
  }
}

/** A single document with content, scoped-check via projectId in the page. */
export async function getDocument(docId: string) {
  try {
    return await prisma.document.findUnique({
      where: { id: docId },
      select: {
        id: true,
        projectId: true,
        title: true,
        content: true,
        updatedAt: true,
      },
    });
  } catch {
    return null;
  }
}
