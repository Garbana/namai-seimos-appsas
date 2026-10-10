import type { AtsargineKopija, KopijuBusena } from './api'

export type KopijuDuomenys = { items: AtsargineKopija[]; state: KopijuBusena }

/** Po kiek dienų be parsisiuntimo pažymėti, kad laikas parsisiųsti į kompiuterį. */
export const PARSISIUNTIMO_DIENOS = 30

/** Automatinė kopija daroma kas savaitę; jei naujausia senesnė — laikmatis neveikia. */
const AUTOMATINES_DIENOS = 8

export const dienosNuo = (iso: string, dabar = Date.now()) =>
  Math.floor((dabar - Date.parse(iso)) / 86_400_000)

/**
 * Kas negerai su kopijomis — tada ir Pradžioje rodomas įspėjimas. Kol nėra nė vienos
 * automatinės kopijos, neįspėjama: pirmoji daroma artimiausią sekmadienį.
 */
export function kopijuProblema({ items, state }: KopijuDuomenys, dabar = Date.now()): string | null {
  if (state.lastError) return `Paskutinė kopija nepavyko: ${state.lastError}`

  const naujausia = items.find((k) => k.kind === 'auto')
  if (naujausia && dienosNuo(naujausia.createdAt, dabar) > AUTOMATINES_DIENOS) {
    return `Automatinė kopija nedaryta jau ${dienosNuo(naujausia.createdAt, dabar)} d.`
  }
  return null
}
