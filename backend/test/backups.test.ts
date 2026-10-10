import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  buildDumpText,
  chunkSelectSql,
  fileName,
  isBackupKey,
  isDataTable,
  keysToPrune,
  orderTables,
} from "../src/backups";

const SCHEMA = `
  CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES items(id),
    note TEXT,
    amount REAL,
    cents INTEGER,
    raw BLOB
  );
  CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function newDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // D1 išorinius raktus tikrina visada — tikrinam ir čia.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/**
 * Tas pats, ką createDump daro su D1, tik per node:sqlite. Grupės dydis mažas, kad
 * net keli testo įrašai pasiskirstytų į kelis INSERT sakinius.
 */
function dump(db: DatabaseSync, chunkBytes = 120): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((r) => r.name)
    .filter(isDataTable);
  const links = db
    .prepare(
      `SELECT m.name AS child, f."table" AS parent FROM sqlite_master m
       JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table'`
    )
    .all() as { child: string; parent: string }[];
  const columns = (t: string) =>
    (db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").all(t) as { name: string }[]).map(
      (r) => r.name
    );

  const ordered = orderTables(tables, links).map((name) => {
    const chunks = db.prepare(chunkSelectSql(name, columns(name), chunkBytes)).all() as { n: number; s: string }[];
    return {
      name,
      columns: columns(name),
      chunks: chunks.map((c) => c.s),
      rows: chunks.reduce((sum, c) => sum + c.n, 0),
    };
  });
  return buildDumpText({ createdAt: "2026-10-11T02:00:00.000Z", label: "auto", schema: "0018_test.sql" }, ordered);
}

/** Atskiri sakiniai (be komentarų) — kaip juos mato D1. */
const statements = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/** D1 vykdo failą vienoje transakcijoje — taip ir čia, kad veiktų PRAGMA defer_foreign_keys. */
function restore(db: DatabaseSync, text: string) {
  db.exec("BEGIN");
  db.exec(text);
  db.exec("COMMIT");
}

describe("atsarginė kopija", () => {
  it("atkūrus kopiją, duomenys sutampa iki baito, o seni dingsta", () => {
    const source = newDb();
    source.exec(`
      INSERT INTO goals (id, name) VALUES (1, 'Atostogos'), (2, 'Rezervas „O''Brien“ 🙂 ąčęėįšųūž');
      INSERT INTO items (id, goal_id, parent_id, note, amount, cents, raw) VALUES
        (3, 1, NULL, 'kabutės '' ir "dvigubos"; kabliataškis -- ne komentaras', 0.1, 9007199254740993, NULL),
        (1, 1, 3, 'eilutė su' || char(10) || 'nauja eilute ir' || char(13) || char(10) || 'CRLF', 12.5, -12345, X'00FF'),
        (2, 2, NULL, NULL, NULL, 0, NULL),
        (4, NULL, 1, '', 1e-7, NULL, X'');
      INSERT INTO app_state (key, value) VALUES ('busena', '{"a":1}');
    `);
    const text = dump(source);

    // Taikinys su savais, kopijoje nesančiais duomenimis — jų po atkūrimo neturi likti.
    const target = newDb();
    target.exec(`
      INSERT INTO goals (id, name) VALUES (1, 'sena'), (9, 'perteklinė');
      INSERT INTO items (id, goal_id, note) VALUES (7, 9, 'turi dingti');
    `);
    restore(target, text);

    expect(dump(target)).toBe(text);
    expect(target.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 4 });
  });

  it("kiekviena įrašo eilutė telpa vienoje failo eilutėje", () => {
    const source = newDb();
    source.exec(`
      INSERT INTO goals (id, name) VALUES (1, 'a' || char(10) || 'b' || char(13) || 'c'), (2, 'kabliataškis; gale;');
      INSERT INTO items (id, goal_id, note) VALUES (5, 1, 'x;' || char(10) || ');');
    `);
    const lines = dump(source).split("\n");

    for (const line of lines) {
      const ok = line === "" || /^(--|PRAGMA |DELETE FROM |INSERT INTO "\w+" \(.*\) VALUES$|\(.*\)[,;]$)/.test(line);
      expect(ok, line).toBe(true);
    }
    // 3 įrašai — 3 reikšmių eilutės.
    expect(lines.filter((l) => l.startsWith("("))).toHaveLength(3);
  });

  it("didelė lentelė dalijama į kelis neilgus INSERT sakinius", () => {
    const source = newDb();
    source.exec("INSERT INTO goals (id, name) VALUES (1, 'x');");
    const insert = source.prepare("INSERT INTO items (goal_id, note, cents) VALUES (1, ?, ?)");
    for (let i = 0; i < 300; i++) insert.run(`įrašas nr. ${i} — ąčęėįšųūž`, i);

    const text = dump(source, 2_000);
    const inserts = statements(text).filter((s) => s.startsWith('INSERT INTO "items"'));

    expect(inserts.length).toBeGreaterThan(5);
    for (const s of inserts) expect(new TextEncoder().encode(s).byteLength).toBeLessThan(2_000 + 300);
    expect(text).toContain("--   items: 300");

    const target = newDb();
    restore(target, text);
    expect(dump(target, 2_000)).toBe(text);
  });

  it("antraštėje — versija ir eilučių skaičius kiekvienai lentelei", () => {
    const source = newDb();
    source.exec("INSERT INTO goals (id, name) VALUES (1, 'x'), (2, 'y');");
    const text = dump(source);

    expect(text).toContain("-- Duomenų bazės versija (paskutinė migracija): 0018_test.sql");
    expect(text).toContain("-- Lentelių: 3, eilučių: 2");
    expect(text).toContain("--   goals: 2");
    expect(text).toContain("(automatinė)");
    // Pirma atidedamas raktų tikrinimas, tada trinama: vaikinės pirmiau tėvinių.
    expect(text.indexOf("PRAGMA defer_foreign_keys = true;")).toBeLessThan(text.indexOf("DELETE FROM"));
    expect(text.indexOf('DELETE FROM "items"')).toBeLessThan(text.indexOf('DELETE FROM "goals"'));
  });
});

