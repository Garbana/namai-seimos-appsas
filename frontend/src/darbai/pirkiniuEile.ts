import { darbai, type Preke, type Sarasas } from './api'

/**
 * Pirkiniai be ryšio. Parduotuvėje ryšys būna prastas, todėl paskutinis sąrašas laikomas
 * telefone, o pažymėjimai, pridėjimai ir trynimai be ryšio sudedami į eilę ir išsiunčiami
 * atsiradus ryšiui. Laikinos (dar neišsiųstos) prekės turi neigiamą id.
 */

export type PirkiniuDuomenys = {
  lists: Sarasas[]
  items: Preke[]
  suggestions: { list_id: number; name: string; every_days: number; last_bought: string }[]
  sections: string[]
}

export type EilesVeiksmas =
  | { tipas: 'prideti'; id: number; listId: number; name: string; quantity: string | null }
  | { tipas: 'pazymeti'; id: number; checked: boolean }
  | { tipas: 'istrinti'; id: number }

const KESAS = 'pirkiniu-kesas'
const EILE = 'pirkiniu-eile'

function skaityti<T>(raktas: string, numatyta: T): T {
  try {
    const v = localStorage.getItem(raktas)
    return v ? (JSON.parse(v) as T) : numatyta
  } catch {
    return numatyta
  }
}

function rasyti(raktas: string, reiksme: unknown) {
  try {
    localStorage.setItem(raktas, JSON.stringify(reiksme))
  } catch {
    // Pilna ar uždrausta saugykla — be ryšio tiesiog neveiks.
  }
}

export const skaitytiKesa = () => skaityti<PirkiniuDuomenys | null>(KESAS, null)
export const rasytiKesa = (d: PirkiniuDuomenys) => rasyti(KESAS, d)
export const eile = () => skaityti<EilesVeiksmas[]>(EILE, [])
export const iEile = (v: EilesVeiksmas) => rasyti(EILE, [...eile(), v])

/** Ryšio (ne serverio) klaida: fetch nepasiekė serverio. */
export const rysioKlaida = (err: unknown) => err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)

/**
 * Parduotuvėje ryšys dažnai ne dingsta, o „kabo“ — po tiek laiko laikom, kad ryšio nėra.
 * Pakartoti saugu: pažymėjimas, pridėjimas ir trynimas serveryje nesidubliuoja.
 */
export const LAUKTI_MS = 8000

export function suLaiku<T>(pazadas: Promise<T>, ms = LAUKTI_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const laikmatis = setTimeout(() => reject(new TypeError('Ryšys neatsako')), ms)
    pazadas.then(
      (v) => {
        clearTimeout(laikmatis)
        resolve(v)
      },
      (e) => {
        clearTimeout(laikmatis)
        reject(e)
      }
    )
  })
}

let siunciama: Promise<void> | null = null

/**
 * Išsiunčia eilę iš eilės. Be ryšio — meta klaidą (eilė lieka); serverio atmestas veiksmas
 * (pvz., prekę kitas jau ištrynė) išmetamas, kad neužkimštų eilės.
 */
export function siustiEile(memberId: number | null): Promise<void> {
  if (siunciama) return siunciama
  siunciama = (async () => {
    // Eilė skaitoma kaskart iš naujo — kol siunčiama, ekranas gali pridėti naujų veiksmų.
    for (let v = eile()[0]; v; v = eile()[0]) {
      let tikrasId: number | null = null
      try {
        if (v.tipas === 'prideti') {
          tikrasId = (await suLaiku(darbai.pridetiPreke({ listId: v.listId, name: v.name, quantity: v.quantity }, memberId))).id
        } else if (v.id > 0) {
          if (v.tipas === 'pazymeti') await suLaiku(darbai.keistiPreke(v.id, { checked: v.checked }, memberId))
          else await suLaiku(darbai.istrintiPreke(v.id))
        }
      } catch (err) {
        if (rysioKlaida(err)) throw err
      }
      const laikinas = v.id
      // Kiti eilės veiksmai su ta laikina preke — jau su tikru id.
      rasyti(
        EILE,
        eile()
          .slice(1)
          .map((x) => (tikrasId !== null && x.id === laikinas ? { ...x, id: tikrasId } : x))
      )
    }
  })().finally(() => {
    siunciama = null
  })
  return siunciama
}

/** Ištrinta dar neišsiųsta prekė — iš eilės išmetami visi jos veiksmai (serveriui jos nereikia). */
export const ismestiLaikina = (id: number) => rasyti(EILE, eile().filter((v) => v.id !== id))
