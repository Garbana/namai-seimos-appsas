/**
 * Pirkinių skyriai — kad parduotuvėje nereikėtų šokinėti po sąrašą. Skyrius parenkamas pats:
 * pirma iš to, ką šeima jau yra pataisiusi (shopping_sections), tada iš žodynėlio pagal
 * žodžio pradžią („pien“ → Pieno produktai). Neatpažinta — „Kita“.
 */

/** Skyriai tokia tvarka, kokia paprastai einama per parduotuvę. */
export const SECTIONS = [
  "Daržovės ir vaisiai",
  "Duona ir kepiniai",
  "Pieno produktai ir kiaušiniai",
  "Mėsa ir žuvis",
  "Bakalėja",
  "Šaldyti",
  "Saldumynai ir užkandžiai",
  "Gėrimai",
  "Vaikams",
  "Gyvūnams",
  "Higiena",
  "Valymas ir buitis",
  "Vaistai",
  "Kita",
] as const;

export type Section = (typeof SECTIONS)[number];

/** Žodžių pradžios. Tvarka svarbi: pirmas atitikęs laimi („kačių maistas“ — gyvūnams, ne maistui). */
const DICTIONARY: [Section, string[]][] = [
  // Pirma — kas kitaip patektų ne ten („braškių uogienė“ — ne vaisiai).
  ["Bakalėja", ["uogien", "džem"]],
  ["Gyvūnams", ["kač", "kati", "šun", "kraik", "ėdal", "žuvyt", "papūg"]],
  ["Vaikams", ["sauskeln", "pampers", "tyrel", "košel", "vaikišk", "čiulptuk", "drėgnos servetėl"]],
  ["Vaistai", ["vaist", "tablet", "sirup", "pleistr", "vitamin", "tvarst", "termometr", "ibuprofen", "paracetamol", "nosies", "lašai", "tepal"]],
  [
    "Higiena",
    ["muil", "šampūn", "kondicionier", "dant", "dezodor", "skust", "higien", "vat", "kremas rank", "kremas veid", "tamponai", "įklotai", "tualetin"],
  ],
  [
    "Valymas ir buitis",
    ["plovikl", "skalb", "indų", "valikl", "kempin", "šiukšl", "maišel", "foli", "plėvel", "lemput", "baterij", "minkštikl", "balikl", "popierin", "servetėl", "kapsul", "tablečių indaplov", "druska indaplov"],
  ],
  [
    "Pieno produktai ir kiaušiniai",
    ["pien", "jogurt", "varšk", "sūr", "grietin", "sviest", "kefyr", "kiauš", "pasukos", "mocarel", "rikot", "maskarpon", "glaistyt"],
  ],
  [
    "Mėsa ir žuvis",
    ["mės", "višt", "kiaul", "jautien", "farš", "dešr", "kumpi", "šonin", "žuv", "lašiš", "silk", "krevet", "kotlet", "sprand", "kalakut", "ėrien", "skumbr", "tunas", "menk", "filė", "šlaunel", "krūtinėl", "sparnel"],
  ],
  [
    "Daržovės ir vaisiai",
    [
      "banan", "obuol", "pomidor", "agurk", "bulv", "mork", "svogūn", "česnak", "citrin", "apelsin", "kriauš", "vynuog", "kopūst", "salot",
      "paprik", "braš", "avieč", "mėlyn", "mandarin", "vaisi", "daržov", "grybai", "pievagryb", "avokad", "cukini", "brokol", "žalum", "krap",
      "petražol", "imbier", "kivi", "ananas", "persik", "slyv", "arbūz", "melion", "burok", "ridik", "špinat", "rukol", "moliūg", "kalafior", "porai",
      "laim", "greipfrut", "baklažan", "kukurūz", "žirneli",
    ],
  ],
  ["Duona ir kepiniai", ["duon", "batonas", "batono", "bandel", "pyrag", "ragel", "bagel", "lavaš", "tortilij", "sumuštin", "sausuči", "trapuči", "kruasan", "spurg"]],
  ["Šaldyti", ["ledai", "šaldyt", "koldūn", "virtin", "pic", "blyneliai šald"]],
  [
    "Saldumynai ir užkandžiai",
    ["šokolad", "saldain", "sausain", "traškuč", "riešut", "zefyr", "vafl", "kramtom", "guminuk", "batonėl", "džiovint", "spragės", "tortas", "keksiuk"],
  ],
  ["Gėrimai", ["vanduo", "vandens", "sult", "gaivi", "alus", "alaus", "vynas", "vyno", "limonad", "mineral", "kola", "kava", "kavos", "arbat", "kakava", "nektar", "gira"]],
  [
    "Bakalėja",
    [
      "makaron", "spagec", "ryž", "grik", "kruop", "milt", "cukr", "drusk", "aliej", "act", "prieskon", "pipir", "kečup", "majonez", "padaž", "konserv",
      "pupel", "avižin", "dribsn", "medus", "medaus", "uogien", "mieliai", "kepimo", "vanil", "cinamon", "lęši", "avinžirn", "garstyč", "sultinio",
      "sriub", "tomatų past", "kukurūzų dribsn", "musli", "granol",
    ],
  ],
];

const normalize = (name: string) => name.trim().toLocaleLowerCase("lt").replace(/\s+/g, " ");

/** Skyrius iš žodynėlio: ar kuris nors pavadinimo žodis (ar visa frazė) prasideda žodynėlio pradžia. */
export function guessSection(name: string): Section {
  const n = normalize(name);
  const words = n.split(/[\s,.;:()/-]+/).filter(Boolean);
  for (const [section, stems] of DICTIONARY) {
    for (const stem of stems) {
      if (stem.includes(" ") ? n.includes(stem) : words.some((w) => w.startsWith(stem))) return section;
    }
  }
  return "Kita";
}

export const isSection = (value: unknown): value is Section => typeof value === "string" && (SECTIONS as readonly string[]).includes(value);

/** Išmokti skyriai (pavadinimas mažosiomis → skyrius). */
export async function learnedSections(db: D1Database): Promise<Map<string, Section>> {
  const { results } = await db.prepare("SELECT name, section FROM shopping_sections").all<{ name: string; section: string }>();
  return new Map(results.filter((r) => isSection(r.section)).map((r) => [r.name, r.section as Section]));
}

export function sectionFrom(learned: Map<string, Section>, name: string): Section {
  return learned.get(normalize(name)) ?? guessSection(name);
}

/** Žmogus perkėlė prekę į kitą skyrių — kitą kartą ji ten ir atsiras. */
export async function rememberSection(db: D1Database, name: string, section: Section, now = new Date()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shopping_sections (name, section, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET section = excluded.section, updated_at = excluded.updated_at`
    )
    .bind(normalize(name), section, now.toISOString())
    .run();
}
