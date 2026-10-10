/**
 * Balsas → tekstas per Chrome įtaisytą atpažinimą (Web Speech API, lietuviškai). Nemokama,
 * be raktų; garsą atpažįsta Google, pas mus jis nesaugomas. Kur nepalaikoma — lieka
 * klaviatūros (Gboard) diktavimas.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Rezultatai = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>

interface Atpazinimas {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: Rezultatai }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type Konstruktorius = new () => Atpazinimas

const konstruktorius = (): Konstruktorius | null => {
  const w = window as unknown as { SpeechRecognition?: Konstruktorius; webkitSpeechRecognition?: Konstruktorius }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const balsasPalaikomas = () => typeof window !== 'undefined' && konstruktorius() !== null

const KLAIDOS: Record<string, string> = {
  'not-allowed': 'Mikrofonas neleidžiamas — leisk jį naršyklės ar telefono nustatymuose.',
  'service-not-allowed': 'Balso atpažinimas šioje naršyklėje neleidžiamas.',
  'no-speech': 'Nieko neišgirdau — pabandyk dar kartą.',
  'audio-capture': 'Nerastas mikrofonas.',
  network: 'Balsui atpažinti reikia interneto.',
}

/**
 * `ilgai` — klausosi, kol paleidžiamas mygtukas (palaikyk ir kalbėk); kitaip — iki pauzės.
 * Baigus, išgirstas tekstas atiduodamas `onTekstas`.
 */
export function useBalsas(onTekstas: (tekstas: string) => void) {
  const [klauso, setKlauso] = useState(false)
  const [girdima, setGirdima] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const atpazinimas = useRef<Atpazinimas | null>(null)
  const callback = useRef(onTekstas)
  useEffect(() => {
    callback.current = onTekstas
  }, [onTekstas])

  const pradeti = useCallback((ilgai: boolean) => {
    const K = konstruktorius()
    if (!K) {
      setKlaida('Ši naršyklė balso nepalaiko — diktuok klaviatūros mikrofonu.')
      return
    }
    atpazinimas.current?.abort()
    const r = new K()
    r.lang = 'lt-LT'
    r.continuous = ilgai
    r.interimResults = true
    let galutinis = ''
    let tarpinis = ''
    r.onresult = (e) => {
      tarpinis = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) galutinis += e.results[i][0].transcript
        else tarpinis += e.results[i][0].transcript
      }
      setGirdima(`${galutinis}${tarpinis}`.trim())
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') setKlaida(KLAIDOS[e.error] ?? `Balso klaida: ${e.error}`)
    }
    r.onend = () => {
      atpazinimas.current = null
      setKlauso(false)
      setGirdima('')
      const tekstas = `${galutinis}${tarpinis}`.trim()
      if (tekstas) callback.current(tekstas)
    }
    setKlaida(null)
    setGirdima('')
    try {
      r.start()
      atpazinimas.current = r
      setKlauso(true)
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko įjungti mikrofono.')
    }
  }, [])

  const baigti = useCallback(() => atpazinimas.current?.stop(), [])

  useEffect(() => () => atpazinimas.current?.abort(), [])

  return { klauso, girdima, klaida, pradeti, baigti, palaikomas: balsasPalaikomas() }
}
