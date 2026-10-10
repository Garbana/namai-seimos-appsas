/**
 * Biudžeto ribos.
 *
 * Lentelė `budgets` buvo paruošta nuo pat pradžių ir nenaudojama, tad migracijos
 * nereikia — tik prasmės:
 *   period = 'numatyta'  — riba, galiojanti visiems mėnesiams;
 *   period = '2026-09'   — to mėnesio išimtis, nustelbianti numatytąją.
 *
 * Ribos dedamos ant grupių (grupė irgi yra `categories` eilutė be tėvo). Išleista
 * suma imama tais pačiais principais kaip apžvalgoje: be vidinių pervedimų, be
 * skaidymo tėvinių eilučių, o sudengimai skaičiuojami dengiamos išlaidos mėnesį.
 */

/** Riba be konkretaus mėnesio — galioja visiems. */
export const NUMATYTA = "numatyta";

/** Iki kiek ribos laikoma, kad viskas gerai; iki 100 % — „baigiasi". */
const GERAI = 0.85;

export type BudgetRow = {
  id: number;
  category_id: number;
  period: string;
  planned_cents: number;
  note: string | null;
};

export type GrupesRow = { id: number; name: string; sort_order: number };
export type IslaiduRow = { group_id: number; cents: number };
export type PaskirstymoRow = { necessity: string | null; cents: number };

export type BudgetInput = {
  budgets: BudgetRow[];
  grupes: GrupesRow[];
  islaidos: IslaiduRow[];
  paskirstymas: PaskirstymoRow[];
  month: string;
};

export type Busena = "gerai" | "baigiasi" | "virsyta" | "neribota";

/** 50/30/20 taisyklė iš Excel — tikslai pagal kategorijos būtinumą. */
const TIKSLAI: Record<string, number> = {
  butinosios: 0.5,
  norai: 0.3,
  taupymas: 0.2,
};

const PASKIRSTYMO_VARDAI: Record<string, string> = {
  butinosios: "Būtinosios",
  norai: "Norai",
  taupymas: "Taupymas",
};

const dienuMenesyje = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function summarizeBudgets(input: BudgetInput, today: string) {
  const { month } = input;

  // Numatytoji riba, o jei tam mėnesiui nurodyta kita — ji nustelbia.
  const ribos = new Map<number, { cents: number; period: string }>();
  for (const b of input.budgets) {
    if (b.period === NUMATYTA) ribos.set(b.category_id, { cents: b.planned_cents, period: b.period });
  }
  for (const b of input.budgets) {
    if (b.period === month) ribos.set(b.category_id, { cents: b.planned_cents, period: b.period });
  }

  const islaidos = new Map(input.islaidos.map((i) => [i.group_id, i.cents]));

  // Kiek mėnesio praėjo — tik einamajam mėnesiui; praėjusiems jis pilnas.
  const viso = dienuMenesyje(month);
  const einamasis = today.slice(0, 7) === month;
  const praejo = einamasis ? Math.min(Number(today.slice(8, 10)), viso) : viso;
  const dalis = praejo / viso;

  const eilutes = input.grupes
    .map((g) => {
      const riba = ribos.get(g.id) ?? null;
      const islaista = islaidos.get(g.id) ?? 0;
      const plannedCents = riba?.cents ?? null;

      let busena: Busena = "neribota";
      if (plannedCents !== null && plannedCents > 0) {
        const santykis = islaista / plannedCents;
        busena = santykis > 1 ? "virsyta" : santykis > GERAI ? "baigiasi" : "gerai";
      }

      return {
        categoryId: g.id,
        name: g.name,
        plannedCents,
        /** Ar riba nustatyta tik šiam mėnesiui. */
        periodas: riba?.period ?? null,
        spentCents: islaista,
        pct: plannedCents && plannedCents > 0 ? islaista / plannedCents : null,
        leftCents: plannedCents === null ? null : plannedCents - islaista,
        /** Kiek turėtų būti išleista, jei tempas tolygus. */
        tempasCents: plannedCents === null ? null : Math.round(plannedCents * dalis),
        /** Kiek išeis mėnesio gale, jei tempas nesikeis. */
        prognozeCents: einamasis && dalis > 0 ? Math.round(islaista / dalis) : islaista,
        busena,
      };
    })
    .filter((e) => e.plannedCents !== null || e.spentCents > 0);

  const suRiba = eilutes.filter((e) => e.plannedCents !== null);
  const plannedCents = suRiba.reduce((s, e) => s + (e.plannedCents ?? 0), 0);
  const spentCents = eilutes.reduce((s, e) => s + e.spentCents, 0);
  const beRibosCents = eilutes
    .filter((e) => e.plannedCents === null)
    .reduce((s, e) => s + e.spentCents, 0);

  const paskirstymoViso = input.paskirstymas.reduce((s, p) => s + p.cents, 0);
  const paskirstymas = Object.keys(TIKSLAI).map((raktas) => {
    const cents = input.paskirstymas.find((p) => p.necessity === raktas)?.cents ?? 0;
    return {
      necessity: raktas,
      name: PASKIRSTYMO_VARDAI[raktas],
      cents,
      dalis: paskirstymoViso > 0 ? cents / paskirstymoViso : 0,
      tikslas: TIKSLAI[raktas],
    };
  });

  return {
    month,
    today,
    dienos: { praejo, viso, dalis },
    eilutes,
    /** Visos išlaidų grupės — kad būtų iš ko rinktis pridedant naują ribą. */
    grupes: input.grupes.map((g) => ({ id: g.id, name: g.name })),
    paskirstymas,
    totals: {
      plannedCents,
      spentCents,
      beRibosCents,
      /** Kiek išleista iš ribas turinčių grupių. */
      spentWithLimitCents: suRiba.reduce((s, e) => s + e.spentCents, 0),
      pct: plannedCents > 0 ? suRiba.reduce((s, e) => s + e.spentCents, 0) / plannedCents : null,
      tempasCents: Math.round(plannedCents * dalis),
      virsytos: eilutes.filter((e) => e.busena === "virsyta").length,
      beRibos: eilutes.filter((e) => e.plannedCents === null).length,
    },
  };
}

