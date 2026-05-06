/**
 * Duck-typed Prisma error checks.
 *
 * We don't use `e instanceof Prisma.PrismaClientKnownRequestError` because
 * Server Actions run in a different webpack chunk than the use-case modules
 * under Next.js dev — the `Prisma` namespace evaluated in the use-case may
 * be a different instance from the one re-exported through @giper/db at the
 * action site, so the prototype check fails. The `code` field on those
 * errors is part of Prisma's stable public API, so duck-typing is safe.
 */
export function isPrismaKnownError(
  e: unknown,
): e is { code: string; meta?: unknown; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((e as { code: string }).code)
  );
}

export function isUniqueConstraintError(e: unknown): boolean {
  return isPrismaKnownError(e) && e.code === 'P2002';
}
