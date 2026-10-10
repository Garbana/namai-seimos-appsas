/**
 * Datos ir pakartojimai žmonių kalba. Terminai — kalendorinės datos ('2026-10-16')
 * Vilniaus laiku, todėl skaičiuojama be laiko juostų.
 */

const KADA = ['pirmadienį', 'antradienį', 'trečiadienį', 'ketvirtadienį', 'penktadienį', 'šeštadienį', 'sekmadienį']
const SAVAITES_DIENOS = [
  'pirmadienis',
  'antradienis',
  'trečiadienis',
  'ketvirtadienis',
  'penktadienis',
  'šeštadienis',
  'sekmadienis',
]
const DIENOMIS = [
  'pirmadieniais',
  'antradieniais',
  'trečiadieniais',
  'ketvirtadieniais',
  'penktadieniais',
  'šeštadieniais',
  'sekmadieniais',
]
export const DIENU_RAIDES = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Š', 'S']
const MENESIU = [
  'sausio',
  'vasario',
  'kovo',
  'balandžio',
  'gegužės',
  'birželio',
  'liepos',
  'rugpjūčio',
  'rugsėjo',
  'spalio',
  'lapkričio',
  'gruodžio',
]
const RRULE_DIENOS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** Šiandienos data Vilniuje. */
export const siandien = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vilnius',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const utc = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}

export const pridetiDienu = (d: string, n: number) => new Date(utc(d) + n * 86_400_000).toISOString().slice(0, 10)
export const dienuSkirtumas = (nuo: string, iki: string) => Math.round((utc(iki) - utc(nuo)) / 86_400_000)
/** 0 = pirmadienis … 6 = sekmadienis. */
export const savaitesDiena = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7

/** „spalio 16“; kitų metų — „2027 m. sausio 5“. */
export function data(d: string, siandiena: string): string {
  const [y, m, dd] = d.split('-').map(Number)
  return `${y !== Number(siandiena.slice(0, 4)) ? `${y} m. ` : ''}${MENESIU[m - 1]} ${dd}`
}

