export type NewCategory = { name?: string; parentId?: number; subgroup?: string | null };

type GroupRow = { id: number; name: string; type: string; parent_id: number | null };

/**
 * Nauja kategorija esamoje grupėje. Tipas (išlaidos/pajamos) paveldimas iš
 * grupės, o vieta sąraše — grupės gale, kad nesumaišytų esamos tvarkos.
 */
export async function createCategory(db: D1Database, input: NewCategory) {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Įrašyk kategorijos pavadinimą.");
  if (name.length > 60) throw new Error("Pavadinimas per ilgas — daugiausia 60 simbolių.");

  const group = await db
    .prepare("SELECT id, name, type, parent_id FROM categories WHERE id = ?")
    .bind(Number(input.parentId))
    .first<GroupRow>();

  if (!group || group.parent_id !== null) {
    throw new Error("Pasirink grupę, kuriai priklausys kategorija.");
  }
  if (group.type === "transfer") {
    throw new Error("Vidinių pervedimų grupėje kategorijų kurti negalima.");
  }

  const existing = await db
    .prepare("SELECT name FROM categories WHERE parent_id = ?")
    .bind(group.id)
    .all<{ name: string }>();
  // Palyginimas JS'e, nes SQLite lower() nemoka lietuviškų raidžių.
  if (existing.results.some((c) => c.name.toLocaleLowerCase("lt") === name.toLocaleLowerCase("lt"))) {
    throw new Error(`Grupėje „${group.name}" kategorija „${name}" jau yra.`);
  }

  // Poskyris (pvz., „Būreliai“) — neprivalomas.
  const subgroup = typeof input.subgroup === "string" && input.subgroup.trim() ? input.subgroup.trim().slice(0, 40) : null;

  return db
    .prepare(
      `INSERT INTO categories (name, parent_id, type, necessity, sort_order, subgroup)
       VALUES (?, ?, ?, NULL, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE parent_id = ?), ?)
       RETURNING id, name, parent_id, type, necessity, sort_order, subgroup`
    )
    .bind(name, group.id, group.type, group.id, subgroup)
    .first();
}
