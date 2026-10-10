import { describe, expect, it } from "vitest";
import { addItem, deleteItem, listShopping, updateItem } from "../src/darbai/pirkiniai";
import { guessSection } from "../src/darbai/skyriai";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const NOW = new Date("2026-10-10T06:00:00Z");
const MAISTAS = 1;
const BUITIS = 2;

const db = () =>
  visaBaze();

const dienosAtgal = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("pirkinių skyriai", () => {
  it("žodynėlis: pagal žodžio pradžią, pirmas tinkamas skyrius", () => {
    expect(guessSection("pienas")).toBe("Pieno produktai ir kiaušiniai");
    expect(guessSection("Kačių maistas")).toBe("Gyvūnams");
    expect(guessSection("bananai")).toBe("Daržovės ir vaisiai");
    expect(guessSection("indų ploviklis")).toBe("Valymas ir buitis");
    expect(guessSection("braškių uogienė")).toBe("Bakalėja");
    expect(guessSection("uogienė")).toBe("Bakalėja");
    expect(guessSection("tualetinis popierius")).toBe("Higiena");
    expect(guessSection("vištienos filė")).toBe("Mėsa ir žuvis");
    expect(guessSection("pjūklas")).toBe("Kita");
  });

  it("prekė gauna skyrių; perkelta ranka — įsimenama kitam kartui", async () => {
    const d = db();
    const p = await addItem(d, { listId: MAISTAS, name: "Varškės sūreliai" }, JONAS, NOW);
    expect(p.section).toBe("Pieno produktai ir kiaušiniai");
    const k = await addItem(d, { listId: MAISTAS, name: "Kibinai" }, JONAS, NOW);
    expect(k.section).toBe("Kita");

    await updateItem(d, k.id, { section: "Šaldyti" }, JONAS, NOW);
    await deleteItem(d, k.id);
    expect((await addItem(d, { listId: MAISTAS, name: "kibinai" }, JONAS, NOW)).section).toBe("Šaldyti");
    await expect(updateItem(d, p.id, { section: "Nėra tokio" }, JONAS, NOW)).rejects.toThrow("skyriaus");

    const { sections } = await listShopping(d, NOW);
    expect(sections[0]).toBe("Daržovės ir vaisiai");
    expect(sections.at(-1)).toBe("Kita");
  });
});

describe("dažnai perkamos", () => {
  async function nupirkti(d: D1Database, listId: number, name: string, kada: Date) {
    const p = await addItem(d, { listId, name }, JONAS, kada);
    await updateItem(d, p.id, { checked: true }, JONAS, kada);
    return p;
  }

  it("pirkta bent 3 kartus ir laikas — siūloma; sąraše jau esanti ar ką tik pirkta — ne", async () => {
    const d = db();
    for (const n of [15, 10, 5]) await nupirkti(d, MAISTAS, "pienas", dienosAtgal(n));
    for (const n of [14, 8, 1]) await nupirkti(d, MAISTAS, "duona", dienosAtgal(n));
    for (const n of [40, 20]) await nupirkti(d, BUITIS, "muilas", dienosAtgal(n));

    let { suggestions } = await listShopping(d, NOW);
    expect(suggestions).toEqual([{ list_id: MAISTAS, name: "pienas", every_days: 5, last_bought: "2026-10-05" }]);

    // Jau sąraše — nesiūloma.
    await addItem(d, { listId: MAISTAS, name: "Pienas" }, JONAS, NOW);
    ({ suggestions } = await listShopping(d, NOW));
    expect(suggestions).toEqual([]);
  });

  it("„Vėl reikia“ (atžymėjus) — pirkimas iš istorijos išbraukiamas", async () => {
    const d = db();
    const p = await nupirkti(d, MAISTAS, "sviestas", dienosAtgal(1));
    expect((await d.prepare("SELECT COUNT(*) AS n FROM shopping_purchases").first<{ n: number }>())!.n).toBe(1);
    await updateItem(d, p.id, { checked: false }, JONAS, NOW);
    expect((await d.prepare("SELECT COUNT(*) AS n FROM shopping_purchases").first<{ n: number }>())!.n).toBe(0);
  });
});
