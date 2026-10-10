# Diegimas nuo nulio

AI agentui. Žingsnių numeriai — kaip `AGENTS.md` lentelėje. Komandos vykdomos iš `backend/`,
jei neparašyta kitaip. Windows PowerShell 5.1 nesupranta `&&` — komandas leisk po vieną.

Žymėjimas: **[AI]** — darai pats; **[Žmogus]** — prašai žmogaus ir duodi tikslius žingsnius.

---

## 0. Aplinka [AI]

```bash
node --version      # reikia v24 ar naujesnės (testai naudoja node:sqlite)
git --version
```

Jei Node.js nėra ar jis senesnis — **[Žmogus]** įdiegia „LTS“ versiją iš https://nodejs.org
(Windows/macOS — atsisiųsti ir spausti „Next“). Po įdiegimo terminalą reikia atidaryti iš naujo
(Claude Code / Codex — paleisti iš naujo).

```bash
cd backend
npm ci
npx vitest run       # visi testai turi praeiti (vienas „skipped“ — gyvas asistento testas, normalu)
cd ../frontend
npm ci
```

Jei testai krenta tik vienas kitas ir dėl laiko juostos ar Node versijos — pasakyk žmogui ir
tęsk; jei krenta daug — pirma išsiaiškink (dažniausiai per sena Node versija).

## 1. Klausimynas → `seima.json` [AI + Žmogus]

`docs/KLAUSIMYNAS.md`. Tada:

```bash
cd backend
node scripts/sukurti-seima.mjs      # seima.json -> backend/seima.sql
node scripts/konfiguruoti.mjs       # SEIMA ir MODULIAI -> wrangler.toml, wrangler.mcp.toml
```

## 2. Parodyti appsą vietoje (nebūtina) [AI]

Jei žmogus nori pirma pamatyti, kaip atrodo:

```bash
cd frontend && npm run build
cd ../backend
npx wrangler d1 migrations apply namai-db --local
npx wrangler d1 execute namai-db --local --file=seima.sql
npx wrangler dev                     # http://localhost:8787
```

Vietinė bazė gyvena `backend/.wrangler/` ir su tikrąja nesusijusi. Sustabdyk serverį prieš
tęsdamas (keli `wrangler dev` tame pačiame prievade elgiasi keistai).

## 3. Cloudflare paskyra [Žmogus + AI]

**[Žmogus]** Jei paskyros nėra: https://dash.cloudflare.com/sign-up — el. paštas ir
slaptažodis, patvirtinti laišką. Planas — **Free**; kortelės nereikia.

**[AI]**

```bash
npx wrangler login     # atsidaro naršyklė — žmogus spaudžia „Allow“
npx wrangler whoami    # turi rodyti paskyrą
```

Jei `wrangler login` neveikia (pvz., agentas veikia ne žmogaus kompiuteryje): **[Žmogus]**
Cloudflare → My Profile → API Tokens → Create Token → šablonas „Edit Cloudflare Workers“,
papildomai pridėti teisę **Account → D1 → Edit**. Žetoną žmogus pats įrašo į failą
`backend/.env` eilute `CLOUDFLARE_API_TOKEN=…` (failas į git nekeliamas). Į pokalbį jo neklijuoti.

Patikrink, ar paskyroje dar nėra Worker'ių `namai` ir `namai-claude` (Cloudflare → Workers &
Pages). Jei yra (pvz., kita šeima toje pačioje paskyroje) — pakeisk `name` abiejuose
`wrangler*.toml` ir adresus (`APP_URL`, `MCP_URL`) atitinkamai.

## 4. Duomenų bazė ir saugyklos [AI]

```bash
npx wrangler d1 create namai-db --location eeur
npx wrangler kv namespace create BACKUPS
npx wrangler kv namespace create OAUTH_KV        # tik jei įjungtas modulis „claude“
```

Iš išvesties pasiimk `database_id` ir abiejų KV `id`. Jei wrangler siūlo pats įrašyti į
konfigūraciją — atsisakyk (tai padaro kitas žingsnis).

## 5. Konfigūracija [AI]

```bash
node scripts/konfiguruoti.mjs --d1 <database_id> --kv-kopijos <BACKUPS id> --kv-oauth <OAUTH_KV id>
```

