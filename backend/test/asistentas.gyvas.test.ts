/**
 * Asistento frazių rinkinys su TIKRU modeliu (kainuoja ~0,01–0,02 $ už paleidimą). Paleidžiamas
 * tik sąmoningai, kai keičiamos instrukcijos ar modelis:
 *
 *   GYVAS=1 npx vitest run test/asistentas.gyvas.test.ts
 *
 * Raktas imamas iš backend/.dev.vars (ANTHROPIC_API_KEY). Tikslas — ≥ 95 % teisingų.
 * Ataskaita — backend/.wrangler/asistento-testas.txt.
 * Data visada ta pati: 2026-10-10, šeštadienis, 9:00.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ask, type Irasas } from "../src/ai/asistentas";
import { anthropicCaller } from "../src/ai/modelis";
import { addItem } from "../src/darbai/pirkiniai";
import { createProject, getProject } from "../src/darbai/projektai";
import { createTask } from "../src/darbai/uzduotys";
import { createEvent } from "../src/kalendorius/ivykiai";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const EMA = 3;
const NOW = new Date("2026-10-10T06:00:00Z");

function readKey(): string | null {
  const file = new URL("../.dev.vars", import.meta.url);
  if (!process.env.GYVAS || !existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("ANTHROPIC_API_KEY="));
  return line ? line.slice("ANTHROPIC_API_KEY=".length).trim() : null;
}

/** Pradiniai duomenys — kaip tikroje šeimoje: darbai, pirkiniai ir kelios banko operacijos. */
async function setup() {
  const d = visaBaze();
  await d.prepare("INSERT INTO accounts (id, bank, name, owner) VALUES (1, 'seb', 'SEB', 'Jonas'), (2, 'swedbank', 'Swedbank', 'Rūta')").run();
  const elektra = (await d.prepare("SELECT id FROM categories WHERE name = 'Elektra ir dujos'").first<{ id: number }>())!.id;
  for (const [acc, date, cents, name, cat] of [
    [1, "2026-09-03", -4520, "IGNITIS", elektra],
    [1, "2026-09-12", -2310, "MAXIMA LT", null],
    [2, "2026-09-25", 250000, "DARBDAVYS UAB", null],
    [2, "2026-10-04", -4710, "IGNITIS", elektra],
  ] as const) {
    await d
      .prepare("INSERT INTO transactions (account_id, booking_date, amount_cents, counterparty_name, category_id) VALUES (?, ?, ?, ?, ?)")
      .bind(acc, date, cents, name, cat)
      .run();
  }
  // Emos būreliai rugpjūtį — kategorijomis (Dailė, Karate, Šokiai), be žodžio „būrelis“ (pastaba #1).
  for (const [name, cents, who] of [["Dailė", -2000, "DAILĖS STUDIJA"], ["Karate", -9000, "KARATE KLUBAS"], ["Šokiai", -7079, "ŠOKIŲ MOKYKLA"]] as const) {
    await d
      .prepare(
        `INSERT INTO transactions (account_id, booking_date, amount_cents, counterparty_name, category_id)
         VALUES (1, '2026-08-20', ?, ?, (SELECT id FROM categories WHERE name = ? AND parent_id = (SELECT id FROM categories WHERE name = 'Ema')))`
      )
      .bind(cents, who, name)
      .run();
  }
  const ids = {
    siuksles: (await createTask(d, { title: "Išnešti šiukšles", dueDate: "2026-10-10", recurrence: "FREQ=WEEKLY;BYDAY=SA", areaId: 1 }, JONAS, NOW)).id,
    dantiste: (await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", assigneeId: RŪTA, areaId: 3, reminders: ["1d@18:00", "60m"] }, JONAS, NOW)).id,
    padangos: (await createTask(d, { title: "Pakeisti padangas", dueDate: "2026-10-20", assigneeId: JONAS, areaId: 4 }, JONAS, NOW)).id,
    gimtadienis: (await createTask(d, { title: "Emos gimtadienis", dueDate: "2026-11-10", areaId: 7, assigneeId: RŪTA }, JONAS, NOW)).id,
    darzelis: (await createTask(d, { title: "Sumokėti už darželį", dueDate: "2026-10-15", recurrence: "FREQ=MONTHLY;BYMONTHDAY=15", assigneeId: JONAS, areaId: 6 }, JONAS, NOW)).id,
    tortas: 0,
    jubiliejus: 0,
    kepsniai: 0,
    sale: 0,
    repeticija: 0,
    pienas: (await addItem(d, { listId: 1, name: "pienas" }, JONAS, NOW)).id,
    duona: (await addItem(d, { listId: 1, name: "duona" }, JONAS, NOW)).id,
  };
  ids.tortas = (await createTask(d, { title: "Užsakyti tortą", parentId: ids.gimtadienis }, JONAS, NOW)).id;
  ids.jubiliejus = await createProject(
    d,
    {
      title: "Jono jubiliejus",
      targetDate: "2026-12-05",
      budgetCents: 100000,
      ownerId: RŪTA,
      sections: [{ name: "Maistas", tasks: [{ title: "Užsakyti kepsnius", dueDate: "2026-11-28", amountCents: 30000 }] }],
      costs: [{ name: "Salė", plannedCents: 30000 }],
    },
    JONAS,
    NOW
  );
  const jub = await getProject(d, ids.jubiliejus);
  ids.kepsniai = jub.tasks.find((x) => x.title === "Užsakyti kepsnius")!.id;
  ids.sale = jub.costs.find((c) => c.name === "Salė")!.id;
  await createTask(d, { title: "Išsiųsti pakvietimus", parentId: ids.gimtadienis }, JONAS, NOW);
  await addItem(d, { listId: 3, name: "ibuprofenas" }, JONAS, NOW);
  ids.repeticija = (await createEvent(d, { title: "Repeticija", startDate: "2026-10-14", startTime: "18:00", memberIds: [EMA] }, JONAS, NOW)).id;
  return { d, ids };
}

type Ids = Awaited<ReturnType<typeof setup>>["ids"];

// ---------- Patikros ----------

const of = (r: Irasas, tipas: string) => r.veiksmai.filter((v) => v.tipas === tipas && v.busena !== "klaida");
const keiciantys = (r: Irasas) => r.veiksmai.filter((v) => v.busena !== "klaida" && v.tipas !== "pirkiniai" && v.tipas !== "nupirkta");

function sukurta(r: Irasas, laukai: Record<string, unknown>, extra?: (l: Record<string, unknown>) => boolean): boolean {
  return of(r, "sukurti").some((v) => {
    const l = v.laukai as Record<string, unknown>;
    return Object.entries(laukai).every(([k, val]) => (val === null ? l[k] == null : l[k] === val)) && (!extra || extra(l));
  });
}
/** Pasiūlytas kalendoriaus įvykis su šiais laukais. */
function ivykis(r: Irasas, laukai: Record<string, unknown>, extra?: (l: Record<string, unknown>) => boolean): boolean {
  return of(r, "ivykis").some((v) => {
    const l = v.ivykis as Record<string, unknown>;
    return Object.entries(laukai).every(([k, val]) => JSON.stringify(l[k] ?? null) === JSON.stringify(val)) && (!extra || extra(l));
  });
}
const klausia = (r: Irasas) => keiciantys(r).length === 0 && /\?/.test(r.atsakymas ?? "");
const atlikta = (r: Irasas, id: number) => of(r, "atlikta").some((v) => v.uzduotisId === id);
const pakeista = (r: Irasas, id: number, laukai: Record<string, unknown>) =>
  of(r, "keisti").some((v) => v.uzduotisId === id && Object.entries(laukai).every(([k, val]) => (v.laukai as Record<string, unknown>)[k] === val));
const pirkta = (r: Irasas, listId: number, kas: RegExp) =>
  of(r, "pirkiniai").some((v) => v.sarasasId === listId && (v.prekes ?? []).some((p) => kas.test(p.name)));
const nupirkta = (r: Irasas, ids: number[]) => ids.every((id) => of(r, "nupirkta").some((v) => (v.prekes ?? []).some((p) => p.id === id)));
const be = (r: Irasas) => r.veiksmai.length === 0;
const sako = (r: Irasas, kas: RegExp) => kas.test(r.atsakymas ?? "");

interface Atvejis {
  fraze: string;
  kalba?: number;
  tinka: (r: Irasas, ids: Ids) => boolean;
}

const ATVEJAI: Atvejis[] = [
  // Datos ir laikas
  { fraze: "Kitą penktadienį Rūtai pas kirpėją 15 val.", tinka: (r) => ivykis(r, { startDate: "2026-10-16", startTime: "15:00", memberIds: [RŪTA] }) },
  { fraze: "Penktadienį 9 ryto man pas gydytoją", tinka: (r) => ivykis(r, { startDate: "2026-10-16", startTime: "09:00", memberIds: [JONAS] }) },
  { fraze: "Rytoj nupirkti dovaną Emos draugei", tinka: (r) => sukurta(r, { dueDate: "2026-10-11" }) },
  { fraze: "Poryt sumokėti už elektrą", tinka: (r) => sukurta(r, { dueDate: "2026-10-12" }) },
  { fraze: "Po savaitės patikrinti padangų slėgį", tinka: (r) => sukurta(r, { dueDate: "2026-10-17" }) },
  { fraze: "Mėnesio gale pateikti deklaraciją", tinka: (r) => sukurta(r, { dueDate: "2026-10-31" }) },
  { fraze: "Šiandien vakare paskambinti mamai", tinka: (r) => sukurta(r, { dueDate: "2026-10-10", dueTime: "19:00" }) },
  {
    fraze: "Pirmadienį ryte nuvežti mašiną į servisą",
    tinka: (r) => sukurta(r, { dueDate: "2026-10-12", dueTime: "09:00", areaId: 4, assigneeId: JONAS }) || ivykis(r, { startDate: "2026-10-12", startTime: "09:00" }),
  },
  { fraze: "rytoj pasimatyti su buhaltere dvylikta valanda", tinka: (r) => ivykis(r, { startDate: "2026-10-11", startTime: "12:00" }) },
  // Kalendorius
  {
    fraze: "Kiekvieną antradienį 17 val. Emai šokiai",
    tinka: (r) => ivykis(r, { startDate: "2026-10-13", startTime: "17:00", memberIds: [EMA] }, (l) => /^FREQ=WEEKLY/.test(String(l.recurrence))),
  },
  { fraze: "Atostogos nuo spalio 20 iki 23 dienos", tinka: (r) => ivykis(r, { startDate: "2026-10-20", startTime: null, endDate: "2026-10-23" }) },
  { fraze: "Ką turim šią savaitę kalendoriuje?", tinka: (r) => be(r) && sako(r, /Repeticij/i) },
  {
    fraze: "Repeticiją perkelk į 19 val.",
    tinka: (r, i) => of(r, "ivykio_keitimas").some((v) => v.ivykisId === i.repeticija && (v.ivykis as Record<string, unknown>).startTime === "19:00"),
  },
  // Keli darbai šventei — projektas (arba užduotis su použduotimis).
  {
    fraze: "Šventė lapkričio 7 d. Reikia užsakyti salę, nupirkti balionų ir sukviesti draugus",
    tinka: (r) =>
      of(r, "projektas").some((v) => v.projektas!.targetDate === "2026-11-07" && v.projektas!.sections.flatMap((s) => s.tasks).length >= 3) ||
      (sukurta(r, { dueDate: "2026-11-07" }) && of(r, "sukurti").some((v) => (v.pouzduotys?.length ?? 0) >= 3)),
  },

  // Pakartojimai
  // Ruoša (6 etapas)
  {
    fraze: "Vonią valom pakaitomis su Rūta kas dvi savaites šeštadieniais",
    tinka: (r) =>
      sukurta(r, { chore: true, recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA" }, (l) => {
        const eile = (l.rotationMembers as number[] | undefined) ?? [];
        return eile.length === 2 && eile.includes(JONAS) && eile.includes(RŪTA);
      }),
  },
  {
    fraze: "Vandens filtrą reikia keisti kas 90 dienų nuo paskutinio karto",
    tinka: (r) => sukurta(r, { chore: true, repeatAfterDone: true }, (l) => l.recurrence === "FREQ=DAILY;INTERVAL=90" || l.recurrence === "FREQ=MONTHLY;INTERVAL=3"),
  },
  {
    fraze: "Kačių kraiką keičiam pakaitomis kas dvi dienas",
    tinka: (r) => sukurta(r, { chore: true, recurrence: "FREQ=DAILY;INTERVAL=2" }, (l) => ((l.rotationMembers as number[] | undefined) ?? []).length === 2),
  },
  {
    fraze: "Kiekvieną antradienį ir penktadienį Jonas neša šiukšles",
    tinka: (r) => sukurta(r, { chore: true, recurrence: "FREQ=WEEKLY;BYDAY=TU,FR", assigneeId: JONAS }),
  },
  { fraze: "Kiekvieną šeštadienį siurbti namus", tinka: (r) => sukurta(r, { recurrence: "FREQ=WEEKLY;BYDAY=SA" }, (l) => l.dueDate === "2026-10-10" || l.dueDate === "2026-10-17") },
  { fraze: "Kas dvi savaites pirmadieniais laistyti gėles", tinka: (r) => sukurta(r, { dueDate: "2026-10-12" }, (l) => /FREQ=WEEKLY/.test(String(l.recurrence)) && /INTERVAL=2/.test(String(l.recurrence)) && /BYDAY=MO/.test(String(l.recurrence))) },
  { fraze: "Kiekvieno mėnesio 5 d. sumokėti už internetą", tinka: (r) => sukurta(r, { dueDate: "2026-11-05" }, (l) => /FREQ=MONTHLY/.test(String(l.recurrence)) && /BYMONTHDAY=5/.test(String(l.recurrence))) },

  // Klausimai, kai ko trūksta ar dviprasmiška
  { fraze: "Reikia užsiregistruoti", tinka: (r) => klausia(r) },
  { fraze: "Emos draugės gimtadienis 11.12, reikia dovanos", tinka: (r) => klausia(r) },

  // Žmonės
  { fraze: "Jonui reikia pakeisti lemputę koridoriuje", kalba: RŪTA, tinka: (r) => sukurta(r, { assigneeId: JONAS }) },
  { fraze: "Man reikia pakeisti lemputę koridoriuje", kalba: RŪTA, tinka: (r) => sukurta(r, { assigneeId: RŪTA }) },
  { fraze: "Mums reikia susitarti dėl atostogų", tinka: (r) => sukurta(r, { assigneeId: null }) },
  { fraze: "Ema turi susitvarkyti kambarį iki sekmadienio", tinka: (r) => sukurta(r, { assigneeId: EMA, dueDate: "2026-10-11" }) },
  { fraze: "Emai nupirkti naujų pieštukų", tinka: (r) => sukurta(r, { areaId: 2 }, (l) => l.assigneeId !== EMA) },
  { fraze: "Svarbu: rytoj paskambinti draudikui", tinka: (r) => sukurta(r, { priority: "svarbu", dueDate: "2026-10-11" }) },
  { fraze: "Kada nors sutvarkyti garažą", tinka: (r) => sukurta(r, { priority: "kada_nors" }) },
  { fraze: "Emai reikia naujų batų iki savaitgalio, apie 50 eurų", tinka: (r) => sukurta(r, { amountCents: 5000, areaId: 2 }) },

  // Atlikta
  { fraze: "Išnešiau šiukšles", tinka: (r, i) => atlikta(r, i.siuksles) },
  { fraze: "Tortą užsakiau", tinka: (r, i) => atlikta(r, i.tortas) },
  { fraze: "Sumokėjau už darželį", tinka: (r, i) => atlikta(r, i.darzelis) },
  { fraze: "Nuplovėm langus", tinka: (r) => keiciantys(r).length === 0 },

  // Pirkiniai
  { fraze: "Nupirkt kiaušinių ir sviesto", tinka: (r) => pirkta(r, 1, /kiauš/i) && pirkta(r, 1, /sviest/i) },
  { fraze: "Reikia skalbimo miltelių", tinka: (r) => pirkta(r, 2, /skalb/i) },
  { fraze: "Nupirkt paracetamolio", tinka: (r) => pirkta(r, 3, /paracetamol/i) },
  { fraze: "Pieną ir duoną nupirkau", tinka: (r, i) => nupirkta(r, [i.pienas, i.duona]) },

  // Keitimai ir trynimas
  { fraze: "Dantistę perkelk į kitą savaitę", tinka: (r, i) => pakeista(r, i.dantiste, { dueDate: "2026-10-23" }) },
  { fraze: "Padangų keitimą atidėk viena diena", tinka: (r, i) => pakeista(r, i.padangos, { dueDate: "2026-10-21" }) },
  { fraze: "Ištrink padangų keitimą", tinka: (r, i) => of(r, "istrinti").some((v) => v.uzduotisId === i.padangos) },

  // Keli dalykai vienoje žinutėje
  { fraze: "Nupirkt obuolių, o dantistę perkelk į pirmadienį", tinka: (r, i) => pirkta(r, 1, /obuol/i) && pakeista(r, i.dantiste, { dueDate: "2026-10-12" }) },
  { fraze: "Išnešiau šiukšles ir nupirkau duonos", tinka: (r, i) => atlikta(r, i.siuksles) && nupirkta(r, [i.duona]) },

  // Klausimai be veiksmų
  { fraze: "Kas mums šiandien?", tinka: (r) => be(r) && sako(r, /šiukšl/i) },
  { fraze: "Ką reikia nupirkti?", tinka: (r) => be(r) && sako(r, /pien|duon/i) },
  { fraze: "Kada dantistė?", tinka: (r) => be(r) && sako(r, /16|penktadien/i) },
  { fraze: "Papasakok anekdotą", tinka: (r) => be(r) },

  // Finansai (tik skaitymas)
  { fraze: "Kiek mes išleidom pinigų praėjusį mėnesį?", tinka: (r) => be(r) && sako(r, /68,3/) },
  { fraze: "Kiek gavom pajamų rugsėjį?", tinka: (r) => be(r) && sako(r, /2\s?500/) },
  { fraze: "Kiek mokam už elektrą?", tinka: (r) => be(r) && sako(r, /45,2|47,1/) },
  { fraze: "Kiek išleidom Maximoje?", tinka: (r) => be(r) && sako(r, /23,1/) },
  { fraze: "Kiek išleidom Emos būreliams rugpjūtį?", tinka: (r) => be(r) && sako(r, /180,79/) },
  { fraze: "Perkelk 100 eurų į taupymą", tinka: (r) => be(r) },

  // Pastabos apie appsą
  // Projektai
  {
    fraze: "Emos gimtadienis lapkričio 7 d., biudžetas 500 €, reikia žaidimų kambario, maisto ir pakvietimų",
    tinka: (r) =>
      of(r, "projektas").some((v) => {
        const pr = v.projektas!;
        const due = pr.sections.flatMap((s) => s.tasks.map((x) => x.dueDate)).filter((x): x is string => Boolean(x));
        const planned = pr.costs.reduce((s, c) => s + (c.plannedCents ?? 0), 0) + pr.sections.flatMap((s) => s.tasks).reduce((s, x) => s + (pr.costs.some((c) => c.taskTitle === x.title) ? 0 : (x.amountCents ?? 0)), 0);
        return (
          pr.targetDate === "2026-11-07" &&
          pr.budgetCents === 50000 &&
          pr.sections.length >= 2 &&
          due.length >= 3 &&
          due.every((x) => x >= "2026-10-10" && x <= "2026-11-07") &&
          Math.abs(planned - 50000) <= 100
        );
      }),
  },
  { fraze: "Emos draugės gimtadienio šventė 11.10, biudžetas 300 €", tinka: (r) => klausia(r) },
  { fraze: "Į jubiliejų pridėk darbą užsakyti muzikantus", tinka: (r, i) => of(r, "sukurti").some((v) => v.laukai?.projectId === i.jubiliejus) },
  { fraze: "Kepsnius jubiliejui užsakiau už 120", tinka: (r, i) => of(r, "atlikta").some((v) => v.uzduotisId === i.kepsniai && v.sumaCentais === 12000) },
  { fraze: "Už salę jubiliejui sumokėjom 200 eurų", tinka: (r, i) => of(r, "islaida").some((v) => v.islaida?.costId === i.sale && v.islaida.actualCents === 20000) },
  { fraze: "Kiek liko iki jubiliejaus ir koks biudžetas?", tinka: (r) => be(r) && sako(r, /1\s?000/) && !/#\d/.test(r.atsakymas ?? "") },

  { fraze: "Užfiksuok klaidą: pirkinių sąraše neatsinaujina, kai Rūta prideda prekę", tinka: (r) => of(r, "pastaba").some((v) => v.pastaba?.kind === "klaida") },
  { fraze: "Idėja appsui: kad prie užduoties būtų galima pridėti nuotrauką", tinka: (r) => of(r, "pastaba").some((v) => v.pastaba?.kind === "ideja") },
  { fraze: "Užfiksuok, kad reikia nupirkti kiaušinių", tinka: (r) => pirkta(r, 1, /kiauš/i) && of(r, "pastaba").length === 0 },
];

const key = readKey();

describe.skipIf(!key)("asistentas su tikru modeliu", () => {
  it(`frazių rinkinys (${ATVEJAI.length})`, { timeout: 600_000 }, async () => {
    const model = anthropicCaller(key!);
    const results: { atvejis: Atvejis; r: Irasas | null; ok: boolean; klaida?: string }[] = [];
    let cost = 0;

    // Po 4 vienu metu — greičiau, bet be spūsties.
    for (let i = 0; i < ATVEJAI.length; i += 4) {
      await Promise.all(
        ATVEJAI.slice(i, i + 4).map(async (atvejis) => {
          const { d, ids } = await setup();
          try {
            const r = await ask(d, model, { tekstas: atvejis.fraze, memberId: atvejis.kalba ?? JONAS }, NOW);
            const row = await d.prepare("SELECT cost_usd FROM ai_requests WHERE id = ?").bind(r.id).first<{ cost_usd: number }>();
            cost += row?.cost_usd ?? 0;
            results.push({ atvejis, r, ok: !r.klaida && atvejis.tinka(r, ids) });
          } catch (error) {
            results.push({ atvejis, r: null, ok: false, klaida: String(error) });
          }
        })
      );
    }

    const failed = results.filter((x) => !x.ok);
    const rate = (results.length - failed.length) / results.length;
    const report = [
      ...failed.map(
        (f) =>
          `✗ „${f.atvejis.fraze}“\n   ${f.klaida ?? `atsakymas: ${f.r?.atsakymas ?? "—"}${f.r?.klaida ? ` | klaida: ${f.r.klaida}` : ""}`}\n   veiksmai: ${JSON.stringify(f.r?.veiksmai.map((v) => ({ tipas: v.tipas, busena: v.busena, klaida: v.klaida, laukai: v.laukai, uzduotisId: v.uzduotisId, sarasasId: v.sarasasId, prekes: v.prekes, projektas: v.projektas, islaida: v.islaida })))}`
      ),
      `Teisingai: ${results.length - failed.length}/${results.length} (${Math.round(rate * 100)} %), kaina ${cost.toFixed(4)} $`,
    ].join("\n");
    // Sėkmingo testo išvesties vitest nerodo — ataskaita dar ir faile.
    writeFileSync(new URL("../.wrangler/asistento-testas.txt", import.meta.url), `${report}\n`);
    console.log(report);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
