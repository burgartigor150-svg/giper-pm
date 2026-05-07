import { cn } from '@giper/ui/cn';

type Props = {
  name: string;
  color: string;
  size?: 'sm' | 'md';
  onRemove?: () => void;
};

/**
 * Tag chip rendered in the colour the tag declared. We pick foreground
 * (white vs near-black) by computing perceived luminance — guarantees
 * legible contrast across any palette without hardcoding pairs.
 */
export function TagPill({ name, color, size = 'sm', onRemove }: Props) {
  const fg = pickForeground(color);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      )}
      style={{ backgroundColor: color, color: fg }}
    >
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1 ml-0.5 rounded-full px-1 leading-none hover:bg-black/15"
          aria-label={`Снять тег ${name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function pickForeground(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  // Rec.709 luma — 0..255.
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 160 ? '#0f172a' : '#ffffff';
}
