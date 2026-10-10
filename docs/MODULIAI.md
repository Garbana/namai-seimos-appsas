# Moduliai

Visada veikia: Šiandien, Kalendorius (appso), Užduotys su priminimais, Projektai, Pirkiniai,
Ruoša, Sritys ir atsakingi, Pranešimai, Pastabos, Šiukšliadėžė, Atsarginės kopijos.

Neprivalomi moduliai įjungiami Worker'io kintamuoju `MODULIAI` (kableliais) —
`backend/wrangler.toml` ir `backend/wrangler.mcp.toml`. Abu nustato
`node scripts/konfiguruoti.mjs` pagal `seima.json` → `"moduliai"`. Išjungto modulio skiltys
nerodomos, jo įrankių nemato nei katinukas, nei Claude, o laikmatis jo darbų nedaro.
Duomenys bazėje lieka — įjungus vėl viskas matyti.

## finansai

Banko išrašų importas (SEB ir Swedbank Lietuvoje, CSV), automatinis kategorizavimas
taisyklėmis, apžvalga pagal mėnesius ir grupes, biudžeto ribos, operacijų tvarkymas
(skaidymas, sudengimas, vidiniai pervedimai), reguliarių mokėjimų priminimai, taupymo
katiliukai ir ETF, kreditai, draudimai, pensijos. Projektų biudžetą galima susieti su banko
operacijomis; artėjantys draudimų ir kreditų terminai patys tampa darbais.

Kaina — 0 €. Smulkiau — `docs/FINANSAI.md`.

**Įjungti vėliau:** įrašyti `"finansai"` į `seima.json` → `node scripts/sukurti-seima.mjs`
(sukurs asmenines grupes ir taisykles) → `npx wrangler d1 execute namai-db --remote --file=seima.sql`
→ `node scripts/konfiguruoti.mjs` → `npx wrangler deploy` (ir `-c wrangler.mcp.toml`, jei yra).

## asistentas

Katinukas (maneki-neko) burbuliuke kampe. Pasakai ar parašai, ką reikia padaryti: „kitą
penktadienį pas dantistę 15 val.“, „nupirkti pieno ir duonos“, „kas savaitę šeštadienį
siurbti, pakaitomis“ — jis pasiūlo veiksmus kortelėmis (užduotys, įvykiai, pirkiniai, ruoša,
projektai), kuriuos patvirtini; atlikimas ir pirkiniai įrašomi iš karto su „Atšaukti“. Atsako ir
į klausimus apie finansus (tik skaito). „Užfiksuok klaidą: …“ — įrašo pastabą.

- Modelis: Claude Haiku per Anthropic API (`backend/src/ai/modelis.ts`).
- Kaina: ~0,0003 $ paprastai žinutei, ~0,001 $ finansų klausimui. Anthropic sąskaitą reikia
  papildyti iš anksto (min. 5 $); patartina nustatyti mėnesio ribą Anthropic'e.
- Appso apsauga: 200 žinučių per dieną visai šeimai. Istorija ir mėnesio kaina — appse
  „Asistentas“.
- Balsas: telefono mikrofonas (Chrome kalbos atpažinimas lietuviškai, nemokamas) arba
  klaviatūros diktavimas.

**Įjungti vėliau:** `"asistentas"` į `seima.json` → `node scripts/konfiguruoti.mjs` →
`npx wrangler deploy` → rakto žingsnis (`docs/DIEGIMAS.md` 9a).

## claude

Claude programa (claude.ai, telefone ir kompiuteryje) jungiama prie appso kaip „custom
connector“ (MCP). Claude mato darbus, projektus, pirkinius, kalendorių (ir finansus, jei
įjungti — tik skaityti) ir gali juos keisti: pvz., pokalbyje suplanavus gimtadienį — „perkelk
į Namų projektus“. Įrašai appse žymimi „Claude“.

- Atskiras Worker'is `namai-claude` (`backend/wrangler.mcp.toml`), ne už Access; apsauga —
  OAuth: prieigą Claude gauna tik žmogui paspaudus „Leisti“ appse. Atjungti — appse
  „Daugiau → Claude jungtis“.
- Kaina — 0 € (dirba šeimos nario Claude paskyra). Reikia Claude plano, kuriame yra
  „custom connectors“.

**Įjungti vėliau:** `npx wrangler kv namespace create OAUTH_KV` →
`node scripts/konfiguruoti.mjs --kv-oauth <id>` (su `"claude"` `seima.json`) → `npx wrangler deploy`
→ `npx wrangler deploy -c wrangler.mcp.toml` → `docs/DIEGIMAS.md` 9b.

## google

Abipusis sinchronizavimas su vienu Google kalendoriumi: kas sukurta appse, iškart atsiranda
Google (ir visų telefonų kalendoriuose), kas sukurta ar pakeista Google — per ~2 min.
atsiranda appse. Dalyviai Google'e matomi spalva (artimiausia nario spalvai).

- Jungiamasi Google Cloud paslaugos paskyra (service account) — nemokamai. Raktas — Worker'io
  paslaptis `GOOGLE_SERVICE_ACCOUNT`.
- Būsena, paskutinis sinchronizavimas ir klaidos — appse „Daugiau → Google kalendorius“.

**Įjungti vėliau:** `"google"` į `seima.json` → `node scripts/konfiguruoti.mjs` →
`npx wrangler deploy` (ir MCP, jei yra) → `docs/DIEGIMAS.md` 9c.
