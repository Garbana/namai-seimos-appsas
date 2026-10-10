/** Klaida, kurią galima rodyti žmogui — API ją grąžina kaip 400 su šiuo tekstu. */
export class KlaidaVartotojui extends Error {}

/** Šiandienos data Vilniuje ('2026-10-09') — terminai saugomi vietine data. */
export const todayVilnius = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const vilniusParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vilnius",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Vietinė data ir laikas Vilniuje: { date: '2026-10-09', time: '21:05' }. */
export function vilniusNow(now = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(vilniusParts.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const asUtc = (date: string, time: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));

/** Kiek milisekundžių Vilnius tuo momentu lenkia UTC (2 val. žiemą, 3 — vasarą). */
function vilniusOffset(at: number): number {
  const { date, time } = vilniusNow(new Date(at));
  return asUtc(date, time) - Math.floor(at / 60_000) * 60_000;
}

/**
 * Vilniaus vietinis laikas → UTC momentas. Laikas, kurio pavasarį nėra (3:00–4:00),
 * pasislenka valanda vėliau; rudenį pasikartojantis — imamas antrasis.
 */
export function vilniusToUtc(date: string, time: string): Date {
  const local = asUtc(date, time);
  const guess = local - vilniusOffset(local);
  return new Date(local - vilniusOffset(guess));
}

/** Tekstas be tarpų kraštuose; tuščias — null. Per ilgas — klaida. */
export function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new KlaidaVartotojui(`Netinkamas laukas „${field}“.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new KlaidaVartotojui(`„${field}“ per ilgas (daugiausia ${max} simbolių).`);
  return trimmed === "" ? null : trimmed;
}

/** Sveikas teigiamas skaičius (id) arba null. */
export function id(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new KlaidaVartotojui(`Netinkamas laukas „${field}“.`);
  return n;
}
