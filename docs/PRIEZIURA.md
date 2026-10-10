# Priežiūra

AI agentui, kai šeima grįžta su prašymu po diegimo. Komandos — iš `backend/`.

## Diegimas po pakeitimų

```bash
cd frontend && npm run build          # prieš kiekvieną deploy — kitaip įdiegsi seną sąsają
cd ../backend
npx vitest run
npx wrangler d1 migrations apply namai-db --remote     # jei yra naujų migracijų
npx wrangler deploy
npx wrangler deploy -c wrangler.mcp.toml               # jei įjungtas „claude“ ir keistas bendras kodas
```

Patikrinti galima `https://namai.<subdomenas>.workers.dev/versija.txt` (prisijungus) — laikas
turi sutapti su paskutiniu `npm run build`.

## Atnaujinimai iš šablono

Jei šeimos kopija atsirado `git clone` iš šablono, naujas versijas galima parsinešti:

1. Pirmą kartą — išsaugoti savo konfigūraciją (jos `git pull` nepalies; id ir adresai nėra
   paslaptis): `git add backend/wrangler.toml backend/wrangler.mcp.toml` ir
   `git commit -m "Šeimos konfigūracija"`.
2. `git pull`. Jei konfliktas `wrangler*.toml` — palikti šeimos reikšmes (id, adresai,
   `SEIMA`, `MODULIAI`) ir naujas šablono eilutes.
3. `npm ci` abiejuose aplankuose, tada „Diegimas po pakeitimų“ (su migracijomis).

`seima.json`, `seima.sql`, `.dev.vars`, `asmeniniai/` git'e nėra — jiems atnaujinimai
nekenkia.

## Pastabos iš appso

Šeima klaidas ir idėjas įrašo appse („Pastabos ir klaidos“, katinukui „užfiksuok klaidą…“,
👎 po katinuko atsakymu). Kai prašo „pažiūrėk pastabas“:

```bash
npx wrangler d1 execute namai-db --remote --command "SELECT id, kind, text, screen, details, created_at FROM feedback WHERE status = 'nauja' ORDER BY id"
```

Pataisius — pažymėti (ir trumpai parašyti, kas padaryta):

```bash
npx wrangler d1 execute namai-db --remote --command "UPDATE feedback SET status = 'sutvarkyta', resolution = 'Kas padaryta', resolved_at = datetime('now') WHERE id = 12"
```

Daugiaeilių `--command` Windows'e nenaudoti (nukerpama) — ilgesniam SQL rašyti failą ir
`--file`.

## Šeimos nariai

- **Naujas narys, kitas el. paštas, spalva:** pakeisti `seima.json` →
  `node scripts/sukurti-seima.mjs` → `npx wrangler d1 execute namai-db --remote --file=seima.sql`.
  Jei keitėsi el. paštai — pakeisti ir Cloudflare Access politiką (`docs/DIEGIMAS.md` 7).
- **Narys nebenaudojamas:** `UPDATE members SET is_active = 0 WHERE name = '…'` (istorija lieka)
  ir išimti jo el. paštą iš Access.

## Atsarginės kopijos ir atkūrimas

Kas sekmadienį 02:00 UTC visos bazės kopija įrašoma į KV (laikomos 12 automatinių ir 5
rankinės). Appse „Atsarginės kopijos“ — parsisiųsti dabartinę kopiją, išsaugotos kopijos,
„Daryti kopiją dabar“. Jei automatinė kopija nepavyksta ar yra senesnė nei 8 d. — appse
rodomas įspėjimas. Kartą per mėnesį verta parsisiųsti kopiją į kompiuterį (appsas primena).

Atkurti (failas pats ištrina esamus duomenis ir įrašo kopijos):

```bash
npx wrangler d1 migrations apply namai-db --remote
npx wrangler d1 execute namai-db --remote --file=kopija.sql
```

Klaidai per paskutines 7 d. atšaukti paprasčiau — D1 Time Travel:
`npx wrangler d1 time-travel restore namai-db --timestamp=<ISO laikas>`.

## Raktai

| Raktas | Kur | Pakeisti |
|---|---|---|
| Anthropic (`ANTHROPIC_API_KEY`) | Worker'io paslaptis, `.dev.vars` | naujas raktas Anthropic'e → `echo \| node scripts/anthropic-raktas.mjs` |
| Google (`GOOGLE_SERVICE_ACCOUNT`) | Worker'io paslaptis | naujas JSON raktas → `node scripts/google-raktas.mjs --istrinti` |
| Pranešimai (`VAPID_JWK`) | Worker'io paslaptis, `.dev.vars` | `node scripts/vapid-raktas.mjs` — tik jei būtina: po to kiekviename telefone „Pranešimai → Išjungti → Įjungti“ |

Paslapčių sąrašas: `npx wrangler secret list` (reikšmės nerodomos).

## Ribos

Cloudflare nemokamas planas šeimai pakanka su atsarga (100 000 užklausų per dieną, D1 —
5 GB). Worker'is turi 10 ms procesoriaus laiko vienam paleidimui ir iki 50 kreipinių į D1 —
todėl kodas kelias užklausas siunčia `db.batch` (`docs/ARCHITEKTURA.md`).

Žurnalai realiu laiku: `npx wrangler tail` (ir `npx wrangler tail -c wrangler.mcp.toml`).