export async function buildBudgets(db: D1Database, month: string, today: string) {
  const [budgets, grupes, islaidos, paskirstymas] = await Promise.all([
    db.prepare("SELECT * FROM budgets").all<BudgetRow>(),

    db
      .prepare(
        `SELECT id, name, sort_order FROM categories
         WHERE parent_id IS NULL AND type = 'expense' ORDER BY sort_order`
      )
      .all<GrupesRow>(),

    db
      .prepare(
        `SELECT p.id AS group_id, SUM(-t.amount_cents) AS cents
         FROM transactions t
         LEFT JOIN transactions e ON e.id = t.offset_of_id
         JOIN categories c
           ON c.id = CASE WHEN t.offset_of_id IS NULL THEN t.category_id ELSE e.category_id END
         JOIN categories p ON p.id = c.parent_id
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND COALESCE(e.is_transfer, 0) = 0
           AND p.type = 'expense'
           AND substr(COALESCE(e.booking_date, t.booking_date), 1, 7) = ?
         GROUP BY p.id`
      )
      .bind(month)
      .all<IslaiduRow>(),

    db
      .prepare(
        `SELECT c.necessity, SUM(-t.amount_cents) AS cents
         FROM transactions t
         LEFT JOIN transactions e ON e.id = t.offset_of_id
         JOIN categories c
           ON c.id = CASE WHEN t.offset_of_id IS NULL THEN t.category_id ELSE e.category_id END
         JOIN categories p ON p.id = c.parent_id
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND COALESCE(e.is_transfer, 0) = 0
           AND p.type = 'expense'
           AND substr(COALESCE(e.booking_date, t.booking_date), 1, 7) = ?
         GROUP BY c.necessity`
      )
      .bind(month)
      .all<PaskirstymoRow>(),
  ]);

  return summarizeBudgets(
    {
      budgets: budgets.results,
      grupes: grupes.results,
      islaidos: islaidos.results,
      paskirstymas: paskirstymas.results,
      month,
    },
    today
  );
}

/** Nustatyti arba pakeisti ribą. Nulinė ar neigiama suma ribą panaikina. */
export async function saveBudget(
  db: D1Database,
  body: { categoryId?: number; period?: string; plannedCents?: number; note?: string | null }
) {
  if (typeof body.categoryId !== "number") throw new Error("Nenurodyta grupė.");

  const period = body.period && body.period !== NUMATYTA ? body.period : NUMATYTA;
  if (period !== NUMATYTA && !/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("Netinkamas laikotarpis.");
  }

  const grupe = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND parent_id IS NULL")
    .bind(body.categoryId)
    .first<{ id: number }>();
  if (!grupe) throw new Error("Ribas galima dėti tik grupėms.");

  if (!body.plannedCents || body.plannedCents <= 0) {
    await db
      .prepare("DELETE FROM budgets WHERE category_id = ? AND period = ?")
      .bind(body.categoryId, period)
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO budgets (category_id, period, planned_cents, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (category_id, period) DO UPDATE SET
         planned_cents = excluded.planned_cents,
         note = COALESCE(excluded.note, budgets.note)`
    )
    .bind(body.categoryId, period, Math.round(body.plannedCents), body.note ?? null)
    .run();
}

export type BudgetSummary = ReturnType<typeof summarizeBudgets>;
