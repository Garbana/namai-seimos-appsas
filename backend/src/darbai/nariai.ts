import { id, KlaidaVartotojui, text } from "./bendra";

export interface Member {
  id: number;
  name: string;
  color: string;
  uses_app: number;
}

export interface Area {
  id: number;
  name: string;
  icon: string | null;
  default_member_id: number | null;
  sort_order: number;
}

export async function listMembers(db: D1Database): Promise<Member[]> {
  const { results } = await db
    .prepare("SELECT id, name, color, uses_app FROM members WHERE is_active = 1 ORDER BY sort_order, id")
    .all<Member>();
  return results;
}

/** Kas atliko veiksmą: tik esamas narys arba niekas. */
export async function actingMember(db: D1Database, value: unknown): Promise<number | null> {
  const memberId = id(value, "narys");
  if (memberId === null) return null;
  const row = await db
    .prepare("SELECT id FROM members WHERE id = ? AND is_active = 1")
    .bind(memberId)
    .first<{ id: number }>();
  if (!row) throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
  return memberId;
}

// ---------- Sritys ----------

export async function listAreas(db: D1Database): Promise<Area[]> {
  const { results } = await db
    .prepare("SELECT id, name, icon, default_member_id, sort_order FROM task_areas ORDER BY sort_order, id")
    .all<Area>();
  return results;
}

export interface AreaInput {
  name?: unknown;
  icon?: unknown;
  defaultMemberId?: unknown;
}

function areaValues(input: AreaInput) {
  const name = text(input.name, "pavadinimas", 40);
  if (!name) throw new KlaidaVartotojui("Sričiai reikia pavadinimo.");
  return { name, icon: text(input.icon, "ikona", 8), defaultMemberId: id(input.defaultMemberId, "atsakingas") };
}

/** UNIQUE pažeidimas — žmogui suprantama žinute. */
async function uniqueName<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new KlaidaVartotojui("Tokia sritis jau yra.");
    }
    throw error;
  }
}

export async function createArea(db: D1Database, input: AreaInput): Promise<Area> {
  const v = areaValues(input);
  const row = await uniqueName(
    db
      .prepare(
        `INSERT INTO task_areas (name, icon, default_member_id, sort_order)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_areas))
         RETURNING id, name, icon, default_member_id, sort_order`
      )
      .bind(v.name, v.icon, v.defaultMemberId)
      .first<Area>()
  );
  return row!;
}

export async function updateArea(db: D1Database, areaId: number, input: AreaInput): Promise<Area> {
  const v = areaValues(input);
  const row = await uniqueName(
    db
      .prepare(
        `UPDATE task_areas SET name = ?, icon = ?, default_member_id = ? WHERE id = ?
         RETURNING id, name, icon, default_member_id, sort_order`
      )
      .bind(v.name, v.icon, v.defaultMemberId, areaId)
      .first<Area>()
  );
  if (!row) throw new KlaidaVartotojui("Tokios srities nėra.");
  return row;
}

/** Srities užduotys lieka — tik be srities (ON DELETE SET NULL). */
export async function deleteArea(db: D1Database, areaId: number): Promise<void> {
  await db.prepare("DELETE FROM task_areas WHERE id = ?").bind(areaId).run();
}
