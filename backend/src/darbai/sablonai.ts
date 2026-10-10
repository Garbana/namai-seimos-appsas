/**
 * Projektų šablonai: etapai, darbai (terminai — kiek dienų prieš projekto datą) ir biudžeto
 * dalys procentais. Sukūrus iš šablono, sumos pažymimos „įvertis“ — jas reikia pataisyti, kai
 * žinomos tikros. Viskas po to keičiama projekte.
 */
import { addDays } from "./pakartojimai";
import type { NewProjectPlan } from "./projektai";

interface TemplateTask {
  title: string;
  /** Kiek dienų prieš projekto datą (0 — tą dieną). */
  daysBefore: number;
}

export interface Template {
  code: string;
  name: string;
  icon: string;
  description: string;
  /** Srities pavadinimas (jei tokia yra) — projektas priskiriamas jai. */
  area: string;
  sections: { name: string; tasks: TemplateTask[] }[];
  /** Biudžeto eilutės: dalis procentais; `task` — susietas darbas (jo kaina). */
  costs: { name: string; share: number; task?: string }[];
}

export const TEMPLATES: Template[] = [
  {
    code: "gimtadienis",
    name: "Vaiko gimtadienis",
    icon: "🎂",
    description: "Vieta, svečiai, maistas, dekoracijos ir dovanėlės",
    area: "Šventės ir dovanos",
    sections: [
      {
        name: "Vieta",
        tasks: [
          { title: "Išsirinkti vietą (žaidimų kambarys ar namuose)", daysBefore: 28 },
          { title: "Rezervuoti ir sumokėti avansą", daysBefore: 21 },
        ],
      },
      {
        name: "Svečiai",
        tasks: [
          { title: "Sudaryti svečių sąrašą", daysBefore: 25 },
          { title: "Išsiųsti pakvietimus", daysBefore: 21 },
          { title: "Surinkti atsakymus", daysBefore: 7 },
        ],
      },
      {
        name: "Maistas",
        tasks: [
          { title: "Užsakyti tortą", daysBefore: 5 },
          { title: "Nupirkti maistą ir gėrimus", daysBefore: 1 },
        ],
      },
      {
        name: "Dekoracijos ir dovanėlės",
        tasks: [
          { title: "Nupirkti dekoracijas", daysBefore: 4 },
          { title: "Paruošti dovanėles svečiams", daysBefore: 3 },
        ],
      },
    ],
    costs: [
      { name: "Vieta", share: 40, task: "Rezervuoti ir sumokėti avansą" },
      { name: "Tortas", share: 12, task: "Užsakyti tortą" },
      { name: "Maistas ir gėrimai", share: 20, task: "Nupirkti maistą ir gėrimus" },
      { name: "Dekoracijos", share: 8, task: "Nupirkti dekoracijas" },
      { name: "Dovanėlės svečiams", share: 10, task: "Paruošti dovanėles svečiams" },
      { name: "Rezervas", share: 10 },
    ],
  },
  {
    code: "atostogos",
    name: "Atostogos",
    icon: "✈️",
    description: "Kryptis, bilietai, nakvynė, dokumentai ir pasiruošimas",
    area: "Kelionės",
    sections: [
      {
        name: "Planavimas",
        tasks: [
          { title: "Pasirinkti kryptį ir datas", daysBefore: 90 },
          { title: "Nupirkti bilietus", daysBefore: 75 },
          { title: "Rezervuoti nakvynę", daysBefore: 70 },
          { title: "Įsigyti kelionės draudimą", daysBefore: 14 },
        ],
      },
      {
        name: "Dokumentai",
        tasks: [
          { title: "Patikrinti pasų ir asmens tapatybės kortelių galiojimą", daysBefore: 60 },
          { title: "Pasirūpinti Europos sveikatos draudimo kortelėmis", daysBefore: 30 },
        ],
      },
      {
        name: "Pasiruošimas",
        tasks: [
          { title: "Susitarti, kas prižiūrės kates", daysBefore: 14 },
          { title: "Sudaryti daiktų sąrašą", daysBefore: 7 },
          { title: "Susikrauti lagaminus", daysBefore: 1 },
        ],
      },
    ],
    costs: [
      { name: "Bilietai", share: 30, task: "Nupirkti bilietus" },
      { name: "Nakvynė", share: 30, task: "Rezervuoti nakvynę" },
      { name: "Maistas", share: 20 },
      { name: "Pramogos", share: 10 },
      { name: "Kelionės draudimas", share: 3, task: "Įsigyti kelionės draudimą" },
      { name: "Rezervas", share: 7 },
    ],
  },
  {
    code: "remontas",
    name: "Kambario remontas",
    icon: "🛠️",
    description: "Planas, darbai, baldai ir dekoras",
    area: "Namai",
    sections: [
      {
        name: "Planas",
        tasks: [
          { title: "Išmatuoti kambarį", daysBefore: 60 },
          { title: "Išsirinkti stilių ir spalvas", daysBefore: 50 },
          { title: "Sudaryti sąmatą ir pirkinių sąrašą", daysBefore: 45 },
        ],
      },
      {
        name: "Darbai",
        tasks: [
          { title: "Nupirkti medžiagas (dažai, glaistas)", daysBefore: 35 },
          { title: "Paruošti sienas", daysBefore: 30 },
          { title: "Nudažyti sienas", daysBefore: 25 },
          { title: "Pakeisti grindis", daysBefore: 20 },
        ],
      },
      {
        name: "Baldai ir dekoras",
        tasks: [
          { title: "Užsakyti baldus", daysBefore: 40 },
          { title: "Surinkti baldus", daysBefore: 7 },
          { title: "Tekstilė, šviestuvai ir dekoras", daysBefore: 5 },
        ],
      },
    ],
    costs: [
      { name: "Medžiagos", share: 15, task: "Nupirkti medžiagas (dažai, glaistas)" },
      { name: "Grindys", share: 20, task: "Pakeisti grindis" },
      { name: "Baldai", share: 45, task: "Užsakyti baldus" },
      { name: "Tekstilė, šviestuvai, dekoras", share: 15, task: "Tekstilė, šviestuvai ir dekoras" },
      { name: "Rezervas", share: 5 },
    ],
  },
];

