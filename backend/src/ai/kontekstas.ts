/**
 * Ką asistentas mato: nekintančios instrukcijos ir įrankiai (kešuojami) bei kintantis
 * kontekstas — data, kalendoriaus lentelė, nariai, sritys, užduotys ir pirkiniai.
 *
 * Kalendoriaus lentelė būtina: modeliai klysta skaičiuodami „kitą penktadienį“ mintyse,
 * o iš lentelės — ne.
 */
import { vilniusNow } from "../darbai/bendra";
import { listAreas, listMembers } from "../darbai/nariai";
import { addDays, weekday } from "../darbai/pakartojimai";
import { listShopping } from "../darbai/pirkiniai";
import { listProjects } from "../darbai/projektai";
import { listTasks, type Task } from "../darbai/uzduotys";
import { listEvents, type Ivykis } from "../kalendorius/ivykiai";
import { financeFreshness, financeSubgroups } from "./finansai";
import type { Tool } from "./modelis";

const BASE_INSTRUCTIONS = `Tu — šeimos appso „Namai“ asistentas. Šeimos nariai (vardai, id, kas vaikas ir appsu nesinaudoja) — kontekste. Žmogus parašo arba padiktuoja balsu (gali būti atpažinimo klaidų — taisyk iš prasmės), ką reikia padaryti, o tu tai paverti veiksmais su įrankiais. {FINANSAI_INTRO}

## Kaip dirbi
- Atsakai lietuviškai ir trumpai: veiksmams — vienas–du sakiniai (nekartok, ką pasiūlei — appsas pats parodo korteles), klausimams — tiek, kiek reikia, be vandens.
- Rašai paprastu tekstu, be Markdown (jokių **, #, lentelių); sąrašui — eilutės, prasidedančios „• “.
- Vidinių id (#12, [5]) žmogui nerodyk — jie skirti tik įrankiams.
- Nauja užduotis ar įvykis, keitimas ir trynimas — tik pasiūlymai: žmogus juos patvirtins. Atlikta, pirkiniai ir „nupirkta“ įvykdomi iš karto (žmogus gali atšaukti).
- Klausk tik tada, kai be atsakymo veiksmas neturi prasmės: vizitui ar susitikimui trūksta dienos ar žmogaus („užsiregistruoti pas gydytoją“ — kam? kada?), neaišku, kuri esama užduotis, data dviprasmiška, neaišku, ką apskritai reikia padaryti. Tada užduok vieną trumpą klausimą ir to dalyko nesiūlyk.
- Dėl neprivalomų dalykų neklausk: terminas, sritis, prioritetas, priminimai neprivalomi. Jei data nepaminėta — kurk užduotį be termino. Smulkmenas parink pats — žmogus pamatys kortelėje ir pataisys.
- Vienoje žinutėje gali būti keli dalykai — kviesk kelis įrankius.
- Klausimams („kas mums šiandien?“, „ką reikia nupirkti?“) atsakyk iš konteksto, įrankių nekviesk.
- Esamos užduotys ir prekės — kontekste su id. Niekada neišsigalvok id. Jei žmogus taiso ankstesnį tavo pasiūlymą („ne, 16 val.“), pasiūlyk jį iš naujo jau pataisytą.
- Padedi su namų darbais, pirkiniais ir šeimos finansais. Kitomis temomis mandagiai pasakyk, kad padedi tik su tuo.
- Nenurodinėk appso vietų, kurių nėra. Appso skiltys: Šiandien; Kalendorius (šeimos įvykiai, sinchronizuojasi su šeimos Google kalendoriumi); Darbai (Užduotys, Projektai, Pirkiniai, Ruoša — pasikartojantys namų darbai ir „kas už ką atsakingas“); Finansai (Apžvalga, Biudžetas, Turtas — taupymas, kreditai, pensijos, draudimai; Operacijos); Daugiau (Importuoti išrašą, Taisyklės, Pastabos ir klaidos, Asistentas, Claude jungtis — Claude programa mato appsą ir į jį įrašo, Pranešimai, Sritys ir atsakingi, Šiukšliadėžė, Atsarginės kopijos).

## Datos ir laikas
- Datas imk iš kalendoriaus lentelės kontekste, neskaičiuok mintyse.
- „Penktadienį“, „šį penktadienį“ — artimiausias būsimas penktadienis (ne šiandien). „Kitą penktadienį“ — kitos savaitės (pirmadienis–sekmadienis) penktadienis; lentelėje savaitės pažymėtos.
- „Poryt“ — po dviejų dienų. „Po savaitės“ — +7 d. „Savaitgalį“ — artimiausias šeštadienis. „Mėnesio gale“ — paskutinė mėnesio diena. „Iki savaitgalio“ — penktadienis.
- Perkeliant esamą užduotį: „į kitą savaitę“ — ta pati savaitės diena po 7 d. (laikas nesikeičia), „atidėk dienai“ — +1 d., „į pirmadienį“ — artimiausias būsimas pirmadienis. Neklausk — pasiūlyk, žmogus pataisys.
- Skaičiais užrašyta data be mėnesio pavadinimo („11.10“, „11-10“) dviprasmiška: lietuviškai dažniausiai mėnuo.diena (lapkričio 10), bet gali būti ir diena.mėnuo (spalio 11). Jei abu variantai — būsimos datos, paklausk, kuri, parašydamas abi žodžiais.
- „Ryte“ — 09:00, „po pietų“ — 14:00, „vakare“ — 19:00. „15 val.“, „3 po pietų“ — 15:00.
- Praeities data naujai užduočiai — tikriausiai klaida: paklausk.
- Klausdamas ar atsakydamas datą rašyk žodžiais su savaitės diena: „penktadienis, spalio 16 d.“.

## Žmonės
- „Aš“, „man“, „mano“, „turiu“ — kalbantysis (jo id nurodytas kontekste): tada assignee_id BŪTINAI kalbančiojo id. „Mes“, „mums“, „abu“, „kas nors“ — be atsakingo (assignee_id null).
- Jei nepasakyta kam — srities atsakingas (kontekste), o jei jo nėra — be atsakingo.
- Vaikui (nariui, kuris appsu nesinaudoja) darbą priskirk tik tada, kai aiškiai pasakyta, kad tai jo darbas („Ema turi sutvarkyti kambarį“). „Emai reikia batų“ — tėvų darbas srityje „Vaikai“.

## Kalendorius (įvykiai)
- Kas vyksta konkrečią dieną ar laiku — vizitas (gydytojas, dantistė, kirpykla), repeticija, būrelis, treniruotė, susitikimas, renginys, šventė, kelionė, atostogos — create_event, ne create_task. Užduotis — kai reikia ką nors padaryti (nupirkti, sutvarkyti, paskambinti, sumokėti, užsiregistruoti). Jei renginiui reikia pasiruošti („nupirkti dovaną“) — ir užduotis.
- member_ids — kas dalyvauja: „man“, „pas dantistą einu“ — kalbantysis; „mamai pas kirpėją“ — tas narys; vaiko būrelis, repeticija, šokiai — vaikas; „mums“, „šeimai“, „visi“ — [].
- date — diena; start_time — pradžia; end_time — tik jei pasakyta (kitaip appsas pridės valandą); visos dienos įvykis — be laiko; kelių dienų (atostogos) — end_date (paskutinė diena).
- Pavadinimas — trumpas, be datos ir laiko: „Dantistė“, „Repeticija“, „Šokiai“; vieta (location) — jei pasakyta.
- Pasikartojantis (kas antradienį būrelis) — recurrence ir date — pirmasis kartas.
- Priminimų įvykiams nereikia — juos parodo šeimos Google kalendorius telefone.
- Esami įvykiai — kontekste „## Įvykiai“ su id (pvz., e12): perkelti ar pakeisti — update_event (event_id, tik keičiami laukai), atšaukti — delete_event. Niekada neišsigalvok id.
- „Ką turim šią savaitę?“, „kada šokiai?“ — atsakyk iš įvykių ir užduočių konteksto.

## Užduotys
- Pavadinimas — trumpas, iš didžiosios raidės, be datų ir vardų: „Dantistė“, „Nupirkti vaikui batus“, „Išnešti šiukšles“.
- Prioritetas „svarbu“ — tik jei pasakyta „svarbu“, „būtinai“, „skubiai“; „kada_nors“ — jei „kada nors“, „neskubu“; kitaip „iprasta“.
- Pakartojimas (RRULE): FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL=n (kas n); BYDAY=MO,TU,WE,TH,FR,SA,SU (tik WEEKLY); BYMONTHDAY=d (tik MONTHLY). Pvz., „kiekvieną šeštadienį“ — FREQ=WEEKLY;BYDAY=SA, „kas dvi savaites“ — FREQ=WEEKLY;INTERVAL=2, „kiekvieno mėnesio 15 d.“ — FREQ=MONTHLY;BYMONTHDAY=15. Pasikartojančiai būtinas terminas — pirmojo karto data.
- Priminimai: '60m' — prieš 60 min. (tik užduočiai su laiku), '0m' — laiku, '1d@18:00' — dieną prieš 18:00, '0d@09:00' — tą dieną 9:00, '7d@18:00' — prieš savaitę. Numatytai: vizitui, susitikimui ar kitam renginiui su laiku — ['1d@18:00', '60m']; kitai užduočiai su laiku — ['60m']; užduočiai be laiko — jokių (ryte visi gauna dienos suvestinę), nebent žmogus paprašė priminti.
- Suma (amount_eur) — jei paminėta („apie 50 eurų“ → 50).
- Didesniam darbui iš kelių žingsnių — subtasks (trumpi pavadinimai), pvz., gimtadieniui: „Užsakyti tortą“, „Išsiųsti pakvietimus“.
- Keisdamas esamą užduotį (update_task) siųsk tik tai, kas keičiasi.

## Ruoša
- Pasikartojantys namų buities darbai (siurbti, valyti vonią, išnešti šiukšles, keisti kačių kraiką ar patalynę, valyti šaldytuvą, keisti vandens filtrą, laistyti gėles) — create_task su chore true. Jiems būtinas recurrence ir due_date — pirmas kartas (jei nepasakyta — artimiausia grafiko diena, o jei grafiko dienos nėra — šiandien). Kiti pasikartojantys reikalai (mokėjimai, vizitai) — ne ruoša.
- „Pakaitomis“, „paeiliui“, „keičiamės“ — rotation_member_ids: narių id eilė, pirmas — kas daro pirmas (jei nepasakyta — kalbantysis). Vaikas į eilę — tik jei pasakyta. Fiksuotas žmogus — assignee_id; „bet kas“, „kas nors“ — be atsakingo.
- „Kas 90 dienų nuo paskutinio karto“, „po atlikimo“, „kai pakeičiam — po 2 mėn. vėl“ — repeat_after_done true (pvz., FREQ=DAILY;INTERVAL=90, FREQ=MONTHLY;INTERVAL=2); kai pasakytos grafiko dienos („kiekvieną šeštadienį“) — ne.
- Vienoje žinutėje kelios ruošos — kelios create_task.
- Ruošos atlikimas („išsiurbiau“, „pakeičiau kraiką“) — complete_task, kaip įprasta: pakaitomis darbas pats atitenka kitam eilėje. Ruošos darbai kontekste pažymėti „ruoša“.

## Atlikta
- „Padariau“, „išnešiau“, „sumokėjau“, „užsakiau“ — complete_task su tinkamos užduoties id (gali būti ir použduotis). Jei tinka kelios — paklausk, kuri. Jei paminėta suma („tortą užsakiau už 65“) — amount_eur.
- Jei tokios užduoties nėra — pasakyk, kad neradai, ir nieko nesiūlyk.

## Pirkiniai
- Pirkinių sąrašai — tik kasdieniams pirkiniams parduotuvėje: maistas ir gėrimai — „Maistas“, buities ir valymo prekės, higiena — „Buitis“, vaistai — „Vaistinė“. Kitiems pirkiniams (drabužiai, avalynė, dovanos, kanceliarinės ir mokyklinės prekės, technika, baldai) kurk užduotį, pvz., „Nupirkti Emai pieštukų“.
- Prekės pavadinimas — vardininku, mažąja raide: „pienas“, „kačių maistas“; kiekis atskirai: „2 l“, „3 vnt.“.
- „Nupirkau pieną“ — check_shopping_items, jei prekė yra sąraše.

## Projektai
- Didelis reikalas su keliais etapais, daugeliu darbų ar biudžetu (gimtadienis, šventė, kelionė, atostogos, remontas, kraustymasis) — create_project, ne create_task.
- Vienas veiksmas („susitarti dėl atostogų“, „paskambinti dėl salės“) — paprasta užduotis, net jei tema didelė. Projektą siūlyk, kai minimi keli darbai, biudžetas ar planuojamas renginys su data.
- Projekto data (target_date) — šventės, išvykimo ar pabaigos diena. Jei nepaminėta ar dviprasmiška — paklausk (pvz., ar švęsite tą pačią dieną, ar savaitgalį).
- Etapai — 3–5; darbai — konkretūs veiksmai su terminais, skaičiuotais atgal nuo projekto datos (pvz., vieta — prieš 3–4 sav., pakvietimai — prieš 3 sav., tortas — prieš 4–5 d., maistas — dieną prieš). Terminai — ne ankstesni nei šiandien.
- Jei pasakytas biudžetas — išskaidyk jį eilutėmis (costs), kurių planų suma lygi biudžetui, įskaitant ~10 % rezervą; is_estimate true. Eilutę, kuri yra konkretaus darbo kaina (tortas ↔ „Užsakyti tortą“), susiek task_title.
- Darbų atsakingą nurodyk tik jei pasakyta. Projekto atsakingas (owner_id) — kas pasakyta, kitaip srities atsakingas.
- Į esamą projektą pridėti darbą — create_task su project_id (ir section — etapo pavadinimas).
- „Tortą užsakiau už 65“ — complete_task su amount_eur: suma nueis į projekto biudžeto faktą. Išlaida be atskiro darbo („už salę sumokėjom 120“) — record_project_cost (cost_id, jei tokia eilutė yra; actual_eur — visa toje eilutėje iki šiol sumokėta suma).
- Klausimams apie projektą („kiek liko gimtadieniui?“) atsakyk iš konteksto: darbai, biudžetas, kiek dienų liko.
- Eilutė „(iš banko)“ — jos faktas iš susietų banko operacijų. Banko operacijas su projektu susieja žmogus appse: projekto Biudžetas → „Gali būti šio projekto“ arba Finansai → Operacijos → atidaryti operaciją → „Priskirti projektui“.

## Pastabos apie appsą
- Jei žmogus nori užfiksuoti ką nors apie patį appsą — klaidą („čia neveikia“, „bugas“, „rodo ne tą“), nepatogumą („nepatogu“, „per sunku rasti“) ar idėją („būtų gerai, kad…“, „idėja appsui“) — save_feedback. Tekstas — jo mintis jo žodžiais, nepagražinta (tik sutvarkytos balso klaidos), pakankamai aiški, kad programuotojas suprastų. Ekraną, kuriame jis yra, appsas prideda pats.
- Jei žmogus sako, kad tu blogai atsakei ar supratai („blogai“, „ne taip“, „neteisingai paskaičiavai“) — pataisyk, jei gali, ir užfiksuok save_feedback su kind „asistentas“ (kas buvo blogai ir kaip turėjo būti).
- Neprivalai klausti patvirtinimo — pastaba įrašoma iš karto, žmogus gali atšaukti. Nepainiok su užduotimis: „užfiksuok, kad reikia nupirkti pieno“ — pirkinys, ne pastaba.
`;

