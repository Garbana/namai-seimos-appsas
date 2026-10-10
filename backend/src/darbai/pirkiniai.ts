/**
 * Pirkinių sąrašai. Nupirkta prekė neištrinama, tik pažymima (checked_at): sąraše ji
 * rodoma „Nupirkta“ dalyje. Kiekvienas „nupirkta“ įrašomas į shopping_purchases — iš tos
 * istorijos siūlomos dažnai perkamos prekės. Skyriai — skyriai.ts.
 */
import { id, KlaidaVartotojui, text } from "./bendra";
import { isSection, learnedSections, rememberSection, SECTIONS, sectionFrom, type Section } from "./skyriai";

export interface ShoppingList {
  id: number;
  name: string;
  sort_order: number;
}

export interface ShoppingItem {
  id: number;
  list_id: number;
  name: string;
  quantity: string | null;
  added_by: number | null;
  added_at: string;
  checked_at: string | null;
  checked_by: number | null;
  /** Parduotuvės skyrius (jei nenurodytas — atspėtas iš pavadinimo). */
  section: string | null;
}

/** Dažnai perkama prekė, kurios dabar sąraše nėra, o pagal įprotį jau laikas. */
export interface Suggestion {
  list_id: number;
  name: string;
  /** Kas kiek dienų paprastai perkama. */
  every_days: number;
  last_bought: string;
}

export interface ItemInput {
  listId?: unknown;
  name?: unknown;
  quantity?: unknown;
  checked?: unknown;
  section?: unknown;
}

const ITEM = "id, list_id, name, quantity, added_by, added_at, checked_at, checked_by, section";

/** Kiek laiko nupirktos rodomos sąraše. */
const BOUGHT_DAYS = 30;
/** Pasiūlymams: kiek laiko atgal žiūrima į istoriją ir kiek kartų turi būti pirkta. */
const HISTORY_DAYS = 180;
const MIN_PURCHASES = 3;
const MAX_SUGGESTIONS = 6;

const DAY_MS = 86_400_000;

export async function listShopping(
  db: D1Database,
  now = new Date()
): Promise<{ lists: ShoppingList[]; items: ShoppingItem[]; suggestions: Suggestion[]; sections: readonly string[] }> {
  const since = new Date(now.getTime() - BOUGHT_DAYS * DAY_MS).toISOString();
  const [lists, items] = await db.batch([
    db.prepare("SELECT id, name, sort_order FROM shopping_lists ORDER BY sort_order, id"),
    db
      .prepare(
        `SELECT ${ITEM} FROM shopping_items WHERE checked_at IS NULL OR checked_at >= ?
         ORDER BY checked_at IS NOT NULL, checked_at DESC, added_at DESC, id DESC`
      )
      .bind(since),
  ]);
  const learned = await learnedSections(db);
  const rows = (items.results as unknown as ShoppingItem[]).map((i) => ({ ...i, section: i.section ?? sectionFrom(learned, i.name) }));
  return {
    lists: lists.results as unknown as ShoppingList[],
    items: rows,
    suggestions: await suggestions(db, rows, now),
    // Skyriai parduotuvės tvarka — ekranas pagal juos grupuoja.
    sections: SECTIONS,
  };
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase("lt") === b.toLocaleLowerCase("lt");

/**
 * „Gal reikia?“ — prekės, pirktos bent MIN_PURCHASES kartus per pusmetį, kurių dabar sąraše
 * nėra, o nuo paskutinio pirkimo praėjo bent ~80 % įprasto tarpo. Vienos dienos pirkimai
 * skaičiuojami kaip vienas.
 */
export async function suggestions(db: D1Database, open: ShoppingItem[], now = new Date()): Promise<Suggestion[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare("SELECT list_id, name, bought_at FROM shopping_purchases WHERE bought_at >= ? ORDER BY bought_at")
    .bind(since)
    .all<{ list_id: number; name: string; bought_at: string }>();

  const byItem = new Map<string, { list_id: number; name: string; days: string[] }>();
  for (const r of results) {
    const key = `${r.list_id}|${r.name.toLocaleLowerCase("lt")}`;
    const entry = byItem.get(key) ?? { list_id: r.list_id, name: r.name, days: [] };
    const day = r.bought_at.slice(0, 10);
    if (entry.days.at(-1) !== day) entry.days.push(day);
    entry.name = r.name;
    byItem.set(key, entry);
  }

  const onList = new Set(open.filter((i) => !i.checked_at).map((i) => `${i.list_id}|${i.name.toLocaleLowerCase("lt")}`));
  const out: (Suggestion & { overdue: number })[] = [];
  for (const [key, e] of byItem) {
    if (e.days.length < MIN_PURCHASES || onList.has(key)) continue;
    const first = Date.parse(e.days[0]);
    const last = Date.parse(e.days.at(-1)!);
    const every = (last - first) / DAY_MS / (e.days.length - 1);
    if (every < 1) continue;
    const since = (now.getTime() - last) / DAY_MS;
    if (since < every * 0.8) continue;
    out.push({ list_id: e.list_id, name: e.name, every_days: Math.round(every), last_bought: e.days.at(-1)!, overdue: since / every });
  }
  return out
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ overdue: _, ...s }) => s);
}

