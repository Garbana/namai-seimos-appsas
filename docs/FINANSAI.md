# Finansai

Modulis `finansai`. Visa šeima mato tą patį: tai bendras biudžetas, ne asmeninės paskyros.
Sąskaitos savininkas (kieno išrašas) naudojamas tik asmeninėms kategorijoms ir atlyginimui
priskirti.

## Banko išrašai

Palaikomi **SEB** ir **Swedbank** (Lietuva) CSV failai; bankas atpažįstamas pats.

**[Žmogus]** parsisiunčia išrašą internetinėje bankininkystėje: sąskaitos išrašas → laikotarpis
(pirmą kartą — pvz., paskutiniai 3 mėnesiai) → eksportas **CSV** formatu. SEB viename faile
gali būti kelios sąskaitos — tai gerai.

**Appse:** Finansai → **Importas** → „Kieno išrašas“ (kas yra sąskaitos savininkas) → failas →
**Peržiūrėti**. Peržiūroje operacijos sugrupuotos grupė → kategorija → operacijos; galima keisti
kategorijas, praleisti operacijas, kurti taisykles („visada taip daryti su šiuo gavėju“).
Pakartotinai įkeltos operacijos atpažįstamos ir praleidžiamos — persidengiančius laikotarpius
kelti saugu.

Ką žinoti:

- SEB kortelių operacijose nurodyta šalis — užsienio pirkiniai patys tampa „Atostogos – …“.
  Swedbank šalies nenurodo, tad ten tokios taisyklės nesuveikia.
- Vidiniai pervedimai (tarp savo sąskaitų ir šeimos narių) nelaikomi nei išlaidomis, nei
  pajamomis. Atpažįstama pagal gavėjo sąskaitą (jei ji irgi įkelta) ir pagal šeimos narių
  vardus gavėjo laukelyje (taisyklė iš `sukurti-seima.mjs`).
- Pirmus kartus daug operacijų liks „Be kategorijos“ — tai normalu. Sutvarkius jas ir sukūrus
  taisykles kiti išrašai susiskirsto beveik patys.

## Kategorijos ir taisyklės

Pradinės grupės ir kategorijos — `backend/migrations/0002_pradiniai_duomenys.sql`, asmeninės
(kiekvieno suaugusiojo grupė, „{Vardas} DU“) — `backend/scripts/sukurti-seima.mjs`. Naujų
kategorijų galima susikurti appse (kategorijos pasirinkimo lange — „Nauja kategorija“).

Taisyklės (**Taisyklės** skiltis) tikrinamos iš eilės pagal `priority`, pirma suveikusi laimi.
Sąlyga — tekstas gavėjo ir (ar) paskirties laukelyje (`contains`, `regex`), suma, kryptis
(tik išlaidos / tik pajamos), šalis. Taikinys — kategorija, „tokio pavadinimo kategorija
sąskaitos savininko grupėje“ (pvz., „Taksi“ → Jono ar Rūtos) arba vidinis pervedimas.
Pradinės taisyklės atpažįsta dažniausias Lietuvos parduotuves, degalines, komunalines
paslaugas, prenumeratas.

## Kreditai, draudimai, pensijos (nebūtina)

Šių skilčių appse ranka užpildyti negalima — duomenys suvedami iš dokumentų. Pradžioje jos
tuščios, ir tai netrukdo.

**Kaip tai daro AI agentas:**

1. Žmogus įdeda dokumentus į aplanką `asmeniniai/` projekto šaknyje (į git nekeliamas):
   kredito sutartį ir mokėjimo grafiką, draudimo polisus, pensijų fondų ataskaitas.
2. Agentas perskaito dokumentus ir parašo SQL failą `asmeniniai/<kas>.sql` su `INSERT`
   sakiniais į lenteles žemiau (struktūra — `backend/migrations/0001_schema.sql`; pavyzdžiai,
   kaip užpildyti — `backend/test/credits.test.ts`, `insurance.test.ts`, `pensions.test.ts`).
   Sumos — **centais** (sveikais skaičiais), datos — `YYYY-MM-DD`.
3. Parodo žmogui santrauką (kas bus įrašyta), gavus sutikimą —
   `npx wrangler d1 execute namai-db --remote --file=../asmeniniai/<kas>.sql`.
4. Patikrina appse (Turtas → Kreditai / Draudimai / Pensijos).

Asmens kodų, adresų ir pilnų sąskaitų numerių į bazę nerašyti — jų appsui nereikia.

| Lentelė | Kas | Svarbiausi laukai |
|---|---|---|
| `credits` | Būsto paskola, lizingas | `kind` (`busto_paskola` / `lizingas`), `lender`, `end_date`, `original_cents`, `rate_type`, `rate_pct`, `monthly_payment_cents`, `balance_cents` + `balance_date`; kategorijos `principal_category_id`, `interest_category_id` (grupė „Kreditai“) |
| `credit_schedule` | Mokėjimų grafikas | `credit_id`, `seq`, `due_date`, `principal_cents`, `interest_cents`, `payment_cents`, `balance_after_cents` |
| `insurance_policies` | Draudimo polisai | `kind` (`gyvybes`, `kasko`, `civiline`, `bustas`, `kita`), `object_group` (nario vardas, „Automobilis“ ar „Būstas“), `insurer`, `period_start`/`period_end`, `premium_cents`, `monthly_cents`, `payment_category_id`; JSON laukai `coverages`, `conditions`, `schedule` |
| `pension_people` | Kada pensija | `owner` (vardas), `birth_date`, `payout_date` |
| `pension_products` | II/III pakopa, investicinis gyvybės draudimas | `owner`, `pillar` (`II`, `III`, `PZU` — investicinis draudimas), `provider`, `valuation` (`vienetai` — pagal fondo vienetus ir kainas, `rankinis` — vertė įvedama appse), `monthly_contribution_cents`, `gpm` |
| `pension_holdings` | Fondai ir vienetai | `product_id`, `isin`, `fund_name`, `units`, `price_source` |

Pensijų fondų kainos atnaujinamos pačios (SEB ir Swedbank fondų puslapiai). Vertes
rankiniams produktams galima įvesti appse (Pensijos → „Įvesti vertes“).

## Taupymas

Katiliukai (tikslai) kuriami appse: Turtas → Taupymas → „+ naujas taupymo tikslas“. Įnašai
susiejami su vidiniais pervedimais, galima pridėti ETF fondų pirkimus (kainos — iš Yahoo
Finance, pvz., `VWCE.DE`).