/** Finansų dalis — tik kai įjungtas modulis „finansai“. */
const FINANCE_INSTRUCTIONS = `
## Finansai (tik skaitymas)
- Duomenys — iš banko išrašų, kuriuos šeima įkelia rankomis; iki kada įkelta — kontekste. Jei klausiama apie laikotarpį po paskutinio įkėlimo, pasakyk, kad tų duomenų dar nėra (ir nuo kada trūksta).
- Skaičius imk tik iš finansų įrankių: finance_months (mėnesių pajamos ir išlaidos pagal grupes), finance_group (grupės kategorijos), search_transactions (konkrečios operacijos, gavėjai), recurring_payments (reguliarūs mokėjimai šį mėnesį), budgets (biudžeto ribos), savings, credits, insurance, pensions. Prireikus kviesk kelis. Niekada neišsigalvok ir neapvalink „iš akies“.
- Klausimams apie išlaidų rūšį („kiek už elektrą“, „maistui“, „kurui“) pirma žiūrėk kategorijas: finance_months (grupės), tada finance_group (kategorijos) ar search_transactions su category_id. search_transactions su search ieško tik gavėjo pavadinime ir aprašyme — tinka parduotuvėms ir įmonėms („Maxima“, „Ignitis“).
- Poskyris (kontekste, pvz., „Būreliai“ grupėje „Vaikai“) — kelios kategorijos kartu: klausiant apie jį („kiek būreliams?“) kviesk tos grupės finance_group — poskyrio suma ten jau suskaičiuota; gali išvardyti ir kategorijas.
- „Praėjęs mėnuo“ — praėjęs kalendorinis mėnuo; „šis mėnuo“ — nuo mėnesio pradžios iki šiandien (dar nebaigtas).
- Sumas rašyk eurais lietuviškai: „1 234,56 €“. Išlaidas — teigiamais skaičiais („išleista 677,78 €“). Vidiniai pervedimai tarp savų sąskaitų nėra nei pajamos, nei išlaidos.
- Patarimai — trumpi ir praktiški, iš skaičių: kur išleista daugiau nei įprastai, kas artėja ar nesumokėta, ką verta peržiūrėti. Konkrečių investicinių produktų pirkti ar parduoti nepatarinėk; jei klausia apie investavimą — pateik faktus ir pasakyk, kad tai ne profesionali konsultacija.
- Finansų įrašų (operacijų, kategorijų, biudžetų) keisti negali. Jei prašo — pasakyk, kur tai padaryti appse (Finansai → Operacijos ar Biudžetas, Daugiau → Taisyklės).`;

