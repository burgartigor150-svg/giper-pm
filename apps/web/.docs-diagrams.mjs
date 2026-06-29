import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-igorlint-Downloads-kaiten-knowledge-base/63bd805c-c4eb-43d3-8221-899421c7148e/scratchpad/docs/diagrams';
mkdirSync(OUT, { recursive: true });

const FONT = 'font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif"';
const BLUE = '#2563EB', GREEN = '#059669', SLATE = '#0F172A', MUT = '#64748B', BG = '#FFFFFF', LINE = '#E2E8F0';

// ---------- 1. Role matrix ----------
function roleMatrix() {
  const cols = ['Проекты', 'Доски/Задачи', 'Спринты', 'Время', 'Календарь', 'CRM', 'Сервис-деск', 'База знаний', 'Отчёты', 'Админ'];
  const rows = [
    ['Администратор', ['full','full','full','full','full','full','full','full','full','full']],
    ['Руководитель (PM)', ['full','full','full','full','full','full','full','full','full','read']],
    ['Исполнитель', ['read','own','own','own','own','none','none','read','own','none']],
    ['Ревьюер', ['read','own','read','own','own','none','none','read','read','none']],
    ['Наблюдатель', ['read','read','read','read','read','none','none','read','read','none']],
  ];
  const col = { full: GREEN, own: BLUE, read: '#F59E0B', none: '#CBD5E1' };
  const txt = { full: 'полн.', own: 'свои', read: 'просм.', none: '—' };
  const x0 = 220, cw = 96, rh = 46, y0 = 96, headH = 64;
  const W = x0 + cols.length * cw + 24, H = y0 + rows.length * rh + 90;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="24" y="44" font-size="26" font-weight="700" fill="${SLATE}">Матрица ролей и доступа</text>`;
  // header
  cols.forEach((c, i) => {
    const cx = x0 + i * cw + cw / 2;
    s += `<text x="${cx}" y="${y0 - 14}" font-size="13" fill="${MUT}" text-anchor="middle" transform="rotate(-20 ${cx} ${y0 - 14})">${c}</text>`;
  });
  rows.forEach((r, ri) => {
    const ry = y0 + ri * rh;
    s += `<text x="24" y="${ry + rh / 2 + 5}" font-size="15" font-weight="600" fill="${SLATE}">${r[0]}</text>`;
    r[1].forEach((v, ci) => {
      const cx = x0 + ci * cw;
      s += `<rect x="${cx + 4}" y="${ry + 5}" width="${cw - 8}" height="${rh - 10}" rx="7" fill="${col[v]}" opacity="${v === 'none' ? 0.25 : 0.16}"/>`;
      s += `<text x="${cx + cw / 2}" y="${ry + rh / 2 + 5}" font-size="12.5" font-weight="600" fill="${v === 'none' ? MUT : col[v]}" text-anchor="middle">${txt[v]}</text>`;
    });
  });
  // legend
  const ly = y0 + rows.length * rh + 34;
  const leg = [['full', 'Полный доступ'], ['own', 'Только свои'], ['read', 'Только просмотр'], ['none', 'Нет доступа']];
  let lx = 24;
  leg.forEach(([k, lbl]) => {
    s += `<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="4" fill="${col[k]}" opacity="${k === 'none' ? 0.3 : 0.2}"/>`;
    s += `<text x="${lx + 22}" y="${ly + 1}" font-size="13" fill="${SLATE}">${lbl}</text>`;
    lx += 24 + 16 + lbl.length * 8.2 + 18;
  });
  return s + `</svg>`;
}

// ---------- 2. Status flow ----------
function statusFlow() {
  const steps = [['Бэклог', '#94A3B8'], ['К работе', BLUE], ['В работе', '#6366F1'], ['Ревью', '#F59E0B'], ['Готово', GREEN]];
  const W = 980, H = 230, bw = 150, bh = 70, gap = (W - 48 - steps.length * bw) / (steps.length - 1), y = 70;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="24" y="42" font-size="24" font-weight="700" fill="${SLATE}">Поток статусов задачи</text>`;
  steps.forEach((st, i) => {
    const x = 24 + i * (bw + gap);
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="12" fill="${st[1]}" opacity="0.14"/>`;
    s += `<rect x="${x}" y="${y}" width="6" height="${bh}" rx="3" fill="${st[1]}"/>`;
    s += `<text x="${x + bw / 2 + 3}" y="${y + bh / 2 + 6}" font-size="17" font-weight="700" fill="${st[1]}" text-anchor="middle">${st[0]}</text>`;
    if (i < steps.length - 1) {
      const ax = x + bw + gap / 2 - 9;
      s += `<path d="M ${x + bw + 6} ${y + bh / 2} L ${ax + 14} ${y + bh / 2}" stroke="${MUT}" stroke-width="2.5" marker-end="url(#ar)"/>`;
    }
  });
  s += `<text x="24" y="${y + bh + 50}" font-size="14" fill="${MUT}">Категории «Готово» и «Отменено» завершают задачу. Переходы можно ограничить настройкой рабочих процессов проекта.</text>`;
  s += `<defs><marker id="ar" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="${MUT}"/></marker></defs>`;
  return s + `</svg>`;
}

// ---------- 3. Task lifecycle ----------
function taskLifecycle() {
  const steps = [['Создание', 'Автор заводит задачу,\nставит проект и приоритет', BLUE],
    ['Назначение', 'Указывают исполнителя\nи ревьюера, срок', '#6366F1'],
    ['В работе', 'Исполнитель ведёт задачу,\nсписывает время', '#0EA5E9'],
    ['Ревью', 'Ревьюер проверяет\nрезультат', '#F59E0B'],
    ['Готово', 'Задача закрыта,\nрезультат зафиксирован', GREEN]];
  const W = 1000, H = 250, bw = 178, bh = 110, gap = (W - 40 - steps.length * bw) / (steps.length - 1), y = 78;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="20" y="42" font-size="24" font-weight="700" fill="${SLATE}">Жизненный цикл задачи</text>`;
  steps.forEach((st, i) => {
    const x = 20 + i * (bw + gap);
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="${BG}" stroke="${st[2]}" stroke-width="2"/>`;
    s += `<circle cx="${x + 24}" cy="${y + 26}" r="13" fill="${st[2]}"/><text x="${x + 24}" y="${y + 31}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text>`;
    s += `<text x="${x + 46}" y="${y + 31}" font-size="16" font-weight="700" fill="${st[2]}">${st[0]}</text>`;
    st[1].split('\n').forEach((ln, li) => s += `<text x="${x + 16}" y="${y + 58 + li * 19}" font-size="12.5" fill="${MUT}">${ln}</text>`);
    if (i < steps.length - 1) s += `<path d="M ${x + bw + 3} ${y + bh / 2} l ${gap - 6} 0" stroke="${MUT}" stroke-width="2.5" marker-end="url(#ar2)"/>`;
  });
  s += `<defs><marker id="ar2" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="${MUT}"/></marker></defs>`;
  return s + `</svg>`;
}

// ---------- 4. Calendar legend ----------
function calendarLegend() {
  const items = [['Дедлайн задачи', '#F59E0B', 'bar'], ['Созвон', BLUE, 'dot'], ['Событие Bitrix24', '#7C3AED', 'dot'], ['Личное событие', GREEN, 'dot']];
  const W = 560, H = 240, y0 = 86, rh = 38;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="24" y="44" font-size="22" font-weight="700" fill="${SLATE}">Типы событий в календаре</text>`;
  items.forEach((it, i) => {
    const y = y0 + i * rh;
    if (it[2] === 'bar') { s += `<rect x="26" y="${y - 11}" width="22" height="16" rx="3" fill="#F1F5F9"/><rect x="26" y="${y - 11}" width="5" height="16" rx="2" fill="${it[1]}"/>`; }
    else { s += `<rect x="24" y="${y - 12}" width="26" height="18" rx="5" fill="${it[1]}" opacity="0.16"/><circle cx="37" cy="${y - 3}" r="4.5" fill="${it[1]}"/>`; }
    s += `<text x="62" y="${y + 1}" font-size="15" fill="${SLATE}">${it[0]}</text>`;
  });
  s += `<text x="24" y="${y0 + items.length * rh + 18}" font-size="13" fill="${MUT}">События из Bitrix24 — только для просмотра (нельзя удалить).</text>`;
  return s + `</svg>`;
}

// ---------- 5. Sprint burndown (example) ----------
function burndown() {
  const W = 720, H = 420, px = 70, py = 60, pw = W - px - 30, ph = H - py - 70;
  const days = 10, total = 40;
  const ideal = Array.from({ length: days + 1 }, (_, i) => total - total * i / days);
  const actual = [40, 40, 36, 33, 30, 29, 23, 18, 11, 5, 0];
  const X = i => px + pw * i / days, Y = v => py + ph * (1 - v / total);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="24" y="36" font-size="22" font-weight="700" fill="${SLATE}">Burndown спринта (пример)</text>`;
  // grid + axes
  for (let g = 0; g <= 4; g++) { const gy = py + ph * g / 4; s += `<line x1="${px}" y1="${gy}" x2="${px + pw}" y2="${gy}" stroke="${LINE}"/><text x="${px - 10}" y="${gy + 4}" font-size="11" fill="${MUT}" text-anchor="end">${Math.round(total - total * g / 4)}</text>`; }
  for (let d = 0; d <= days; d += 2) s += `<text x="${X(d)}" y="${py + ph + 22}" font-size="11" fill="${MUT}" text-anchor="middle">Д${d}</text>`;
  s += `<text x="${px + pw / 2}" y="${H - 14}" font-size="12" fill="${MUT}" text-anchor="middle">Дни спринта</text>`;
  const path = a => a.map((v, i) => `${i ? 'L' : 'M'} ${X(i)} ${Y(v)}`).join(' ');
  s += `<path d="${path(ideal)}" fill="none" stroke="${MUT}" stroke-width="2" stroke-dasharray="6 5"/>`;
  s += `<path d="${path(actual)}" fill="none" stroke="${BLUE}" stroke-width="3"/>`;
  actual.forEach((v, i) => s += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${BLUE}"/>`);
  // legend
  s += `<line x1="${px}" y1="34" x2="${px + 28}" y2="34" stroke="${MUT}" stroke-width="2" stroke-dasharray="6 5"/><text x="${px + 34}" y="38" font-size="12" fill="${MUT}">Идеальная линия</text>`;
  s += `<line x1="${px + 170}" y1="34" x2="${px + 198}" y2="34" stroke="${BLUE}" stroke-width="3"/><text x="${px + 204}" y="38" font-size="12" fill="${SLATE}">Факт (остаток работы)</text>`;
  return s + `</svg>`;
}

const diagrams = {
  'role-matrix': roleMatrix(),
  'status-flow': statusFlow(),
  'task-lifecycle': taskLifecycle(),
  'calendar-legend': calendarLegend(),
  'sprint-burndown': burndown(),
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [key, svg] of Object.entries(diagrams)) {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const w = +m[1], h = +m[2];
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:0">${svg}</body></html>`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${key}.png`, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('diagram', key, `${w}x${h}`);
}
await browser.close();
console.log('DIAGRAMS DONE');
