# Instrukcija AI agentui: įdiegti „Namai“ šeimai

Šį failą skaito AI agentas (Claude Code, OpenAI Codex ar kitas), kuriam žmogus pasakė
maždaug „įdiek man šį appsą“. Tavo darbas — **nuo nulio įdiegti šeimai jų pačių „Namai“
appsą** jų Cloudflare paskyroje su visomis norimomis integracijomis ir galiausiai perduoti
veikiantį adresą.

Žmogus greičiausiai **neprogramuoja**. Jis moka naudotis naršykle ir telefonu, bet nežino,
kas yra terminalas, Worker'is ar API raktas. Viską, kas daroma komandomis, darai tu.

---

## 1. Elgesio taisyklės (privalomos)

1. **Kalbėk lietuviškai, paprastai.** Be žargono; jei terminas būtinas (pvz., „API raktas“),
   paaiškink vienu sakiniu. Trumpi pranešimai: kas padaryta, kas toliau, ko reikia iš žmogaus.
2. **Po vieną žingsnį.** Neužversk žmogaus dešimčia nurodymų. Kai reikia jo veiksmo naršyklėje,
   duok tikslų kelią (ką atsidaryti, kur spausti, ką įrašyti) ir palauk, kol jis pasakys, kad
   padarė. Patikrink rezultatą pats, kai tik gali.
3. **Klausk, nespėliok.** Šeimos duomenis (vardai, el. paštai, moduliai) sužinok klausimynu
   (`docs/KLAUSIMYNAS.md`). Kur klausime yra numatytas atsakymas, pasiūlyk jį.
4. **Raktai — tik per scenarijus.** Niekada neprašyk įklijuoti rakto ar slaptažodžio į pokalbį
   ir niekada jo nespausdink. Raktai keliami `backend/scripts/*-raktas.mjs` — jie raktą
   paima patys (iš iškarpinės ar failo) ir jo nerodo. Slaptažodžių į svetaines neįvedinėk —
   prisijungia pats žmogus.
5. **Asmeniniai duomenys — tik vietoje ir Cloudflare.** `seima.json`, `backend/seima.sql`,
   `backend/.dev.vars`, banko išrašai, sutartys (`asmeniniai/`) į git nekeliami —
   `.gitignore` tai užtikrina; jo nesilpnink. Nieko nesiųsk į viešas vietas.
6. **Pinigai.** Cloudflare, Google ir Claude jungtis kainuoja 0 € (nemokami planai). Vienintelė
   galima išlaida — AI asistentas appse (Anthropic API, centai per mėnesį). Jį įjunk tik žmogui
   sutikus, ir pasiūlyk Anthropic'e nustatyti mėnesio ribą. Niekur nesirink mokamų planų.
7. **Prieš tęsdamas — užrakink.** Kol neįjungta Cloudflare Access (7 žingsnis), appso adresas
   viešas: jokių banko išrašų ar kitų asmeninių duomenų į jį nekelk, kol patikra nepraeis.
8. **Klaidos — atvirai.** Jei kas nepavyko, pasakyk, ką matai, ir pasiūlyk kitą kelią.
   Nieko netrink Cloudflare paskyroje, ko nesukūrei šio diegimo metu.
9. **Kodo keisti nereikia.** Šablonas pritaikomas konfigūracija (`seima.json`, `wrangler*.toml`).
   Jei šeima vėliau paprašys pakeitimų — pirma perskaityk `docs/ARCHITEKTURA.md`.

---

## 2. Kas yra šis appsas

„Namai“ — šeimos appsas telefone ir kompiuteryje (PWA, lietuvių kalba). Visada veikia:
**Šiandien** (dienos darbai ir įvykiai), **Kalendorius**, **Užduotys** su priminimais telefone,
**Projektai** (pvz., gimtadienis su darbais ir biudžetu), **Pirkiniai** (bendras sąrašas,
veikia ir be ryšio), **Ruoša** (pasikartojantys namų darbai, galima pakaitomis), sritys ir
atsakingi, pastabos, šiukšliadėžė, atsarginės kopijos.

Neprivalomi moduliai (`MODULIAI`, žr. `docs/MODULIAI.md`):

| Modulis | Ką duoda | Ko reikia |
|---|---|---|
| `finansai` | Banko išrašų (SEB, Swedbank CSV) importas, kategorijos ir taisyklės, biudžetas, taupymas, kreditai, draudimai, pensijos | nieko papildomo |
| `asistentas` | Katinukas kampe: „kitą penktadienį pas dantistę 15 val.“ → užduotis ar įvykis; atsako ir apie finansus | Anthropic API raktas (mokama pagal naudojimą, ~0,0003 $ žinutei) |
| `claude` | Claude programa (claude.ai, telefone) mato appsą ir įrašo į jį | Claude paskyra su „custom connectors“ |
| `google` | Abipusis sinchronizavimas su šeimos Google kalendoriumi | Google paskyra, Google Cloud projektas (nemokamai) |