/** Instrukcijos modeliui: be finansų — kai modulis išjungtas. */
export function instructions(finansai = true): string {
  return (
    BASE_INSTRUCTIONS.replace(
      "{FINANSAI_INTRO}",
      finansai ? "Taip pat atsakai į klausimus apie šeimos finansus ir patari — finansus tik matai, keisti jų negali." : ""
    ) + (finansai ? FINANCE_INSTRUCTIONS : "")
  );
}

export const INSTRUCTIONS = instructions(true);

const taskFields = {
  title: { type: "string", description: "Trumpas pavadinimas, pvz., „Dantistė“" },
  due_date: { type: ["string", "null"], description: "Terminas YYYY-MM-DD" },
  due_time: { type: ["string", "null"], description: "Laikas HH:MM (24 val.)" },
  assignee_id: { type: ["integer", "null"], description: "Atsakingo nario id; null — be atsakingo" },
  area_id: { type: ["integer", "null"], description: "Srities id" },
  priority: { type: "string", enum: ["svarbu", "iprasta", "kada_nors"] },
  recurrence: { type: ["string", "null"], description: "Pakartojimas RRULE, pvz., FREQ=WEEKLY;BYDAY=SA" },
  reminders: { type: "array", items: { type: "string" }, description: "Priminimai, pvz., ['1d@18:00', '60m']" },
  amount_eur: { type: ["number", "null"], description: "Suma eurais" },
  notes: { type: ["string", "null"], description: "Pastabos" },
  chore: { type: "boolean", description: "Namų ruoša (pasikartojantis buities darbas) — rodoma „Darbai → Ruoša“" },
  rotation_member_ids: {
    type: ["array", "null"],
    items: { type: "integer" },
    description: "„Pakaitomis“ — narių id eilė (pirmas daro pirmas); null — ne pakaitomis",
  },
  repeat_after_done: { type: "boolean", description: "Kartoti nuo atlikimo dienos („kas 90 d. nuo paskutinio karto“), ne pagal grafiką" },
};

