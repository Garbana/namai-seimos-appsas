# Architektūra

Perskaityti prieš keičiant kodą. Diegimui ir pritaikymui šeimai kodo keisti nereikia.

## Principai

- **Pigu ir paprasta.** Viena platforma (Cloudflare, nemokamas planas), mažai judančių dalių,
  bibliotekų — kiek būtina (Web Push, Google JWT ir MCP parašyti be jų).
- **Visi mato tą patį.** Tai bendras šeimos appsas: jokių vartotojų teisių ir asmeninių
  rodinių. „Kas aš“ įsimenamas įrenginyje ir naudojamas tik „mano darbams“, pranešimams ir
  „aš“ katinuko kalboje.
- **Klaidos matomos.** Nepavykęs laikmatis, kopija, sinchronizavimas ar pranešimas
  įrašomi ir rodomi appse — niekas negenda tyliai.
- **Grupuota, ne sąrašai.** Ekranai rodo grupė → kategorija → įrašai su sumomis; tvarkyti
  galima ten pat.
- **Vienas mygtukas — viena funkcija.** Jokių „palaikyk“ gestų.
- **Nespėlioti.** Parseriai ir taisyklės — tik pagal tikrus failus. Ko nežinome — paliekame
  nepriskirta.
- **Pinigai — centais** (`INTEGER`), datos — vietinės `YYYY-MM-DD`, laikas — Vilniaus
  (`vilniusToUtc` — `backend/src/darbai/bendra.ts`, su vasaros laiku).

## Sandara

```
backend/                 Cloudflare Worker (TypeScript)
  src/index.ts           maršrutai, laikmačiai (scheduled), /api/nustatymai
  src/nustatymai.ts      SEIMA ir MODULIAI iš Worker'io kintamųjų
  src/darbai/            užduotys, pasikartojimai, ruoša, pirkiniai ir skyriai, projektai ir
                         šablonai, priminimai, sritys/nariai, finansų terminai → darbai, bankas ↔ projektai
  src/kalendorius/       įvykiai, Google sinchronizavimas (paslaugos paskyra, JWT RS256)
  src/pranesimai/        Web Push (RFC 8291 šifravimas, VAPID), gavėjai, rytinė suvestinė
  src/ai/                asistentas: modelis.ts (vienintelis kreipinys į Anthropic),
                         kontekstas.ts (instrukcijos, įrankiai, kontekstas), veiksmai.ts
                         (patikra, vykdymas, atšaukimas), finansai.ts (skaitymo įrankiai)
  src/mcp/               Claude jungtis: atskiras Worker'is (OAuth + MCP be būsenos)
  src/parsers/           SEB ir Swedbank CSV
  src/*.ts               finansai: import, rules, overview, budgets, savings, etf, credits,
                         insurance, pensions, reminders, offsets, backups
  migrations/            D1 schema (0001) ir pradiniai duomenys (0002)
  scripts/               sukurti-seima, konfiguruoti, *-raktas, bandomasis-telefonas
  test/                  vitest; d1-node.ts — D1 imitacija ant node:sqlite
frontend/                Vite + React (PWA)
  src/App.tsx            navigacija, „kas aš“, moduliai (nustatymai.ts)
  src/darbai/            Šiandien, užduotys, projektai, pirkiniai, ruoša
  src/kalendorius/       kalendorius, įvykio langas, Google nustatymai
  src/asistentas/        katinukas ir pokalbis
  src/claude/            Claude jungties leidimas ir sąrašas
  src/*.tsx              finansų ekranai
  public/sw.js           service worker (kešas, pranešimai, be ryšio)
```

**Vienas Worker'is serveruoja ir puslapį, ir API** — taip viena Access apsauga dengia viską
ir nereikia CORS. Statiniai failai atiduodami be Worker'io kodo (`run_worker_first` — tik
`/api/*` ir `/assets/*`); antraštės — `frontend/public/_headers`.

**Claude jungtis — atskiras Worker'is** (`wrangler.mcp.toml`), nes Claude serveriai pro Access
neprieina. Ta pati D1. Apsauga — OAuth (`@cloudflare/workers-oauth-provider`): Claude →
`/authorize` → appsas `/?claude=<state>` (už Access, žmogus spaudžia „Leisti“) → `/callback`.
Įrankiai — tie patys, kaip katinuko (`ai/kontekstas.ts`, `ai/veiksmai.ts`), tik vykdomi iš karto.
Pakeitus bendrą kodą — diegti abu Worker'ius.

**Laikmačiai** (`wrangler.toml` `[triggers]`): `0 2 * * SUN` — atsarginė kopija į KV;
`* * * * *` — priminimai ir pranešimų eilė, rytinė suvestinė 7:30, finansų terminai
(kartą per dieną), Google sinchronizavimas (kas 2 min., kartą per dieną — pilnas langas).

## Duomenų modelis (pagrindinės lentelės)

