export type MonthTotals = {
  month: string;
  income: number;
  expense: number;
};

export type GroupCell = {
  month: string;
  groupId: number | null;
  groupName: string;
  /** Kurioje pusėje eilutė skaičiuojama. Nepriskirtos operacijos skirstomos
   *  pagal ženklą, kad nepriskirtos įplaukos neatsidurtų tarp išlaidų. */
  side: "income" | "expense";
  amount: number;
  count: number;
};

export type Overview = {
  months: MonthTotals[];
  cells: GroupCell[];
};

/**
 * Mėnesio suvestinė pagal grupes — tas pats pjūvis, kaip „Šeimos buhalterijos"
 * lape „Bendras": mėnesiai stulpeliais, grupės eilutėmis.
 *
 * Vidiniai pervedimai neįskaičiuojami (tai nei pajamos, nei išlaidos), o
 * suskaidytų operacijų tėvinės eilutės praleidžiamos, kad sumos nesidubliuotų.
 *
 * Sudengimai (įplaukos su `offset_of_id`) skaičiuojami ne savo, o dengiamos
 * išlaidos mėnesį ir kategorijoje — todėl `e` prijungiama ir mėnuo bei
 * kategorija imami iš jos.
 */
export async function buildOverview(db: D1Database): Promise<Overview> {
  const [totals, groups] = await Promise.all([
    db
      .prepare(
        `SELECT substr(COALESCE(e.booking_date, t.booking_date), 1, 7) AS month,
                COALESCE(SUM(CASE WHEN t.offset_of_id IS NULL AND t.amount_cents > 0
                                  THEN t.amount_cents END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.offset_of_id IS NOT NULL OR t.amount_cents < 0
                                  THEN t.amount_cents END), 0) AS expense
         FROM transactions t
         LEFT JOIN transactions e ON e.id = t.offset_of_id
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND COALESCE(e.is_transfer, 0) = 0
         GROUP BY month
         ORDER BY month`
      )
      .all<MonthTotals>(),

    db
      .prepare(
        `SELECT substr(COALESCE(e.booking_date, t.booking_date), 1, 7) AS month,
                COALESCE(p.id, c.id) AS groupId,
                CASE
                  WHEN c.id IS NULL AND COALESCE(e.amount_cents, t.amount_cents) > 0
                    THEN 'Be kategorijos (įplaukos)'
                  WHEN c.id IS NULL THEN 'Be kategorijos'
                  ELSE COALESCE(p.name, c.name)
                END AS groupName,
                CASE
                  WHEN c.id IS NULL THEN
                    CASE WHEN COALESCE(e.amount_cents, t.amount_cents) > 0 THEN 'income' ELSE 'expense' END
                  WHEN COALESCE(p.type, c.type) = 'income' THEN 'income'
                  ELSE 'expense'
                END AS side,
                SUM(t.amount_cents) AS amount,
                SUM(CASE WHEN t.offset_of_id IS NULL THEN 1 ELSE 0 END) AS count
         FROM transactions t
         LEFT JOIN transactions e ON e.id = t.offset_of_id
         LEFT JOIN categories c
           ON c.id = CASE WHEN t.offset_of_id IS NULL THEN t.category_id ELSE e.category_id END
         LEFT JOIN categories p ON p.id = c.parent_id
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND COALESCE(e.is_transfer, 0) = 0
         GROUP BY month, groupId, side
         ORDER BY month`
      )
      .all<GroupCell>(),
  ]);

  return { months: totals.results, cells: groups.results };
}

export type CategoryCell = {
  month: string;
  categoryId: number;
  categoryName: string;
  sortOrder: number;
  amount: number;
  count: number;
};

/**
 * Vienos grupės pjūvis: kategorijos eilutėmis, mėnesiai stulpeliais — tas pats,
 * ką Excel'yje matai atsivertęs, pavyzdžiui, „Komunaliniai" lapą.
 */
export type GroupCategoryCell = CategoryCell & {
  /** 1 — kategorija iš kitos grupės, primesta kaip papildomas pjūvis (group_related_categories). */
  related: number;
  originGroupName: string | null;
  /** Poskyris grupės viduje (pvz., „Būreliai“), jei kategorija jam priklauso. */
  subgroup: string | null;
};

export async function buildGroupOverview(db: D1Database, groupId: number): Promise<GroupCategoryCell[]> {
  const { results } = await db
    .prepare(
      `SELECT substr(COALESCE(e.booking_date, t.booking_date), 1, 7) AS month,
              c.id AS categoryId,
              c.name AS categoryName,
              CASE WHEN r.category_id IS NULL THEN c.sort_order ELSE 100000 + r.sort_order END AS sortOrder,
              CASE WHEN r.category_id IS NULL THEN 0 ELSE 1 END AS related,
              CASE WHEN r.category_id IS NULL THEN NULL ELSE g.name END AS originGroupName,
              CASE WHEN r.category_id IS NULL THEN c.subgroup ELSE NULL END AS subgroup,
              SUM(t.amount_cents) AS amount,
              SUM(CASE WHEN t.offset_of_id IS NULL THEN 1 ELSE 0 END) AS count
       FROM transactions t
       LEFT JOIN transactions e ON e.id = t.offset_of_id
       JOIN categories c
         ON c.id = CASE WHEN t.offset_of_id IS NULL THEN t.category_id ELSE e.category_id END
       LEFT JOIN categories g ON g.id = c.parent_id
       LEFT JOIN group_related_categories r ON r.group_id = ? AND r.category_id = c.id
       WHERE t.is_split_parent = 0
         AND (c.parent_id = ? OR (c.id = ? AND c.parent_id IS NULL) OR r.category_id IS NOT NULL)
       GROUP BY month, c.id
       ORDER BY month`
    )
    .bind(groupId, groupId, groupId)
    .all<GroupCategoryCell>();

  return results;
}
