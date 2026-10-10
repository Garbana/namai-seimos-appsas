import { describe, expect, it } from "vitest";
import { dismissSuggestion, linkTransaction, projectBank, projectSavings, transactionProject, unlinkTransaction } from "../src/darbai/bankas";
import { createCost, createProject, deleteProject, getProject, recordTaskCost, updateCost } from "../src/darbai/projektai";
import { syncFinanceDeadlines } from "../src/darbai/terminai";
import { deleteTask } from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
/** 2026-10-10, šeštadienis, 9:00 Vilniuje. */
const NOW = new Date("2026-10-10T06:00:00Z");
const TODAY = "2026-10-10";

async function setup() {
  const d = visaBaze();
  await d.prepare("INSERT INTO accounts (id, bank, name, owner) VALUES (1, 'seb', 'SEB', 'Jonas')").run();
  const tx = async (date: string, cents: number, name: string, extra: { transfer?: number; split?: number } = {}) =>
    (
      await d
        .prepare(
          "INSERT INTO transactions (account_id, booking_date, amount_cents, counterparty_name, is_transfer, is_split_parent) VALUES (1, ?, ?, ?, ?, ?) RETURNING id"
        )
        .bind(date, cents, name, extra.transfer ?? 0, extra.split ?? 0)
        .first<{ id: number }>()
    )!.id;
  const projectId = await createProject(
    d,
    {
      title: "Emos gimtadienis",
      targetDate: "2026-11-14",
      sections: [{ name: "Maistas", tasks: [{ title: "Užsakyti tortą", dueDate: "2026-11-09" }] }],
      costs: [
        { name: "Tortas", plannedCents: 6000, isEstimate: true, taskTitle: "Užsakyti tortą" },
        { name: "Žaidimų kambarys", plannedCents: 12000, isEstimate: true },
      ],
    },
    JONAS,
    NOW
  );
  const { costs } = await getProject(d, projectId);
  const cost = (name: string) => costs.find((c) => c.name === name)!.id;
  return { d, tx, projectId, tortas: cost("Tortas"), kambarys: cost("Žaidimų kambarys") };
}