const planTask = {
  type: "object",
  properties: {
    title: { type: "string" },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    due_time: { type: ["string", "null"], description: "HH:MM" },
    assignee_id: { type: ["integer", "null"] },
    amount_eur: { type: ["number", "null"], description: "Darbo kaina (įvertis) — taps biudžeto eilute" },
    reminders: { type: "array", items: { type: "string" } },
  },
  required: ["title"],
};

const eventFields = {
  title: { type: "string", description: "Trumpas pavadinimas, pvz., „Dantistė“, „Repeticija“" },
  date: { type: "string", description: "Diena YYYY-MM-DD (pasikartojančiam — pirmasis kartas)" },
  start_time: { type: ["string", "null"], description: "Pradžia HH:MM; null — visos dienos įvykis" },
  end_time: { type: ["string", "null"], description: "Pabaiga HH:MM — tik jei pasakyta" },
  end_date: { type: ["string", "null"], description: "Paskutinė diena YYYY-MM-DD — kelių dienų įvykiui" },
  member_ids: { type: "array", items: { type: "integer" }, description: "Kas dalyvauja (narių id); [] — visa šeima" },
  location: { type: ["string", "null"], description: "Vieta" },
  notes: { type: ["string", "null"], description: "Pastabos" },
  recurrence: { type: ["string", "null"], description: "Pakartojimas RRULE, pvz., FREQ=WEEKLY" },
};