Techniškai: vienas Cloudflare Worker'is (`namai`) serveruoja ir puslapį, ir API; duomenys —
Cloudflare D1 (SQLite); prieiga — Cloudflare Access (kodas el. paštu). Claude jungtis —
atskiras Worker'is `namai-claude`. Daugiau — `docs/ARCHITEKTURA.md`.

---

## 3. Diegimo eiga

Kiekvieno žingsnio komandos ir paspaudimai — **`docs/DIEGIMAS.md`** (tie patys numeriai).
Darbo pradžioje susikurk šį sąrašą kaip užduočių sąrašą ir žymėk, kas padaryta.

| # | Žingsnis | Kas daro | Baigta, kai |
|---|---|---|---|
| 0 | Aplinka: Node.js 24, git, `npm ci`, testai | AI | `npx vitest run` — visi testai praeina |
| 1 | Klausimynas → `seima.json` | AI klausia, žmogus atsako | `node scripts/sukurti-seima.mjs` sukuria `seima.sql` be klaidų |
| 2 | (nebūtina) Parodyti appsą vietoje | AI | žmogus mato appsą `http://localhost:8787` |
| 3 | Cloudflare paskyra ir `wrangler login` | žmogus (paskyra), AI | `npx wrangler whoami` rodo paskyrą |
| 4 | Duomenų bazė ir saugyklos | AI | turimi D1 ir KV id |
| 5 | Konfigūracija | AI | `konfiguruoti.mjs` nerodo neužpildytų vietų (išskyrus subdomeną) |
| 6 | Bazės struktūra, šeima, pirmas diegimas | AI | appsas atsidaro `https://namai.<subdomenas>.workers.dev` |
| 7 | **Cloudflare Access** — užrakinti | žmogus (naršyklėje), AI tikrina | be prisijungimo adresas nukreipia į `…cloudflareaccess.com` |
| 8 | Pranešimų raktas | AI | `vapid-raktas.mjs` — ✓ |
| 9 | Moduliai: asistentas, Claude, Google | žmogus + AI | kiekvienas įjungtas modulis patikrintas |
| 10 | Telefonai: appsas ekrane, pranešimai | žmogus | kiekvienas narys gavo bandomąjį pranešimą |
| 11 | Finansai: pirmas išrašas (jei modulis įjungtas) | žmogus + AI | operacijos matyti „Apžvalgoje“ |
| 12 | Perdavimas | AI | žmogus gavo santrauką (žr. žemiau) |

**Jei kas nors jau padaryta** (pvz., žmogus grįžo po pertraukos) — pirma patikrink būseną
(`seima.json` yra? `wrangler.toml` užpildytas? `npx wrangler whoami`? adresas atsidaro?) ir
tęsk nuo pirmo nepadaryto žingsnio.

### 12. Perdavimo santrauka žmogui

Pabaigoje parašyk trumpai ir aiškiai:

- appso adresas ir kaip jį įsidėti į telefoną;
- kas įjungta (moduliai) ir kas kainuoja (jei asistentas — kur Anthropic'e matyti išlaidas);
- kur gyvena duomenys (Cloudflare D1), atsarginės kopijos (kas sekmadienį automatiškai,
  appse „Atsarginės kopijos“ — parsisiųsti į kompiuterį);
- kad šio aplanko netrintų (jame `seima.json` ir konfigūracija), o jei ištrins — appsas
  veiks toliau, tik keisti jį bus sunkiau (`docs/PRIEZIURA.md`);
- kaip pranešti apie klaidas: appse „Pastabos ir klaidos“, o pataisyti — vėl atsidaryti šį
  aplanką su AI agentu ir paprašyti „pažiūrėk pastabas“ (`docs/PRIEZIURA.md`).

---

## 4. Dokumentai

| Failas | Kam |
|---|---|
| `docs/KLAUSIMYNAS.md` | Ką klausti ir kaip atsakymus įrašyti į `seima.json` |
| `docs/DIEGIMAS.md` | Kiekvieno žingsnio komandos ir paspaudimai |
| `docs/MODULIAI.md` | Ką daro kiekvienas modulis, kiek kainuoja, kaip įjungti vėliau |
| `docs/FINANSAI.md` | Banko išrašai, taisyklės, kreditai/draudimai/pensijos iš dokumentų |
| `docs/PRIEZIURA.md` | Atnaujinimai, kopijos ir atkūrimas, nariai, raktai, pastabos |
| `docs/ARCHITEKTURA.md` | Kodo sandara, duomenų modelis, žinomi spąstai — prieš keičiant kodą |
