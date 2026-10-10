import { categorize, type CategoryRow, type Rule } from "./rules";

export type NewRule = {
  field: Rule["field"];
  operator: Rule["operator"];
  value: string;
  categoryId?: number | null;
  ownerCategoryName?: string | null;
  markTransfer?: boolean;
  direction?: "D" | "C" | null;
  note?: string | null;
};

export async function listRules(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT r.*, c.name AS category_name, p.name AS group_name,
              (SELECT COUNT(*) FROM transactions t WHERE t.rule_id = r.id) AS pritaikyta
       FROM rules r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       ORDER BY r.priority, r.id`
    )
    .all();
  return results;
}

export async function createRule(db: D1Database, input: NewRule): Promise<number> {
  if (!input.value.trim()) {
    throw new Error("Taisyklė be reikšmės neturi prasmės.");
  }

  // Naujos taisyklės eina po pradinių, kad vartotojo kurtos nenustelbtų
  // vidinių pervedimų atpažinimo, bet nusileistų jau esamoms tikslesnėms.
  const last = await db
    .prepare("SELECT COALESCE(MAX(priority), 100) AS max_priority FROM rules")
    .first<{ max_priority: number }>();

  const created = await db
    .prepare(
      `INSERT INTO rules (priority, field, operator, value, category_id,
                          owner_category_name, mark_transfer, direction, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(
      (last?.max_priority ?? 100) + 10,
      input.field,
      input.operator,
      input.value.trim(),
      input.categoryId ?? null,
      input.ownerCategoryName ?? null,
      input.markTransfer ? 1 : 0,
      input.direction ?? null,
      input.note ?? null
    )
    .first<{ id: number }>();

  return created!.id;
}

export async function deleteRule(db: D1Database, id: number): Promise<void> {
  // Operacijų, kurias taisyklė jau priskyrė, neliečiam — kategorija lieka,
  // tik nutrūksta ryšys su nebeegzistuojančia taisykle.
  await db.prepare("UPDATE transactions SET rule_id = NULL WHERE rule_id = ?").bind(id).run();
  await db.prepare("DELETE FROM rules WHERE id = ?").bind(id).run();
}

export async function setRuleActive(db: D1Database, id: number, active: boolean): Promise<void> {
  await db.prepare("UPDATE rules SET is_active = ? WHERE id = ?").bind(active ? 1 : 0, id).run();
}

/**
 * Pritaiko vieną taisyklę jau importuotoms, bet dar nepriskirtoms operacijoms.
 * Tam ir kuriamos taisyklės iš sąrašo: pataisai vieną, sutvarkai visas panašias.
 */
export async function applyRuleToExisting(db: D1Database, ruleId: number): Promise<number> {
  const rule = await db.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<Rule>();
  if (!rule) return 0;

  const [categories, pending] = await Promise.all([
    db.prepare("SELECT id, name, parent_id FROM categories").all<CategoryRow>(),
    db
      .prepare(
        `SELECT t.id, t.counterparty_name, t.description, t.amount_cents, t.country, a.owner
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.category_id IS NULL AND t.is_transfer = 0 AND t.is_split_parent = 0
           AND t.offset_of_id IS NULL`
      )
      .all<{
        id: number;
        counterparty_name: string | null;
        description: string | null;
        amount_cents: number;
        country: string | null;
        owner: string | null;
      }>(),
  ]);

  const updates: { id: number; categoryId: number | null; isTransfer: boolean }[] = [];

  for (const row of pending.results) {
    const verdict = categorize(
      {
        counterpartyName: row.counterparty_name,
        description: row.description,
        amountCents: row.amount_cents,
        country: row.country,
      },
      [rule],
      categories.results,
      row.owner
    );

    if (verdict.categoryId !== null || verdict.isTransfer) {
      updates.push({ id: row.id, categoryId: verdict.categoryId, isTransfer: verdict.isTransfer });
    }
  }

  if (updates.length === 0) return 0;

  const statement = db.prepare(
    "UPDATE transactions SET category_id = ?, is_transfer = ?, rule_id = ? WHERE id = ?"
  );
  await db.batch(
    updates.map((u) => statement.bind(u.categoryId, u.isTransfer ? 1 : 0, ruleId, u.id))
  );

  return updates.length;
}
