/**
 * Tiek D1 API, kiek reikia testams, ant Node `node:sqlite`: prepare/bind/first/all/run
 * ir batch vienoje transakcijoje (kaip D1). Išoriniai raktai įjungti, kaip D1.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
// @ts-expect-error — scenarijus be tipų (scripts/*.mjs)
import { seimosSql } from "../scripts/sukurti-seima.mjs";

export function fakeD1(...migrations: string[]): D1Database {
  return fromSql(migrations.map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")));
}

function fromSql(scripts: string[]): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const sql of scripts) sqlite.exec(sql);

  const prepare = (sql: string) => {
    let params: SQLInputValue[] = [];
    const statement = {
      bind(...values: unknown[]) {
        params = values as SQLInputValue[];
        return statement;
      },
      async first<T>() {
        return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: sqlite.prepare(sql).all(...params) as T[], success: true, meta: {} };
      },
      async run() {
        const r = sqlite.prepare(sql).run(...params);
        return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return statement;
  };

  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.all());
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

/** Visos migracijos iš eilės. */
export const MIGRATIONS = readdirSync(new URL("../migrations", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Pavyzdinė šeima (seima.pavyzdys.json): Jonas (1), Rūta (2), vaikas Ema (3). */
const PAVYZDYS = JSON.parse(readFileSync(new URL("../../seima.pavyzdys.json", import.meta.url), "utf8"));

/**
 * Visa bazė, kaip ją sukuria diegimas: migracijos ir pavyzdinė šeima
 * (scripts/sukurti-seima.mjs) — kai testui reikia visos bazės (darbai ir finansai susiję).
 */
export const visaBaze = () =>
  fromSql([...MIGRATIONS.map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8")), seimosSql(PAVYZDYS)]);
