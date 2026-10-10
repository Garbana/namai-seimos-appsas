# Namai — šeimos appsas

Lietuviškas šeimos appsas telefone ir kompiuteryje: dienos darbai, bendras kalendorius,
užduotys su priminimais, pirkinių sąrašas, namų ruoša pakaitomis, projektai (pvz., gimtadienio
planas su biudžetu) ir — jei norite — šeimos finansai iš banko išrašų bei AI asistentas, kuriam
tiesiog pasakote, ką reikia padaryti.

Appsas veikia jūsų pačių nemokamoje Cloudflare paskyroje: duomenys laikomi ten, prieiga —
tik jūsų šeimos el. paštais.

**Diegti padeda AI.** Programuoti nereikia: atsidarykite šį projektą su AI agentu (Claude Code
ar OpenAI Codex), ir jis paklaus apie jūsų šeimą, sukonfigūruos, įdiegs ir paaiškins, ką
paspausti naršyklėje.

---

## Ką moka

**Visada:**

- **Šiandien** — šios dienos darbai, įvykiai, pirkiniai vienoje vietoje.
- **Kalendorius** — sąrašas ir mėnuo, filtras pagal žmogų, užduočių terminai kartu.
- **Užduotys** — su atsakingu, terminu, pasikartojimu, použduotimis ir priminimais telefone.
- **Pirkiniai** — bendri sąrašai, sugrupuoti pagal parduotuvės skyrius; „Gal reikia?“ pagal
  tai, ką perkate reguliariai; veikia ir be ryšio parduotuvėje.
- **Ruoša** — pasikartojantys namų darbai, gali eiti pakaitomis („tavo eilė“ pranešimas).
- **Projektai** — didesni reikalai su darbais, biudžetu ir išlaidomis.
- **Pranešimai** telefone — priminimai, rytinė suvestinė 7:30, „tau priskirtas darbas“.
- Atsarginės kopijos kas savaitę, šiukšliadėžė, tamsi tema.

**Neprivaloma (pasirenkate diegdami):**

- **Finansai** — SEB ir Swedbank išrašų importas, automatinis kategorizavimas, biudžetas,
  taupymas ir ETF, kreditai, draudimai, pensijos.
- **AI asistentas** — katinukas kampe: „kitą penktadienį pas dantistę 15 val.“ → įvykis su
  priminimu. Kainuoja centus per mėnesį (Anthropic API).
- **Claude jungtis** — Claude programa mato appsą ir įrašo į jį.
- **Google kalendorius** — abipusis sinchronizavimas su šeimos Google kalendoriumi.

## Ko reikės

- Kompiuterio (Windows, macOS ar Linux) ir apie valandos.
- AI agento: [Claude Code](https://claude.com/claude-code) arba [OpenAI Codex](https://openai.com/codex).
- El. pašto kiekvienam šeimos nariui, kuris naudosis appsu.
- Nemokamos [Cloudflare](https://dash.cloudflare.com/sign-up) paskyros (agentas paaiškins).
- Jei norite asistento — [Anthropic](https://console.anthropic.com) paskyros (min. 5 $
  papildymas); Google kalendoriui — Google paskyros.

## Kaip įdiegti

1. Parsisiųskite šį projektą: žaliame mygtuke **Code → Download ZIP** ir išskleiskite (arba
   `git clone`).
2. Atsidarykite aplanką su AI agentu (Claude Code — „Open folder“; Codex — paleiskite
   aplanke). Agentui reikės leisti vykdyti komandas ir naudotis internetu.
3. Parašykite: **„Įdiek man šį appsą“**.

Agentas vadovaujasi [`AGENTS.md`](AGENTS.md) ir [`docs/`](docs/): klausimynas → konfigūracija →
Cloudflare → užrakinimas jūsų el. paštais → integracijos → telefonai.

## Saugumas ir privatumas

- Appsas užrakintas Cloudflare Access: įleidžiami tik jūsų nurodyti el. paštai (kodas į paštą).
- Raktai (Anthropic, Google, pranešimų) laikomi tik Cloudflare paslaptyse ir jūsų kompiuteryje;
  agentas jų nemato pokalbyje.
- Šeimos duomenys (`seima.json`), banko išrašai ir dokumentai į git nekeliami.
- Jei įjungtas asistentas, jūsų žinutės ir su jomis susiję darbai bei finansų santraukos
  siunčiamos Anthropic API (API duomenys modeliams mokyti nenaudojami).

## Licencija

[MIT](LICENSE).
