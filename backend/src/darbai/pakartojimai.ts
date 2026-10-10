/**
 * Pasikartojančių užduočių terminai.
 *
 * Pakartojimas saugomas kalendorių standarto (RRULE) poaibiu:
 *   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL=n,
 *   WEEKLY — BYDAY=MO,TU,…; MONTHLY — BYMONTHDAY=d.
 * Skaičiuojama tik kalendorinėmis datomis ('2026-10-16'), be laiko juostų, tad vasaros
 * laiko pakeitimas terminų nepastumia. Mėnesio diena, kurios mėnesyje nėra (31 d.,
 * vasario 29 d.), tampa paskutine mėnesio diena — namų darbams taip suprantamiau,
 * nei praleisti mėnesį, kaip daro griežtas standartas.
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Rule {
  freq: Freq;
  interval: number;
  /** Savaitės dienos, 0 = pirmadienis … 6 = sekmadienis (tik WEEKLY). */
  byDay: number[];
  /** Mėnesio diena 1–31 (tik MONTHLY); null — termino diena. */
  byMonthDay: number | null;
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** Netinkamas pakartojimas — null, kad kvietėjas parodytų aiškią klaidą. */
export function parseRule(text: string): Rule | null {
  const parts = new Map(
    text
      .split(";")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()] as const)
  );

  const freq = parts.get("FREQ") as Freq | undefined;
  if (!freq || !FREQS.includes(freq)) return null;

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return null;

  let byDay: number[] = [];
  if (parts.has("BYDAY")) {
    if (freq !== "WEEKLY") return null;
    byDay = parts.get("BYDAY")!.split(",").map((d) => DAY_CODES.indexOf(d));
    if (byDay.length === 0 || byDay.some((d) => d < 0)) return null;
    byDay = [...new Set(byDay)].sort((a, b) => a - b);
  }

  let byMonthDay: number | null = null;
  if (parts.has("BYMONTHDAY")) {
    if (freq !== "MONTHLY") return null;
    byMonthDay = Number(parts.get("BYMONTHDAY"));
    if (!Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31) return null;
  }

  return { freq, interval, byDay, byMonthDay };
}

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.map((d) => DAY_CODES[d]).join(",")}`);
  if (rule.byMonthDay !== null) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  return parts.join(";");
}

// ---------- Kalendorinės datos ----------

const DAY_MS = 86_400_000;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s));

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Atmeta „2026-02-31“ ir „2026-13-01“, kuriuos Date tyliai paverstų kita data.
  const back = new Date(ms);
  return back.getUTCDate() === d && back.getUTCMonth() === m - 1 ? ms : Number.NaN;
}

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);

/** 0 = pirmadienis … 6 = sekmadienis. */
export const weekday = (date: string) => (new Date(toUtc(date)).getUTCDay() + 6) % 7;

const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Metai ir mėnuo (0–11) plius `months`, diena pritraukta prie mėnesio galo. */
function monthDate(year: number, month: number, day: number, months: number): string {
  const total = year * 12 + month + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return fromUtc(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
}

/**
 * Kitas terminas: pirmoji serijos data, vėlesnė už `after`. Serija skaičiuojama nuo
 * `anchor` (dabartinio termino). Užbaigiant kviečiama su after = max(terminas, šiandien):
 * atlikus anksčiau — kitas po termino, pavėlavus — kitas po šiandienos, ne praeityje.
 */
export function nextDue(rule: Rule, anchor: string, after: string): string {
  const [ay, am, ad] = anchor.split("-").map(Number);
  const gap = Math.max(0, daysBetween(anchor, after));

  switch (rule.freq) {
    case "DAILY":
      return addDays(anchor, (Math.floor(gap / rule.interval) + 1) * rule.interval);

    case "WEEKLY": {
      const days = rule.byDay.length > 0 ? rule.byDay : [weekday(anchor)];
      const weekStart = addDays(anchor, -weekday(anchor));
      // Per 2 periodus tikrai atsiranda tinkama diena.
      for (let i = 1; i <= 14 * rule.interval + 7; i++) {
        const day = addDays(after, i);
        const weeks = Math.floor(daysBetween(weekStart, day) / 7);
        if (weeks % rule.interval === 0 && days.includes(weekday(day))) return day;
      }
      break;
    }

    case "MONTHLY": {
      const day = rule.byMonthDay ?? ad;
      const start = Math.floor(gap / 31 / rule.interval);
      for (let k = Math.max(0, start - 1); k < start + 26; k++) {
        const candidate = monthDate(ay, am - 1, day, k * rule.interval);
        if (candidate > after) return candidate;
      }
      break;
    }

    case "YEARLY": {
      for (let k = Math.floor(gap / 366 / rule.interval); ; k++) {
        const candidate = monthDate(ay, am - 1, ad, k * rule.interval * 12);
        if (candidate > after) return candidate;
      }
    }
  }
  throw new Error("Nepavyko apskaičiuoti kito termino.");
}
