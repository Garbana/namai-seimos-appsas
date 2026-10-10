type OffsetRow = {
  id: number;
  amount_cents: number;
  is_split_parent: number;
  is_transfer: number;
  offset_of_id: number | null;
};

const eur = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;

/**
 * Susieja įplaukas su išlaida, kurią jos dengia. Įplaukos netenka kategorijos:
 * sumose jos skaičiuojamos išlaidos kategorijoje ir išlaidos mėnesį.
 *
 * Viena įplauka dengia tik vieną išlaidą — jei draudimas kompensavo du vizitus
 * vienu pervedimu, įplauka pirma suskaidoma. Sudengti daugiau, nei kainavo
 * išlaida, neleidžiama: perteklius yra kažkas kita ir turi būti atskirtas.
 */
export async function linkOffsets(
  db: D1Database,
  expenseId: number,
  incomeIds: number[]
): Promise<{ linked: number }> {
  const ids = [...new Set(Array.isArray(incomeIds) ? incomeIds.map(Number) : [])];
  if (ids.length === 0) throw new Error("Nepasirinkta nė viena įplauka.");
  if (ids.includes(expenseId)) throw new Error("Operacija negali dengti pati savęs.");

  const select = `SELECT id, amount_cents, is_split_parent, is_transfer, offset_of_id FROM transactions`;

  const expense = await db
    .prepare(`${select} WHERE id = ?`)
    .bind(expenseId)
    .first<OffsetRow>();

  if (!expense) throw new Error("Tokios išlaidos nėra.");
  if (expense.amount_cents >= 0) throw new Error("Sudengti galima tik išlaidą.");
  if (expense.is_split_parent) {
    throw new Error("Ši išlaida suskaidyta — sudengimą pridėk prie konkrečios jos dalies.");
  }
  if (expense.is_transfer) throw new Error("Vidinio pervedimo sudengti negalima.");

  const placeholders = ids.map(() => "?").join(",");
  const { results: incomes } = await db
    .prepare(`${select} WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<OffsetRow>();

  if (incomes.length !== ids.length) throw new Error("Kai kurių pasirinktų įplaukų nebėra.");

  for (const income of incomes) {
    if (income.amount_cents <= 0) throw new Error("Išlaidą dengti gali tik įplauka.");
    if (income.is_split_parent) {
      throw new Error("Įplauka suskaidyta — rinkis konkrečią jos dalį.");
    }
    if (income.offset_of_id !== null) {
      throw new Error("Viena iš įplaukų jau dengia kitą išlaidą — pirma ją atsiek.");
    }
  }

  const existing = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE offset_of_id = ?")
    .bind(expenseId)
    .first<{ total: number }>();

  const total = (existing?.total ?? 0) + incomes.reduce((s, i) => s + i.amount_cents, 0);
  if (total > -expense.amount_cents) {
    throw new Error(
      `Sudengimai (${eur(total)}) viršytų išlaidą (${eur(-expense.amount_cents)}). ` +
        "Perteklių pirma atskirk skaidymu."
    );
  }

  const update = db.prepare(
    "UPDATE transactions SET offset_of_id = ?, category_id = NULL, rule_id = NULL, is_transfer = 0 WHERE id = ?"
  );
  await db.batch(ids.map((id) => update.bind(expenseId, id)));

  return { linked: ids.length };
}

/** Atsieja įplauką — ji vėl tampa paprasta, dar nepriskirta įplauka. */
export async function unlinkOffset(db: D1Database, incomeId: number): Promise<void> {
  const result = await db
    .prepare("UPDATE transactions SET offset_of_id = NULL WHERE id = ? AND offset_of_id IS NOT NULL")
    .bind(incomeId)
    .run();

  if (!result.meta.changes) throw new Error("Ši operacija nėra sudengimas.");
}