describe("projektas ↔ banko operacijos", () => {
  it("susieta operacija tampa eilutės faktu; ranka įvesta suma pasilieka ir grįžta atsiejus", async () => {
    const { d, tx, projectId, tortas } = await setup();
    await updateCost(d, tortas, { actualCents: 5000 });
    const op = await tx("2026-11-08", -6550, "KONDITERIJA TORTAI");

    await linkTransaction(d, projectId, { transactionId: op, costId: tortas }, JONAS, NOW);
    let c = (await getProject(d, projectId)).costs.find((x) => x.id === tortas)!;
    expect(c).toMatchObject({ actual_cents: 6550, manual_actual_cents: 5000, bank_links: 1 });

    // Ranka keičiant faktą, kol yra banko operacija — bankas laimi, ranka įvesta pasilieka atsargai.
    await updateCost(d, tortas, { actualCents: 4000 });
    await recordTaskCost(d, (await d.prepare("SELECT id FROM tasks WHERE title = 'Užsakyti tortą'").first<{ id: number }>())!.id, 4500);
    c = (await getProject(d, projectId)).costs.find((x) => x.id === tortas)!;
    expect(c).toMatchObject({ actual_cents: 6550, manual_actual_cents: 4500 });

    await unlinkTransaction(d, op);
    c = (await getProject(d, projectId)).costs.find((x) => x.id === tortas)!;
    expect(c).toMatchObject({ actual_cents: 4500, manual_actual_cents: null, bank_links: 0 });
    await expect(unlinkTransaction(d, op)).rejects.toThrow("nepriskirta");
  });

  it("be eilutės — sukuriama nauja gavėjo vardu; perkėlus į kitą projektą — pirmajame nebelieka", async () => {
    const { d, tx, projectId } = await setup();
    const op = await tx("2026-11-01", -2380, "MAXIMA LT");
    await linkTransaction(d, projectId, { transactionId: op }, JONAS, NOW);
    const line = (await getProject(d, projectId)).costs.find((c) => c.name === "MAXIMA LT")!;
    expect(line).toMatchObject({ actual_cents: 2380 });
    expect((await transactionProject(d, op)).link).toMatchObject({ project_id: projectId, cost_name: "MAXIMA LT" });

    const kitas = await createProject(d, { title: "Atostogos" }, JONAS, NOW);
    const eilute = await createCost(d, kitas, { name: "Maistas" });
    await linkTransaction(d, kitas, { transactionId: op, costId: eilute.id }, JONAS, NOW);
    expect((await getProject(d, projectId)).costs.find((c) => c.name === "MAXIMA LT")!.actual_cents).toBeNull();
    expect((await getProject(d, kitas)).costs[0].actual_cents).toBe(2380);
  });

  it("ištrinto projekto operacija vėl laisva: siūloma kitur ir operacijoje nerodoma", async () => {
    const { d, tx, projectId, tortas } = await setup();
    const op = await tx("2026-11-08", -6000, "KONDITERIJA TORTAI");
    await linkTransaction(d, projectId, { transactionId: op, costId: tortas }, JONAS, NOW);
    await deleteProject(d, projectId, NOW);
    expect((await transactionProject(d, op)).link).toBeNull();
    const kitas = await createProject(d, { title: "Tortų degustacija", targetDate: "2026-11-10", costs: [{ name: "Tortas", plannedCents: 6000 }] }, JONAS, NOW);
    expect((await projectBank(d, kitas, TODAY)).suggestions.map((s) => s.transaction_id)).toContain(op);
  });

  it("išskaidytos operacijos ir vidinio pervedimo susieti negalima", async () => {
    const { d, tx, projectId } = await setup();
    await expect(linkTransaction(d, projectId, { transactionId: await tx("2026-11-01", -100, "X", { split: 1 }) }, JONAS, NOW)).rejects.toThrow("išskaidyta");
    await expect(linkTransaction(d, projectId, { transactionId: await tx("2026-11-01", -100, "Y", { transfer: 1 }) }, JONAS, NOW)).rejects.toThrow("pervedimo");
  });

  it("„Gali būti šio projekto“: pagal gavėją (su eilute) ir sumą arti šventės; atmesta — nebesiūloma", async () => {
    const { d, tx, projectId, tortas, kambarys } = await setup();
    const tortai = await tx("2026-11-10", -5800, "KONDITERIJA TORTAI");
    const erdve = await tx("2026-10-20", -11000, "UAB ŽAIDIMŲ ERDVĖ");
    const suma = await tx("2026-11-05", -12500, "UAB PRAMOGOS");
    await tx("2026-11-12", -2380, "MAXIMA LT");
    await tx("2026-06-01", -5800, "KONDITERIJA TORTAI"); // per anksti

    const { suggestions } = await projectBank(d, projectId, TODAY);
    expect(suggestions.map((s) => [s.transaction_id, s.cost_id, s.reason])).toEqual([
      [tortai, tortas, "primena „Tortas“"],
      [erdve, kambarys, "primena „Žaidimų kambarys“"],
      [suma, kambarys, "suma artima „Žaidimų kambarys“ planui"],
    ]);

    await dismissSuggestion(d, projectId, suma);
    await linkTransaction(d, projectId, { transactionId: tortai, costId: tortas }, JONAS, NOW);
    const after = await projectBank(d, projectId, TODAY);
    expect(after.suggestions.map((s) => s.transaction_id)).toEqual([erdve]);
    expect(after.links).toMatchObject([{ transaction_id: tortai, cost_name: "Tortas", amount_cents: -5800, account_owner: "Jonas" }]);
  });
});

