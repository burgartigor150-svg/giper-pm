/** Format minutes as "Hч Mм" or "Mм" or "0м". */
export function formatMinutes(min: number): string {
  if (!min || min < 1) return '0м';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}ч ${m}м`;
  if (h > 0) return `${h}ч`;
  return `${m}м`;
}

/** Format minutes as fractional hours like "3.5". */
export function minutesToHours(min: number): string {
  return (min / 60).toFixed(1);
}