/** „penktadienis, spalio 16 d.“ — kai svarbu, kad klaidą pamatytum iškart. */
export function pilnaData(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${SAVAITES_DIENOS[savaitesDiena(d)]}, ${MENESIU[m - 1]} ${dd} d.`
}

/** Kaip pilnaData, bet kitų metų datai — su metais: „sekmadienis, 2027 m. rugpjūčio 1 d.“ */
export function pilnaDataSuMetais(d: string): string {
  const [y, m, dd] = d.split('-').map(Number)
  if (y === Number(siandien().slice(0, 4))) return pilnaData(d)
  return `${SAVAITES_DIENOS[savaitesDiena(d)]}, ${y} m. ${MENESIU[m - 1]} ${dd} d.`
}

/** Terminas sąraše: „šiandien“, „rytoj“, „penktadienį“, „spalio 23“, „vėluoja 3 d.“ */
export function terminas(due: string, siandiena: string): { tekstas: string; veluoja: boolean } {
  const kiek = dienuSkirtumas(siandiena, due)
  if (kiek < 0) return { tekstas: kiek === -1 ? 'vakar' : `vėluoja ${-kiek} d.`, veluoja: true }
  if (kiek === 0) return { tekstas: 'šiandien', veluoja: false }
  if (kiek === 1) return { tekstas: 'rytoj', veluoja: false }
  if (kiek < 7) return { tekstas: KADA[savaitesDiena(due)], veluoja: false }
  return { tekstas: data(due, siandiena), veluoja: false }
}

// ---------- Pakartojimai ----------

export type PakartojimoRusis = 'ne' | 'diena' | 'savaite' | 'menuo' | 'metai'

export type Pakartojimas = {
  rusis: PakartojimoRusis
  kasKiek: number
  /** 0 = pirmadienis … 6 = sekmadienis (savaitei). */
  dienos: number[]
  /** Mėnesio diena (mėnesiui); null — termino diena. */
  menesioDiena: number | null
}

const RUSYS: Record<string, PakartojimoRusis> = {
  DAILY: 'diena',
  WEEKLY: 'savaite',
  MONTHLY: 'menuo',
  YEARLY: 'metai',
}

export function skaitytiPakartojima(taisykle: string | null): Pakartojimas {
  const p: Pakartojimas = { rusis: 'ne', kasKiek: 1, dienos: [], menesioDiena: null }
  if (!taisykle) return p
  for (const dalis of taisykle.split(';')) {
    const [k, v] = dalis.split('=')
    if (k === 'FREQ') p.rusis = RUSYS[v] ?? 'ne'
    if (k === 'INTERVAL') p.kasKiek = Number(v) || 1
    if (k === 'BYDAY') p.dienos = v.split(',').map((d) => RRULE_DIENOS.indexOf(d)).filter((d) => d >= 0)
    if (k === 'BYMONTHDAY') p.menesioDiena = Number(v) || null
  }
  return p
}

export function rasytiPakartojima(p: Pakartojimas): string | null {
  if (p.rusis === 'ne') return null
  const freq = Object.entries(RUSYS).find(([, r]) => r === p.rusis)![0]
  const dalys = [`FREQ=${freq}`]
  if (p.kasKiek > 1) dalys.push(`INTERVAL=${p.kasKiek}`)
  if (p.rusis === 'savaite' && p.dienos.length > 0) {
    dalys.push(`BYDAY=${[...p.dienos].sort((a, b) => a - b).map((d) => RRULE_DIENOS[d]).join(',')}`)
  }
  if (p.rusis === 'menuo' && p.menesioDiena) dalys.push(`BYMONTHDAY=${p.menesioDiena}`)
  return dalys.join(';')
}

/** „kas savaitę šeštadieniais“, „kas 2 sav.“, „kas mėnesį 15 d.“, „kasmet“. */
export function pakartojimoTekstas(taisykle: string): string {
  const p = skaitytiPakartojima(taisykle)
  const n = p.kasKiek
  switch (p.rusis) {
    case 'diena':
      return n === 1 ? 'kas dieną' : `kas ${n} d.`
    case 'savaite': {
      const kada = p.dienos.map((d) => DIENOMIS[d]).join(', ')
      if (n === 1) return kada || 'kas savaitę'
      return `kas ${n} sav.${kada ? ` ${kada}` : ''}`
    }
    case 'menuo': {
      const diena = p.menesioDiena ? ` ${p.menesioDiena} d.` : ''
      return n === 1 ? `kas mėnesį${diena}` : `kas ${n} mėn.${diena}`
    }
    case 'metai':
      return n === 1 ? 'kasmet' : `kas ${n} m.`
    default:
      return ''
  }
}

/** „12,50“ → 1250; tuščia — null; neaiški — NaN (rodoma klaida). */
export function sumaCentais(tekstas: string): number | null {
  const t = tekstas.replace(/\s|€/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN
}

/** Dvi raidės, nes Jonas ir Ema abu prasideda „A“. */
export const inicialai = (vardas: string) => vardas.slice(0, 2)

// ---------- Priminimai ----------

/** Priminimų pasirinkimai užduoties lange (formatas — backend/src/darbai/priminimai.ts). */
export const PRIMINIMAI_SU_LAIKU = ['0m', '60m', '1d@18:00', '7d@18:00']
export const PRIMINIMAI_BE_LAIKO = ['0d@09:00', '1d@18:00', '7d@18:00']

/** Ar priminimas įmanomas: „prieš N min.“ — tik užduočiai su laiku. */
export const priminimasTinka = (spec: string, suLaiku: boolean) => suLaiku || !spec.endsWith('m')

/** „Laiku“, „Prieš 1 val.“, „Dieną prieš 18:00“, „Tą dieną 9:00“, „Prieš savaitę 18:00“. */
export function priminimoTekstas(spec: string): string {
  const min = /^(\d+)m$/.exec(spec)
  if (min) {
    const n = Number(min[1])
    if (n === 0) return 'Laiku'
    return n % 60 === 0 ? `Prieš ${n / 60} val.` : `Prieš ${n} min.`
  }
  const d = /^(\d+)d@(\d\d):(\d\d)$/.exec(spec)
  if (!d) return spec
  const kada = `${Number(d[2])}:${d[3]}`
  const n = Number(d[1])
  if (n === 0) return `Tą dieną ${kada}`
  if (n === 1) return `Dieną prieš ${kada}`
  if (n === 7) return `Prieš savaitę ${kada}`
  return `Prieš ${n} d. ${kada}`
}
