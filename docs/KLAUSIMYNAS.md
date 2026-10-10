# Klausimynas: ką paklausti šeimos

AI agentui. Klausk **po vieną klausimą** (ar kelis labai susijusius), paprastai, su pasiūlytu
atsakymu, kur jis yra. Atsakymus įrašyk į `seima.json` projekto šaknyje (pradėk nuo
`seima.pavyzdys.json` kopijos). Pabaigoje parodyk žmogui santrauką žmonių kalba („Šeima —
Pavardeniai; nariai: Jonas (mėlyna, jonas@…), …; įjungta: finansai, kalendorius su Google…“)
ir paklausk, ar viskas teisingai.

`seima.json` į git nekeliamas — jame el. paštai.

---

## 1. Šeimos pavadinimas

> Kaip pavadinti jūsų šeimą appse? Jis matysis šoninėje juostoje, pvz., „Pavardeniai“.

→ `"seima"`. Numatytas — „Mūsų šeima“.

## 2. Šeimos nariai

> Kas yra jūsų šeimoje? Išvardinkite visus, kuriems bus skiriami darbai ar įvykiai — ir vaikus.

**Pirmas sąraše — tas, kuris tvarko appsą** (dažniausiai tas, kuris jį diegia): jam kartą per
mėnesį ateina priminimas parsisiųsti atsarginę kopiją.

Kiekvienam nariui sužinok:

| Klausimas | Laukas | Pastabos |
|---|---|---|
| Vardas | `vardas` | Kaip bus rodomas appse. Vardai turi skirtis. |
| Ar tai vaikas? | `vaikas` | `true` — neturės asmeninės finansų grupės ir atlyginimo kategorijos. |
| Ar jis pats naudosis appsu (telefone ar kompiuteryje)? | `naudoja_appsa` | Numatyta: suaugusieji — taip, vaikai — ne. Kas nesinaudoja, negauna pranešimų, bet jam galima priskirti darbus. |
| El. paštas prisijungimui | `el_pastai` (sąrašas) | Tik tiems, kas naudojasi. Į jį ateis prisijungimo kodas. Gali būti keli. |
| Pavardė (tik suaugusiųjų ir tik jei bus finansai) | `pavarde` | Kad pervedimai tarp šeimos narių nebūtų laikomi išlaidomis ar pajamomis. Moters ir vyro pavardės dažnai skiriasi (Pavardenis / Pavardenė) — klausk kiekvieno. |
| Spalva (nebūtina) | `spalva` | `#RRGGBB`. Matosi ant darbų ir kalendoriuje. Jei nerūpi — scenarijus parinks pats. |

Paaiškink, kodėl reikia el. pašto: appsas užrakintas, įleidžiami tik šie adresai; kiekvieną
kartą jungiantis naujame įrenginyje į paštą ateina kodas (slaptažodžio nėra).

## 3. Bendras el. paštas (nebūtina)

> Ar turite bendrą šeimos el. paštą, kuriuo norėtumėte jungtis?

→ `"bendras_el_pastas"` (arba `null`). Jis įleidžiamas, bet nepriskiriamas nė vienam nariui —
appsas kiekviename įrenginyje vieną kartą paklausia „Kas naudoja šį įrenginį?“. Tas pats
klausimas užduodamas ir tada, kai prisijungiama asmeniniu paštu: „kas aš“ įsimenama
įrenginyje.

## 4. Moduliai

Darbai, kalendorius, pirkiniai, ruoša, projektai ir pranešimai būna visada. Paklausk apie
kiekvieną neprivalomą modulį (smulkiau — `docs/MODULIAI.md`):

- **Finansai.** „Ar norite appse matyti šeimos išlaidas iš banko išrašų? Palaikomi SEB ir
  Swedbank (Lietuva) — išrašą parsisiunčiate iš banko ir įkeliate.“ Jei bankas kitas —
  paaiškink, kad jo išrašų appsas kol kas neskaito; modulį galima įjungti vėliau.
- **Asistentas.** „Ar norite AI asistento (katinukas kampe)? Jam pasakote ar parašote, ką
  reikia padaryti, — jis sukuria užduotį, įvykį, pirkinį. Kainuoja pagal naudojimą: Anthropic
  sąskaitą reikia papildyti (min. 5 $), o šeimai tai būna keli centai per mėnesį.“