| Sritis | Lentelės |
|---|---|
| Šeima | `members` (vardas, spalva, el. paštai, `uses_app`), `task_areas` (sritis, atsakingas) |
| Darbai | `tasks` (+ `parent_id` použduotims, `recurrence`, `chore`, `rotation_members`), `task_completions`, `task_reminders`, `push_subscriptions`, `push_outbox` |
| Pirkiniai | `shopping_lists`, `shopping_items` (`section`), `shopping_sections`, `shopping_purchases` |
| Projektai | `projects`, `project_sections`, `project_costs`, `project_cost_links`, `project_link_dismissals` |
| Kalendorius | `events` (`member_ids`, `recurrence`, `google_id`, `sync_state`) |
| Finansai | `accounts`, `transactions`, `categories` (grupė = `parent_id IS NULL`, `subgroup`), `rules`, `budgets`, `savings_*`, `credits`, `credit_schedule`, `insurance_policies`, `pension_*`, `fund_prices`, `recurring_settings`, `finance_deadline_tasks` |
| Kita | `app_state` (raktas → JSON: kopijų būsena, Google būsena…), `ai_requests`, `feedback`, `claude_jungtys` |

Pilna schema su komentarais — `backend/migrations/0001_schema.sql`.

**Migracijos.** Įdiegtų migracijų (0001, 0002) nekeisti — šeimų bazėse jos jau įvykdytos.
Struktūros pakeitimas — naujas failas `0003_….sql`. Pradiniai duomenys, priklausantys nuo
šeimos, — `scripts/sukurti-seima.mjs`, ne migracijose.

## Testai

```bash
cd backend && npx vitest run
```

- `test/d1-node.ts` — D1 imitacija ant Node `node:sqlite` (todėl reikia Node 24).
  `visaBaze()` — visos migracijos ir pavyzdinė šeima (`seima.pavyzdys.json`: Jonas 1, Rūta 2,
  vaikas Ema 3), kaip diegiant.
- `test/asistentas.gyvas.test.ts` — tikros frazės su tikru modeliu; paleidžiamas tik
  sąmoningai: `GYVAS=1 npx vitest run test/asistentas.gyvas.test.ts` (reikia rakto
  `.dev.vars`, kainuoja ~0,02 $). Keičiant instrukcijas ar modelį — paleisti.
- Pranešimų grandinė be telefono: `node scripts/bandomasis-telefonas.mjs` (kai veikia
  `wrangler dev`) — apsimeta naršykle Mozilla pranešimų tarnyboje.
- Frontend tipai: `cd frontend && npx tsc -b`.

## Žinomi spąstai

- **`npm run build` prieš kiekvieną `deploy`** — Worker'is diegiamas kartu su `frontend/dist`.
  `prebuild` sugeneruoja `public/versija.txt`, kad visada būtų bent vienas pakeistas failas
  (be jo wrangler kartais palikdavo seną `index.html`).
- **`/assets/*` kešuojami metams**, todėl nerastas failas turi grąžinti 404, ne `index.html` —
  kitaip klaidingas atsakymas įstrigtų naršyklėje. Service worker'is HTML ima iš tinklo, be
  ryšio — paskutinį sėkmingą.
- **Nemokamas planas: 10 ms CPU ir 50 kreipinių į D1 per paleidimą.** Kelias užklausas siųsti
  vienu `db.batch([...])`; daug eilučių — `INSERT … SELECT … FROM (VALUES …)`. D1 leidžia
  daugiausia 5 `UNION ALL` dalis.
- **Keli `wrangler dev` tame pačiame prievade** — užklausos pasiskirsto atsitiktinai.
  Patikrinti `netstat -ano | findstr :8787` ir palikti vieną.
- **D1 `--remote` kartais `7403 not authorized`** — laikina, pakartoti.
- **Windows: daugiaeilis `--command` nukerpamas** (`npx` yra `.cmd`) — SQL'e `char(10)` arba
  `--file`. Git Bash `curl` sugadina lietuviškas raides argumentuose ir nerodo Cloudflare
  suspaustų (br) atsakymų — tikrinti Node `fetch`, turinį siųsti iš failo.
- **Failų vardai, besiskiriantys tik raidžių dydžiu**, Windows'e susipainioja
  (`Pranesimai.tsx` ir `prenumerata.ts` — todėl skirtingi vardai).
- **Vietinė D1 kartais „užstringa“** (`SQLITE_READONLY`): ištrinti
  `backend/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite`. `--persist-to`
  į ilgą kelią Windows'e baigiasi „internal error“ (260 simbolių riba).
- **Laikmatį vietoje paleisti ranka:** `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+2+*+*+SUN"`.
- **Naršyklės langelio telefono emuliacija meluoja** apie plotį — tikrinti
  `document.body.scrollWidth` ir tikrą telefoną. Pranešimai ten visada užblokuoti.
- **Anthropic modelių parametrai keičiasi** (pvz., Haiku nepriima `temperature`) — klaidos
  tekstas rašomas į Worker'io žurnalą (`npx wrangler tail`), appse rodoma žmoniška žinutė.
- **Google sinchronizavimas:** pasikartojančius įvykius Google atsiunčia kartais (atskiros
  eilutės su `series_google_id`); neišsiųstas pakeitimas appse laimi prieš Google; pilnas
  langas −60…+400 d. kartą per dieną, puslapiais per kelis paleidimus.
