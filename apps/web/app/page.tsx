export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">giper-pm</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Каркас монорепо собран. Дальше — Prisma, NextAuth, CRUD проектов.
      </p>
      <p className="text-sm text-neutral-500">
        См. ROADMAP.md → «Current sprint».
      </p>
    </main>
  );
}