Be „claude“ modulio `--kv-oauth` praleisk (MCP Worker'is tada nediegiamas). Scenarijus parodo,
kas dar neužpildyta — po šio žingsnio turi likti tik `<<WORKERS_SUBDOMENAS>>`.

## 6. Bazės struktūra, šeima, pirmas diegimas [AI]

```bash
npx wrangler d1 migrations apply namai-db --remote
npx wrangler d1 execute namai-db --remote --file=seima.sql
cd ../frontend && npm run build
cd ../backend && npx wrangler deploy
```

`--remote` kartais grąžina `7403 not authorized` — tiesiog pakartok.

Jei `deploy` sako, kad reikia **workers.dev subdomeno** — **[Žmogus]** Cloudflare → Workers &
Pages → dešinėje „Subdomain“ (ar pirmą kartą atidarius — pasiūlymas jį susikurti) → įrašyti
trumpą vardą (pvz., pavardę) → Save. Tada `deploy` iš naujo.

Išvestyje bus adresas `https://namai.<subdomenas>.workers.dev`. Įrašyk subdomeną ir diek dar
kartą (adresas reikalingas pranešimams ir Claude jungčiai):

```bash
node scripts/konfiguruoti.mjs --subdomenas <subdomenas>
npx wrangler deploy
```

## 7. Cloudflare Access — užrakinti appsą [Žmogus + AI]

**Kol šis žingsnis nepatikrintas, appso adresas viešas.**

**[Žmogus]** (kompiuteryje, Cloudflare):

1. Workers & Pages → **namai** → **Settings** → **Domains & Routes**.
2. Eilutėje **workers.dev** → **Enable Cloudflare Access**. Jei paprašo susikurti „Zero Trust“
   organizaciją — įrašyti bet kokį vardą (pvz., pavardę) ir pasirinkti **Free** planą
   (0 $; jei prašo kortelės — ji reikalinga tik patvirtinimui, mokesčių nebus).
3. **Manage Cloudflare Access** → atsidariusioje programoje (Application) → **Policies** →
   politika „namai - Production“ → **Include → Emails**: įrašyti visų šeimos narių el. paštus
   iš `seima.json` (ir `bendras_el_pastas`, jei yra) → Save.
4. Rekomenduojama: programos nustatymuose **Session Duration** → **1 month** — kad telefone
   kodo nereikėtų įvedinėti kas dieną.

**[AI]** patikrink (be prisijungimo adresas turi nukreipti į Access):

```bash
node -e "fetch('https://namai.<subdomenas>.workers.dev/api/nustatymai',{redirect:'manual'}).then(r=>console.log(r.status,r.headers.get('location')))"
```

Turi būti `302` ir adresas su `cloudflareaccess.com`. Jei `200` — Access neįjungtas; toliau
neik. (Git Bash `curl` Cloudflare suspaustų atsakymų kartais nerodo — tikrink Node'u.)

**[Žmogus]** atsidaro appso adresą naršyklėje → įveda savo el. paštą → gauna kodą → įveda.
Jei prisijungimo lange nėra el. pašto kodo galimybės: Cloudflare Zero Trust → Settings
(ar Integrations) → **Identity providers / Authentication** → Add → **One-time PIN**.

Appse pirmą kartą paklausiama „Kas naudoja šį įrenginį?“ — pasirinkti save.

**Claude jungties Worker'is (`namai-claude`) už Access būti negali** — Access įjunk tik
`namai`. Nenaudok „Access“ nustatymų visiems Worker'iams iš karto.

## 8. Pranešimų raktas [AI]

```bash
node scripts/vapid-raktas.mjs
```

Raktas įrašomas į Cloudflare (`VAPID_JWK`) ir `backend/.dev.vars`. Kartoti nereikia — naujas
raktas atjungtų jau įjungtus telefonus.

## 9. Moduliai

### 9a. Asistentas (`asistentas`) [Žmogus + AI]

**[Žmogus]** https://console.anthropic.com:

1. Susikurti paskyrą (el. paštas).
2. **Billing** → papildyti sąskaitą (mažiausia suma — 5 $; šeimai to užtenka ilgam).
3. **Limits** → mėnesio išlaidų riba (pvz., 5 $) — rekomenduojama.
4. **API keys** → **Create Key** (pavadinimas „Namai“) → spausti **Copy**. Niekur neklijuoti.

**[AI]** kai žmogus pasako, kad nukopijavo:

```bash
echo | node scripts/anthropic-raktas.mjs
```

Scenarijus paima raktą iš iškarpinės, patikrina, įrašo į Cloudflare (`ANTHROPIC_API_KEY`) ir
`.dev.vars`, iškarpinę išvalo. Patikra: appse katinukui parašyti „rytoj nupirkti pieno“ —
turi atsirasti pasiūlymas pridėti pirkinį.

Modelis — Claude Haiku (`backend/src/ai/modelis.ts`); appso riba — 200 žinučių per dieną
šeimai (`DAILY_LIMIT`, `backend/src/ai/asistentas.ts`).

### 9b. Claude jungtis (`claude`) [AI + Žmogus]

**[AI]**

```bash
npx wrangler deploy -c wrangler.mcp.toml
node -e "fetch('https://namai-claude.<subdomenas>.workers.dev/.well-known/oauth-protected-resource/mcp').then(r=>r.text()).then(console.log)"
```

Turi grąžinti JSON. **[Žmogus]** appse **Daugiau → Claude jungtis** — ten parašyti žingsniai
(claude.ai → Connectors → Add custom connector → adresas → Connect → appse „Leisti“). Kiekvienas
šeimos narys, kuris naudoja Claude, prisijungia savo Claude paskyra.

Pakeitus bendrą kodą (`src/ai/`, `src/darbai/`, `src/kalendorius/`) — diegti **abu**
Worker'ius.

### 9c. Google kalendorius (`google`) [Žmogus + AI]

**[Žmogus]** https://console.cloud.google.com (geriausia ta Google paskyra, kurios kalendorių
jungsite; Google Cloud naudojimas šiam tikslui — nemokamas):

1. Viršuje — projekto pasirinkimas → **New project** → pavadinimas „Namai“ → Create.
2. **APIs & Services → Library** → „Google Calendar API“ → **Enable**.
3. **IAM & Admin → Service Accounts** → **Create service account** → pavadinimas „namai“ →
   Create and continue → (rolių nereikia) → Done.
4. Atsidaryti sukurtą paskyrą → **Keys** → **Add key → Create new key → JSON** → Create.
   Failas atsisiunčia į „Atsisiuntimai“ (Downloads).

Jei rašo, kad raktų kūrimas išjungtas („key creation is disabled“) — paskyra priklauso
organizacijai; naudoti asmeninę Gmail paskyrą.

**[AI]**

```bash
node scripts/google-raktas.mjs --istrinti
```

Scenarijus suranda naujausią raktą Atsisiuntimuose, įkelia į Cloudflare
(`GOOGLE_SERVICE_ACCOUNT`), parodo tik paslaugos paskyros el. paštą ir ištrina failą.

**[Žmogus]** appse **Daugiau → Google kalendorius** — ten parašyti žingsniai: pasidalinti
kalendoriumi su paslaugos paskyros adresu („Atlikti įvykių pakeitimus“), įrašyti kalendoriaus
adresą (pagrindinio kalendoriaus — paskyros el. paštas; atskiro — jo „Kalendoriaus ID“ iš
nustatymų) → **Prijungti**. Įvykiai iš Google atsiranda per kelias minutes.

## 10. Telefonai [Žmogus]

Kiekvienas narys, kuris naudoja appsą:

1. Telefone atsidaryti appso adresą (Android — Chrome, iPhone — Safari), prisijungti el. pašto
   kodu, pasirinkti „Kas naudoja šį įrenginį“.
2. Įsidėti į ekraną: Android — **⋮ → Įdiegti programą / Pridėti prie pagrindinio ekrano**;
   iPhone — Safari mygtukas **Bendrinti** (kvadratas su rodykle) → **Add to Home Screen**
   (lietuviškai — „…pradžios ekrano“). Toliau atidaryti tik iš ikonos (iPhone pranešimai veikia
   tik taip, iOS 16.4 ar naujesnė).
3. Appse **Daugiau → Pranešimai → Įjungti** → leisti pranešimus → **Išbandyti**.

## 11. Finansai — pirmas išrašas [Žmogus + AI]

Tik jei įjungtas modulis `finansai`. `docs/FINANSAI.md`: kaip parsisiųsti išrašą iš SEB ar
Swedbank ir įkelti (**Finansai → Importas**). Pirmą kartą verta tai padaryti kartu: peržiūroje
pataisyti kategorijas ir sukurti taisykles dažniausiems gavėjams. Kreditai, draudimai,
pensijos — nebūtina, juos galima suvesti iš sutarčių vėliau (`docs/FINANSAI.md`).

## 12. Perdavimas

`AGENTS.md`, 12 punktas. Prieš tai patikrink:

- `npx wrangler deployments list` — paskutinis diegimas yra;
- appsas atsidaro prisijungus, be prisijungimo — nukreipia į Access (7 žingsnio komanda);
- „Daugiau → Atsarginės kopijos“ → „Daryti kopiją dabar“ — pavyksta;
- įjungti moduliai patikrinti (9 žingsnis).