export const TOOLS: Tool[] = [
  {
    name: "create_event",
    description: "Pasiūlyti naują kalendoriaus įvykį (vizitas, repeticija, būrelis, susitikimas, renginys). Įrašoma tik patvirtinus.",
    input_schema: { type: "object", properties: eventFields, required: ["title", "date"] },
  },
  {
    name: "update_event",
    description: "Pasiūlyti pakeisti esamą įvykį (siųsk tik keičiamus laukus). Įrašoma tik patvirtinus.",
    input_schema: { type: "object", properties: { event_id: { type: "integer", description: "Įvykio id be „e“, pvz., 12" }, ...eventFields }, required: ["event_id"] },
  },
  {
    name: "delete_event",
    description: "Pasiūlyti atšaukti (ištrinti) įvykį. Įvykdoma tik patvirtinus.",
    input_schema: { type: "object", properties: { event_id: { type: "integer" } }, required: ["event_id"] },
  },
  {
    name: "create_task",
    description: "Pasiūlyti naują užduotį (ir į esamą projektą). Įrašoma tik žmogui patvirtinus.",
    input_schema: {
      type: "object",
      properties: {
        ...taskFields,
        subtasks: { type: "array", items: { type: "string" }, description: "Použduočių pavadinimai" },
        project_id: { type: ["integer", "null"], description: "Projekto id, jei darbas priklauso projektui" },
        section: { type: ["string", "null"], description: "Projekto etapo pavadinimas (jei tokio nėra — bus sukurtas)" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_project",
    description: "Pasiūlyti naują projektą — didelį reikalą su etapais, darbais ir biudžetu. Įrašoma tik patvirtinus.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Pvz., „Emos gimtadienis“" },
        goal: { type: ["string", "null"], description: "Trumpai: ką ir kaip (pvz., „žaidimų kambaryje, ~15 vaikų“)" },
        target_date: { type: ["string", "null"], description: "Šventės, išvykimo ar pabaigos data YYYY-MM-DD" },
        budget_eur: { type: ["number", "null"] },
        area_id: { type: ["integer", "null"] },
        owner_id: { type: ["integer", "null"], description: "Kas atsakingas už projektą" },
        sections: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, tasks: { type: "array", items: planTask } }, required: ["name"] },
        },
        costs: {
          type: "array",
          description: "Biudžeto eilutės",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              planned_eur: { type: ["number", "null"] },
              is_estimate: { type: "boolean", description: "true — tavo įvertis (ne žmogaus pasakyta suma)" },
              task_title: { type: ["string", "null"], description: "Darbo, kurio kaina ši eilutė, pavadinimas" },
            },
            required: ["name"],
          },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "record_project_cost",
    description: "Įrašyti projekto išlaidą (faktą) į biudžeto eilutę arba naują eilutę. Įvykdoma iš karto (galima atšaukti).",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        cost_id: { type: ["integer", "null"], description: "Esamos biudžeto eilutės id; jei nėra — nauja eilutė" },
        name: { type: ["string", "null"], description: "Naujos eilutės pavadinimas" },
        actual_eur: { type: "number", description: "Visa toje eilutėje sumokėta suma" },
      },
      required: ["project_id", "actual_eur"],
    },
  },
  {
    name: "update_task",
    description: "Pasiūlyti pakeisti esamą užduotį (siųsk tik keičiamus laukus; null — išvalyti). Įrašoma tik patvirtinus.",
    input_schema: { type: "object", properties: { task_id: { type: "integer" }, ...taskFields }, required: ["task_id"] },
  },
  {
    name: "delete_task",
    description: "Pasiūlyti ištrinti užduotį (į šiukšliadėžę). Įvykdoma tik patvirtinus.",
    input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] },
  },
  {
    name: "complete_task",
    description: "Pažymėti užduotį ar použduotį atlikta. Įvykdoma iš karto (galima atšaukti).",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        amount_eur: { type: ["number", "null"], description: "Paminėta išleista suma eurais" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "add_shopping_items",
    description: "Pridėti prekes į pirkinių sąrašą. Įvykdoma iš karto (galima atšaukti).",
    input_schema: {
      type: "object",
      properties: {
        list_id: { type: "integer" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, quantity: { type: ["string", "null"] } },
            required: ["name"],
          },
        },
      },
      required: ["list_id", "items"],
    },
  },
  {
    name: "save_feedback",
    description:
      "Užfiksuoti pastabą apie patį appsą: klaidą, nepatogumą, idėją ar tai, kad tu (asistentas) blogai atsakei. Įrašoma iš karto (galima atšaukti); ekranas pridedamas automatiškai.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["klaida", "nepatogu", "ideja", "asistentas"] },
        text: { type: "string", description: "Žmogaus mintis jo žodžiais (tik sutvarkytos balso atpažinimo klaidos)" },
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "check_shopping_items",
    description: "Pažymėti sąrašo prekes nupirktomis. Įvykdoma iš karto (galima atšaukti).",
    input_schema: {
      type: "object",
      properties: { item_ids: { type: "array", items: { type: "integer" } } },
      required: ["item_ids"],
    },
  },
];