/** Biudžeto padalijimas pagal dalis: sveikais eurais, likutis — paskutinei eilutei. */
export function splitBudget(budgetCents: number, shares: number[]): number[] {
  const total = shares.reduce((s, x) => s + x, 0);
  const parts = shares.map((s) => Math.floor((budgetCents * s) / total / 100) * 100);
  parts[parts.length - 1] += budgetCents - parts.reduce((s, x) => s + x, 0);
  return parts;
}

/**
 * Projekto planas iš šablono. Darbų terminai — skaičiuojami atgal nuo projekto datos, bet ne
 * ankstesni nei šiandien (kad sukurtas projektas iškart nevėluotų).
 */
export function planFromTemplate(
  template: Template,
  input: { title: string; targetDate: string | null; budgetCents: number | null; areaId: number | null; ownerId: number | null },
  today: string
): NewProjectPlan {
  const due = (daysBefore: number) => {
    if (!input.targetDate) return null;
    const d = addDays(input.targetDate, -daysBefore);
    return d < today ? today : d;
  };
  const amounts = input.budgetCents ? splitBudget(input.budgetCents, template.costs.map((c) => c.share)) : null;
  return {
    title: input.title,
    targetDate: input.targetDate,
    budgetCents: input.budgetCents,
    areaId: input.areaId,
    ownerId: input.ownerId,
    sections: template.sections.map((s) => ({
      name: s.name,
      tasks: s.tasks.map((t) => ({ title: t.title, dueDate: due(t.daysBefore) })),
    })),
    costs: template.costs.map((c, i) => ({ name: c.name, plannedCents: amounts?.[i] ?? null, isEstimate: true, taskTitle: c.task })),
  };
}