describe("katiliukas ↔ projektas", () => {
  it("projektas rodo, kiek sukaupta susietame katiliuke", async () => {
    const d = visaBaze();
    const goal = await d
      .prepare("INSERT INTO savings_goals (code, name, owner, kind, target_cents) VALUES ('atostogos', 'Taupymas atostogoms', 'Jonas', 'tikslas', 300000) RETURNING id")
      .first<{ id: number }>();
    await d.prepare("INSERT INTO savings_entries (goal_id, date, cents, source) VALUES (?, '2026-09-01', 190000, 'rankinis')").bind(goal!.id).run();
    expect(await projectSavings(d, goal!.id, TODAY)).toEqual({ id: goal!.id, name: "Taupymas atostogoms", valueCents: 190000, targetCents: 300000 });
    expect(await projectSavings(d, null, TODAY)).toBeNull();
  });
});

describe("finansų terminai → darbai", () => {
  async function setupDeadlines() {
    const d = visaBaze();
    const policy = (code: string, no: string, kind: string, group: string, end: string, contractEnd: string | null = null) =>
      d
        .prepare(
          `INSERT INTO insurance_policies (code, policy_no, kind, object_group, title, insurer, period_start, period_end, contract_end, premium_cents)
           VALUES (?, ?, ?, ?, 'Draudimas', 'If', '2025-11-01', ?, ?, 10000)`
        )
        .bind(code, no, kind, group, end, contractEnd)
        .run();
    await policy("kasko-2026", "K1", "kasko", "Automobilis", "2026-11-01");
    await policy("bustas-2025", "B1", "bustas", "Būstas", "2026-10-20");
    await policy("bustas-2026", "B1", "bustas", "Būstas", "2027-10-20"); // jau atnaujintas
    await policy("pzu-2026", "P1", "gyvybes", "Jonas", "2026-10-25", "2041-05-14"); // atsinaujina pats
    const credit = (name: string, end: string, rateType: string, change: string | null) =>
      d
        .prepare(
          `INSERT INTO credits (kind, name, lender, end_date, original_cents, rate_type, rate_pct, monthly_payment_cents, balance_cents, balance_date, next_rate_change)
           VALUES ('busto_paskola', ?, 'SEB', ?, 100, ?, 4.5, 100, 100, '2026-01-01', ?)`
        )
        .bind(name, end, rateType, change)
        .run();
    await credit("Būsto paskola", "2049-09-10", "kintama", "2026-10-25");
    await credit("Senas kreditas", "2026-11-05", "fiksuota", null);
    await credit("Praėjęs", "2049-01-01", "kintama", "2026-10-09");
    return d;
  }

  it("likus 30 d. — darbas su terminu ir sritimi; antrą kartą nekuriamas; ištrintas — nebeatsiranda", async () => {
    const d = await setupDeadlines();
    expect(await syncFinanceDeadlines(d, NOW)).toBe(3);
    const { results } = await d
      .prepare("SELECT t.title, t.due_date, t.source, a.name AS area FROM tasks t LEFT JOIN task_areas a ON a.id = t.area_id ORDER BY t.due_date, t.title")
      .all();
    expect(results).toEqual([
      { title: "Atnaujinti KASKO draudimą", due_date: "2026-10-25", source: "automatinis", area: "Automobilis" },
      { title: "Palūkanų perskaičiavimas: Būsto paskola", due_date: "2026-10-25", source: "automatinis", area: "Dokumentai ir mokėjimai" },
      { title: "Paskutinė įmoka: Senas kreditas", due_date: "2026-11-05", source: "automatinis", area: "Dokumentai ir mokėjimai" },
    ]);

    expect(await syncFinanceDeadlines(d, NOW)).toBe(0);
    const kasko = (await d.prepare("SELECT id FROM tasks WHERE title LIKE 'Atnaujinti KASKO%'").first<{ id: number }>())!.id;
    await deleteTask(d, kasko, NOW);
    expect(await syncFinanceDeadlines(d, new Date("2026-10-12T06:00:00Z"))).toBe(0);
  });
});