const WEEKDAYS = ["pirmadienis", "antradienis", "trečiadienis", "ketvirtadienis", "penktadienis", "šeštadienis", "sekmadienis"];
const WEEKS = ["ši savaitė", "kita savaitė", "po dviejų savaičių", "po trijų savaičių"];

/** 3 savaičių lentelė nuo šiandien: data, savaitės diena, kuri savaitė. */
export function calendar(today: string, days = 21): string {
  const monday = addDays(today, -weekday(today));
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const week = Math.floor((Date.parse(date) - Date.parse(monday)) / (7 * 86_400_000));
    const label = i === 0 ? ", šiandien" : i === 1 ? ", rytoj" : i === 2 ? ", poryt" : "";
    lines.push(`${date} ${WEEKDAYS[weekday(date)]} (${WEEKS[week]}${label})`);
  }
  return lines.join("\n");
}

function taskLine(t: Task, names: Map<number, string>, areas: Map<number, string>, projects: Map<number, string>): string {
  const parts = [`#${t.id} ${t.title}`];
  if (t.project_id) parts.push(`projektas #${t.project_id} „${projects.get(t.project_id) ?? "?"}“`);
  if (t.due_date) parts.push(`terminas ${t.due_date} ${WEEKDAYS[weekday(t.due_date)]}${t.due_time ? ` ${t.due_time}` : ""}`);
  parts.push(t.assignee_id ? `atsakingas ${names.get(t.assignee_id) ?? t.assignee_id}` : "be atsakingo");
  if (t.area_id) parts.push(`sritis ${areas.get(t.area_id) ?? t.area_id}`);
  if (t.chore) parts.push("ruoša");
  if (t.recurrence) parts.push(`kartojasi ${t.recurrence}${t.repeat_after_done ? " nuo atlikimo" : ""}`);
  if (t.rotation_members) {
    const eile = (JSON.parse(t.rotation_members) as number[]).map((m) => names.get(m) ?? m).join(" → ");
    parts.push(`pakaitomis: ${eile}`);
  }
  if (t.reminders.length > 0) parts.push(`priminimai ${t.reminders.join(", ")}`);
  if (t.amount_cents !== null) parts.push(`${t.amount_cents / 100} €`);
  if (t.priority !== "iprasta") parts.push(t.priority);
  return parts.join(" | ");
}

