type Slice = { label: string; minutes: number; color: string };

type Props = {
  slices: Slice[];
};

const PALETTE = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
];

export function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

export function TimeProjectPie({ slices }: Props) {
  const total = slices.reduce((s, x) => s + x.minutes, 0);
  if (total === 0) return null;

  // Build a CSS conic-gradient from cumulative shares.
  let acc = 0;
  const stops = slices
    .map((s) => {
      const start = (acc / total) * 360;
      acc += s.minutes;
      const end = (acc / total) * 360;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(', ');

  return (
    <div className="flex flex-col gap-3">
      <div
        className="h-32 w-32 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
        aria-hidden
      />
      <ul className="flex flex-col gap-1 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="text-muted-foreground">
              {(s.minutes / 60).toFixed(1)} ч
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