describe("lentelių tvarka", () => {
  it("tėvinės pirmiau vaikinių, nuorodos į save nekliudo", () => {
    const order = orderTables(
      ["transactions", "rules", "categories", "accounts"],
      [
        { child: "transactions", parent: "accounts" },
        { child: "transactions", parent: "categories" },
        { child: "transactions", parent: "rules" },
        { child: "transactions", parent: "transactions" },
        { child: "rules", parent: "categories" },
        { child: "categories", parent: "categories" },
      ]
    );

    expect(order).toEqual(["accounts", "categories", "rules", "transactions"]);
  });

  it("ciklas tarp lentelių neužstringa", () => {
    const order = orderTables(
      ["a", "b", "c"],
      [
        { child: "a", parent: "b" },
        { child: "b", parent: "a" },
        { child: "a", parent: "nera" },
      ]
    );

    expect([...order].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("kopijų saugykla", () => {
  it("palieka tik naujausias", () => {
    const keys = [
      "auto/2026-10-04T02:00:01.000Z",
      "auto/2026-10-18T02:00:01.000Z",
      "auto/2026-09-27T02:00:01.000Z",
      "auto/2026-10-11T02:00:01.000Z",
    ];

    expect(keysToPrune(keys, 2)).toEqual(["auto/2026-10-04T02:00:01.000Z", "auto/2026-09-27T02:00:01.000Z"]);
    expect(keysToPrune(keys, 12)).toEqual([]);
  });

  it("atsisiųsti leidžia tik kopijų raktus", () => {
    expect(isBackupKey("auto/2026-10-11T02:00:03.123Z")).toBe(true);
    expect(isBackupKey("rankine/2026-10-11T02:00:03Z")).toBe(true);
    expect(isBackupKey("auto/2026-10-11")).toBe(false);
    expect(isBackupKey("kita/2026-10-11T02:00:03Z")).toBe(false);
    expect(isBackupKey("auto/../2026-10-11T02:00:03Z")).toBe(false);
  });

  it("nekopijuoja vidinių lentelių", () => {
    expect(["transactions", "app_state", "sqlite_sequence", "_cf_METADATA", "d1_migrations"].filter(isDataTable)).toEqual([
      "transactions",
      "app_state",
    ]);
  });

  it("failo vardas pagal datą ir rūšį", () => {
    expect(fileName("2026-10-11T02:00:01.000Z", "auto")).toBe("namai-2026-10-11-automatine.sql");
    expect(fileName("2026-10-11T19:30:00.000Z", "rankine")).toBe("namai-2026-10-11-rankine.sql");
    expect(fileName("2026-10-11T19:30:00.000Z", "parsisiusta")).toBe("namai-2026-10-11.sql");
  });
});