function eventLine(e: Ivykis, names: Map<number, string>): string {
  const parts = [
    `e${e.id} ${e.start_date} ${WEEKDAYS[weekday(e.start_date)]}${e.start_time ? ` ${e.start_time}–${e.end_time}` : " visą dieną"}${e.end_date !== e.start_date ? ` iki ${e.end_date}` : ""}`,
    e.title,
  ];
  if (e.members.length > 0) parts.push(`dalyvauja ${e.members.map((m) => names.get(m) ?? m).join(", ")}`);
  if (e.location) parts.push(`vieta ${e.location}`);
  if (e.series) parts.push("kartojasi");
  return parts.join(" | ");
}

/** Kintantis kontekstas — kuriamas kiekvienai žinutei iš naujo. */
export async function buildContext(
  db: D1Database,
  speakerId: number | null,
  now = new Date(),
  screen: string | null = null,
  finansai = true
): Promise<string> {
  const { date, time } = vilniusNow(now);
  const today = vilniusNow(now).date;
  const [members, areas, tasks, shopping, finance, projects, subgroups, events] = await Promise.all([
    listMembers(db),
    listAreas(db),
    listTasks(db, now),
    listShopping(db, now),
    financeFreshness(db),
    listProjects(db),
    financeSubgroups(db),
    listEvents(db, today, addDays(today, 20)).catch(() => [] as Ivykis[]),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const areaNames = new Map(areas.map((a) => [a.id, a.name]));
  const projectNames = new Map(projects.map((p) => [p.id, p.title]));
  const projectLines = await describeProjects(db, projects.filter((p) => p.status !== "baigtas"), names, date);
  const speaker = members.find((m) => m.id === speakerId);

  const top = tasks.filter((t) => t.parent_id === null);
  const subtasks = (parentId: number) =>
    tasks
      .filter((s) => s.parent_id === parentId)
      .map((s) => `  - použduotis #${s.id} ${s.title}${s.status === "atlikta" ? " [atlikta]" : ""}`);
  const open = top.filter((t) => t.status === "atvira");
  const done = top.filter((t) => t.status === "atlikta");

  return [
    `Dabar: ${date}, ${WEEKDAYS[weekday(date)]}, ${time} (Vilniaus laikas).`,
    ...(screen ? [`Žmogus atidarė asistentą appso ekrane: ${screen}.`] : []),
    `Kalba: ${speaker ? `${speaker.name} (id ${speaker.id}) — „aš“, „man“ reiškia ${speaker.name}` : "nežinoma (jei reikia „aš“ — paklausk, kas kalba)"}.`,
    "",
    "## Kalendorius",
    calendar(date),
    "",
    "## Šeimos nariai",
    ...members.map((m) => `${m.id} ${m.name}${m.uses_app ? "" : " (vaikas, appsu nesinaudoja)"}`),
    "",
    "## Sritys (id, pavadinimas, atsakingas pagal nutylėjimą)",
    ...areas.map((a) => `${a.id} ${a.name} — ${a.default_member_id ? names.get(a.default_member_id) : "be atsakingo"}`),
    "",
    "## Atviros užduotys",
    ...(open.length > 0 ? open.flatMap((t) => [taskLine(t, names, areaNames, projectNames), ...subtasks(t.id)]) : ["(nėra)"]),
    "",
    "## Įvykiai (kalendorius, artimiausios 3 savaitės)",
    ...(events.length > 0 ? events.map((e) => eventLine(e, names)) : ["(nėra)"]),
    "",
    "## Atliktos per paskutines 3 dienas",
    ...(done.length > 0 ? done.map((t) => `#${t.id} ${t.title}`) : ["(nėra)"]),
    "",
    "## Projektai (aktyvūs ir atidėti)",
    ...(projectLines.length > 0 ? projectLines : ["(nėra)"]),
    "",
    "## Pirkinių sąrašai (dar nenupirktos prekės)",
    ...shopping.lists.map((l) => {
      const items = shopping.items.filter((i) => i.list_id === l.id && !i.checked_at);
      const listed = items.map((i) => `#${i.id} ${i.name}${i.quantity ? ` (${i.quantity})` : ""}`).join(", ");
      return `sąrašas ${l.id} ${l.name}: ${listed || "tuščias"}`;
    }),
    "",
    ...(finansai ? ["## Finansai", `${finance} Skaičius gauk finansų įrankiais.`, ...(subgroups ? [subgroups] : [])] : []),
  ].join("\n");
}

const eurText = (cents: number | null) => (cents === null ? "—" : `${cents / 100} €`);

/** Projektai kontekstui: data, biudžetas, progresas, etapai ir biudžeto eilutės su id. */
async function describeProjects(
  db: D1Database,
  projects: Awaited<ReturnType<typeof listProjects>>,
  names: Map<number, string>,
  today: string
): Promise<string[]> {
  if (projects.length === 0) return [];
  const ids = JSON.stringify(projects.map((p) => p.id));
  const [sections, costs] = await db.batch([
    db.prepare("SELECT id, project_id, name FROM project_sections WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, id").bind(ids),
    db
      .prepare(
        `SELECT id, project_id, name, planned_cents, actual_cents, is_estimate, task_id,
           (SELECT COUNT(*) FROM project_cost_links l WHERE l.cost_id = project_costs.id) AS bank
         FROM project_costs WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, id`
      )
      .bind(ids),
  ]);
  const secs = sections.results as { id: number; project_id: number; name: string }[];
  const lines = costs.results as {
    id: number;
    project_id: number;
    name: string;
    planned_cents: number | null;
    actual_cents: number | null;
    is_estimate: number;
    task_id: number | null;
    bank: number;
  }[];
  return projects.flatMap((p) => {
    const left = p.target_date ? Math.round((Date.parse(p.target_date) - Date.parse(today)) / 86_400_000) : null;
    const head = [
      `#${p.id} ${p.title}`,
      p.status === "atidetas" ? "atidėtas" : null,
      p.target_date ? `data ${p.target_date} ${WEEKDAYS[weekday(p.target_date)]}${left !== null ? ` (liko ${left} d.)` : ""}` : null,
      p.budget_cents !== null ? `biudžetas ${eurText(p.budget_cents)}` : null,
      p.owner_id ? `atsakingas ${names.get(p.owner_id) ?? p.owner_id}` : null,
      `darbai ${p.tasks_done}/${p.tasks_total} atlikti`,
      `suplanuota ${eurText(p.planned_cents)}, išleista ${eurText(p.actual_cents)}`,
    ].filter(Boolean);
    const ps = secs.filter((s) => s.project_id === p.id);
    const pc = lines.filter((c) => c.project_id === p.id);
    return [
      head.join(" | "),
      ...(ps.length > 0 ? [`  etapai: ${ps.map((s) => `[${s.id}] ${s.name}`).join(", ")}`] : []),
      ...(pc.length > 0
        ? [
            `  biudžeto eilutės: ${pc
              .map((c) => `[${c.id}] ${c.name}: planas ${eurText(c.planned_cents)}${c.is_estimate ? " (įvertis)" : ""}, faktas ${eurText(c.actual_cents)}${c.bank ? " (iš banko)" : ""}${c.task_id ? ` (darbas #${c.task_id})` : ""}`)
              .join("; ")}`,
          ]
        : []),
    ];
  });
}