/**
 * Prideda prekę. Jei tokia jau yra tame sąraše — ji grąžinama į pirktinas (ir
 * atnaujinamas kiekis), o ne dubliuojama: „pienas“ du kartus sąraše nieko neduoda.
 * Skyrius — nurodytas arba parinktas pats (skyriai.ts).
 */
export async function addItem(
  db: D1Database,
  input: ItemInput,
  memberId: number | null,
  now = new Date()
): Promise<ShoppingItem> {
  const listId = id(input.listId, "sąrašas");
  if (listId === null) throw new KlaidaVartotojui("Nepasirinktas sąrašas.");
  const name = text(input.name, "prekė", 100);
  if (!name) throw new KlaidaVartotojui("Įrašyk, ką nupirkti.");
  const quantity = text(input.quantity, "kiekis", 30);
  const at = now.toISOString();
  const section: Section = isSection(input.section) ? input.section : sectionFrom(await learnedSections(db), name);

  const { results } = await db
    .prepare("SELECT id, name FROM shopping_items WHERE list_id = ?")
    .bind(listId)
    .all<{ id: number; name: string }>();
  const existing = results.find((r) => sameName(r.name, name));

  if (existing) {
    const row = await db
      .prepare(
        `UPDATE shopping_items SET checked_at = NULL, checked_by = NULL, quantity = ?, added_by = ?, added_at = ?,
           section = COALESCE(section, ?)
         WHERE id = ? RETURNING ${ITEM}`
      )
      .bind(quantity, memberId, at, section, existing.id)
      .first<ShoppingItem>();
    return row!;
  }

  const row = await db
    .prepare(
      `INSERT INTO shopping_items (list_id, name, quantity, added_by, added_at, section)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${ITEM}`
    )
    .bind(listId, name, quantity, memberId, at, section)
    .first<ShoppingItem>();
  return row!;
}

export async function updateItem(
  db: D1Database,
  itemId: number,
  input: ItemInput,
  memberId: number | null,
  now = new Date()
): Promise<ShoppingItem> {
  const item = await db.prepare(`SELECT ${ITEM} FROM shopping_items WHERE id = ?`).bind(itemId).first<ShoppingItem>();
  if (!item) throw new KlaidaVartotojui("Tokios prekės nebėra — gal ją kas tik ką ištrynė.");

  const name = input.name === undefined ? item.name : text(input.name, "prekė", 100);
  if (!name) throw new KlaidaVartotojui("Prekei reikia pavadinimo.");
  const quantity = input.quantity === undefined ? item.quantity : text(input.quantity, "kiekis", 30);
  if (input.section !== undefined && !isSection(input.section)) throw new KlaidaVartotojui("Tokio skyriaus nėra.");
  const section = input.section === undefined ? item.section : (input.section as Section);

  let checkedAt = item.checked_at;
  let checkedBy = item.checked_by;
  const statements: D1PreparedStatement[] = [];
  if (input.checked !== undefined && Boolean(input.checked) !== (item.checked_at !== null)) {
    checkedAt = input.checked ? now.toISOString() : null;
    checkedBy = input.checked ? memberId : null;
    statements.push(
      input.checked
        ? db
            .prepare("INSERT INTO shopping_purchases (list_id, item_id, name, bought_at, bought_by) VALUES (?, ?, ?, ?, ?)")
            .bind(item.list_id, itemId, name, checkedAt, memberId)
        : // „Vėl reikia“ — tas pirkimas neįvyko (dažniausiai pažymėta per klaidą).
          db.prepare("DELETE FROM shopping_purchases WHERE item_id = ? AND bought_at = ?").bind(itemId, item.checked_at)
    );
  }

  statements.unshift(
    db
      .prepare(`UPDATE shopping_items SET name = ?, quantity = ?, checked_at = ?, checked_by = ?, section = ? WHERE id = ? RETURNING ${ITEM}`)
      .bind(name, quantity, checkedAt, checkedBy, section, itemId)
  );
  const [updated] = await db.batch(statements);
  if (input.section !== undefined && section !== null) await rememberSection(db, name, section as Section, now);
  return (updated.results as unknown as ShoppingItem[])[0];
}

export async function deleteItem(db: D1Database, itemId: number): Promise<void> {
  await db.prepare("DELETE FROM shopping_items WHERE id = ?").bind(itemId).run();
}