- **Claude.** „Ar naudojate Claude programą (claude.ai)? Ją galima sujungti su appsu — tada
  Claude mato jūsų darbus ir gali juos įrašyti. Kainuoja 0 € (naudojama jūsų Claude paskyra).“
- **Google kalendorius.** „Ar naudojate Google kalendorių? Appso kalendorius gali
  sinchronizuotis su vienu Google kalendoriumi abiem kryptimis. Geriausia — bendras šeimos
  kalendorius ar paskyra, kurią visi mato savo telefonuose.“ Sužinok, kurios paskyros
  kalendorių jungti (to reikės 9 žingsnyje).

→ `"moduliai"`: pvz., `["finansai", "asistentas", "claude", "google"]` arba `[]`.

## 5. Darbų sritys ir atsakingi

Pradinės sritys: Namai, Vaikai, Sveikata, Automobilis, Augintiniai, Dokumentai ir mokėjimai,
Šventės ir dovanos, Kelionės, Kita.

> Kurių sričių jums nereikia? (pvz., neturite automobilio ar augintinių)

→ `"pasalintos_sritys"`: pvz., `["Augintiniai"]`.

> Kas paprastai rūpinasi kiekviena sritimi? Jei nepasakysite — darbai liks be atsakingo,
> kol kas nors juos pasiims.

→ `"sritys"`: `{ "Vaikai": "Rūta", "Automobilis": "Jonas" }`. Neprivaloma; sritis ir
atsakingus galima keisti ir appse („Sritys ir atsakingi“).

## 6. Finansų grupės (tik jei finansai įjungti)

Pradinės išlaidų grupės: Komunaliniai, Draudimas, Kreditai, Automobilis, Augintiniai, Bendros
išlaidos, Vaikai, Taupymas, Pensijos, taip pat Pajamos ir Vidiniai pervedimai. Kiekvienam
suaugusiajam scenarijus papildomai sukuria asmeninę grupę jo vardu (drabužiai, grožis, sportas,
sveikata, telefonas, taksi, viešasis transportas, kita) ir atlyginimo kategoriją „{Vardas} DU“.

> Kurių grupių jums tikrai nereikia? (pvz., neturite automobilio, augintinių ar vaikų)

→ `"pasalintos_finansu_grupes"`: galima šalinti tik Komunaliniai, Automobilis, Augintiniai,
Vaikai. Kitomis remiasi appso skiltys — jos gali likti tuščios. Kategorijas vėliau galima
pridėti appse.

---

## Pavyzdys

```json
{
  "seima": "Pavardenių šeima",
  "nariai": [
    { "vardas": "Jonas", "pavarde": "Pavardenis", "spalva": "#2a78d6", "el_pastai": ["jonas@example.com"] },
    { "vardas": "Rūta", "pavarde": "Pavardenė", "spalva": "#1baf7a", "el_pastai": ["ruta@example.com"] },
    { "vardas": "Ema", "spalva": "#eda100", "vaikas": true }
  ],
  "bendras_el_pastas": null,
  "moduliai": ["finansai", "asistentas", "claude", "google"],
  "sritys": { "Vaikai": "Rūta", "Automobilis": "Jonas", "Dokumentai ir mokėjimai": "Jonas", "Šventės ir dovanos": "Rūta" },
  "pasalintos_sritys": [],
  "pasalintos_finansu_grupes": []
}
```

Patikrink: `node scripts/sukurti-seima.mjs` (iš `backend/`). Klaidos parašytos žmonių kalba —
pataisyk `seima.json` ir paleisk iš naujo. Scenarijų galima leisti kiek nori kartų: nariai
atnaujinami, kategorijos ir taisyklės nesidubliuoja.

**Vėliau pasikeitus šeimai** (naujas narys, kitas el. paštas) — pakeisk `seima.json`,
paleisk scenarijų ir įvykdyk `seima.sql` (`docs/PRIEZIURA.md`). Nario ištrinti scenarijus
nemoka — žr. ten pat.
