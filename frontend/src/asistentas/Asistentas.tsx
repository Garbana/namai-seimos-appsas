import { useCallback, useEffect, useRef, useState } from 'react'
import { darbai, type Sritis } from '../darbai/api'
import { useNariai } from '../darbai/nariai'
import UzduotiesDialogas from '../darbai/UzduotiesDialogas'
import { pastabos } from '../pastabos/api'
import { asistentas, type Irasas, type Veiksmas } from './api'
import { useBalsas } from './balsas'
import Katinukas from './Katinukas'
import VeiksmoKortele from './VeiksmoKortele'

type Zinute = { raktas: string; zmogaus: string } | { raktas: string; irasoId: number } | { raktas: string; klaida: string }

type Props = {
  /** Kaip atidarytas: tekstu ar iškart klausantis (trumpinys „Pasakyk“). */
  pradzia: 'tekstu' | 'balsu'
  /** Kuriame ekrane atidarytas — pastaboms (asistentas jį prideda pats). */
  ekranas: string | null
  onUzdaryti: () => void
  /** Kas nors pakeista — ekranai po langu persikrauna. */
  onPakeista: () => void
}

const PAVYZDZIAI = [
  'Kitą penktadienį pas dantistę 15 val.',
  'Nupirkt pieno, duonos ir kačių maisto',
  'Išnešiau šiukšles',
  'Kas mums šiandien?',
  'Kiek išleidom praėjusį mėnesį?',
  'Užfiksuok klaidą: …',
]

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/** Asistento langas (išsiskleidžia iš katinuko): pokalbis, veiksmų kortelės, tekstas ar balsas. */
export default function Asistentas({ pradzia, ekranas, onUzdaryti, onPakeista }: Props) {
  const { as } = useNariai()
  const [zinutes, setZinutes] = useState<Zinute[]>([])
  const [irasai, setIrasai] = useState<Record<number, Irasas>>({})
  const [tekstas, setTekstas] = useState('')
  const [laukia, setLaukia] = useState(false)
  // Didelis planas (projektas) ruošiamas ilgiau — po kelių sekundžių paaiškinam.
  const [ilgai, setIlgai] = useState(false)
  const [dirbama, setDirbama] = useState(false)
  const [pokalbisId, setPokalbisId] = useState<number | null>(null)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [taisoma, setTaisoma] = useState<{ irasas: Irasas; v: Veiksmas } | null>(null)
  // „👎 Netinka“: kurio atsakymo forma atidaryta, jos tekstas ir jau pažymėti atsakymai.
  const [netinka, setNetinka] = useState<number | null>(null)
  const [netinkaTekstas, setNetinkaTekstas] = useState('')
  const [pazymeti, setPazymeti] = useState<number[]>([])
  const pokalbis = useRef<HTMLDivElement>(null)
  const ivestis = useRef<HTMLTextAreaElement>(null)
  const raktas = useRef(0)
  const naujasRaktas = () => `z${++raktas.current}`

  const atnaujinti = useCallback((...nauji: Irasas[]) => {
    setIrasai((prev) => ({ ...prev, ...Object.fromEntries(nauji.map((i) => [i.id, i])) }))
  }, [])

  const siusti = useCallback(
    async (t: string) => {
      const zinute = t.trim()
      if (!zinute) return
      setZinutes((z) => [...z, { raktas: naujasRaktas(), zmogaus: zinute }])
      setTekstas('')
      setLaukia(true)
      setIlgai(false)
      const laikmatis = window.setTimeout(() => setIlgai(true), 6000)
      try {
        const r = await asistentas.klausti(zinute, as, pokalbisId, ekranas)
        setPokalbisId(r.pokalbisId)
        atnaujinti(...(r.pokalbis ?? []), r)
        setZinutes((z) => [...z, { raktas: naujasRaktas(), irasoId: r.id }])
        if ((r.pokalbis ?? [r]).some((i) => i.veiksmai.some((v) => v.busena === 'ivykdyta'))) onPakeista()
      } catch (err) {
        setZinutes((z) => [...z, { raktas: naujasRaktas(), klaida: klaidosTekstas(err) }])
      } finally {
        window.clearTimeout(laikmatis)
        setLaukia(false)
      }
    },
    [as, pokalbisId, ekranas, atnaujinti, onPakeista]
  )

  const balsas = useBalsas((t) => void siusti(t))
  const { pradeti, baigti, klauso } = balsas

  useEffect(() => {
    darbai
      .sritys()
      .then(setSritys)
      .catch(() => setSritys([]))
    if (pradzia === 'tekstu') ivestis.current?.focus()
    else pradeti(false)
  }, [pradzia, pradeti])

  useEffect(() => {
    pokalbis.current?.scrollTo({ top: pokalbis.current.scrollHeight, behavior: 'smooth' })
  }, [zinutes, irasai, laukia, balsas.girdima])

  async function veiksmas(darbas: () => Promise<Irasas>, pakeista: boolean) {
    setDirbama(true)
    try {
      atnaujinti(await darbas())
      if (pakeista) onPakeista()
    } catch (err) {
      setZinutes((z) => [...z, { raktas: naujasRaktas(), klaida: klaidosTekstas(err) }])
    } finally {
      setDirbama(false)
    }
  }

  async function pazymetiNetinka(irasas: Irasas) {
    setDirbama(true)
    try {
      await pastabos.sukurti({ kind: 'asistentas', text: netinkaTekstas, screen: ekranas, aiRequestId: irasas.id }, as)
      setPazymeti((p) => [...p, irasas.id])
      setNetinka(null)
      setNetinkaTekstas('')
    } catch (err) {
      setZinutes((z) => [...z, { raktas: naujasRaktas(), klaida: klaidosTekstas(err) }])
    } finally {
      setDirbama(false)
    }
  }

  const asistentoZinute = (irasas: Irasas) => {
    const laukiantys = irasas.veiksmai.filter((v) => v.busena === 'laukia')
    return (
      <div className="asistento-zinute">
        <span className="asistento-avataras">
          <Katinukas dydis={30} />
        </span>
        {irasas.atsakymas && <p className="burbulas asistento">{irasas.atsakymas}</p>}
        {irasas.klaida && <p className="burbulas klaidos">{irasas.klaida}</p>}
        {!irasas.atsakymas && !irasas.klaida && irasas.veiksmai.length === 0 && <p className="burbulas asistento">Supratau.</p>}
        {irasas.veiksmai.map((v) => (
          <VeiksmoKortele
            key={v.id}
            v={v}
            sritys={sritys}
            dirbama={dirbama}
            onPatvirtinti={() => void veiksmas(() => asistentas.patvirtinti(irasas.id, as, [v.id]), true)}
            onTaisyti={() => setTaisoma({ irasas, v })}
            onAtmesti={() => void veiksmas(() => asistentas.atmesti(irasas.id, v.id), false)}
            onAtsaukti={() => void veiksmas(() => asistentas.atsaukti(irasas.id, v.id, as), true)}
          />
        ))}
        {laukiantys.length > 1 && (
          <button className="asistento-visi" disabled={dirbama} onClick={() => void veiksmas(() => asistentas.patvirtinti(irasas.id, as), true)}>
            Patvirtinti visus ({laukiantys.length})
          </button>
        )}
        {pazymeti.includes(irasas.id) ? (
          <span className="asistento-pazymeta">✓ Pažymėta — Claude pažiūrės</span>
        ) : netinka === irasas.id ? (
          <div className="asistento-netinka">
            <textarea
              value={netinkaTekstas}
              onChange={(e) => setNetinkaTekstas(e.target.value)}
              placeholder="Kas negerai? Kaip turėjo būti? (nebūtina)"
              rows={2}
              maxLength={4000}
              autoFocus
            />
            <div className="veiksmas-mygtukai">
              <button className="small" disabled={dirbama} onClick={() => void pazymetiNetinka(irasas)}>
                Išsaugoti
              </button>
              <button className="ghost small" onClick={() => setNetinka(null)}>
                Atšaukti
              </button>
            </div>
          </div>
        ) : (
          <button className="asistento-netinka-mygtukas" onClick={() => setNetinka(irasas.id)}>
            👎 Netinka
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="asistento-fonas" role="presentation">
      <div className="asistentas" role="dialog" aria-label="Asistentas">
        <header className="asistento-virsus">
          <span className="asistento-vardas">
            <Katinukas dydis={34} />
            <b>Asistentas</b>
          </span>
          <button className="ghost small" onClick={onUzdaryti} aria-label="Uždaryti">
            ×
          </button>
        </header>

        <div className="asistento-pokalbis" ref={pokalbis}>
          {zinutes.length === 0 && !klauso && (
            <div className="asistento-pradzia">
              <Katinukas dydis={96} mojuoja />
              <p>
                <b>Labas!</b> Pasakyk ar parašyk, ką reikia padaryti — sutvarkysiu. Naujas užduotis prieš įrašant
                parodysiu.
              </p>
              <div className="asistento-pavyzdziai">
                {PAVYZDZIAI.map((p) => (
                  <button
                    key={p}
                    className="ghost small"
                    onClick={() => {
                      setTekstas(p)
                      ivestis.current?.focus()
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {zinutes.map((z) =>
            'zmogaus' in z ? (
              <p key={z.raktas} className="burbulas zmogaus">
                {z.zmogaus}
              </p>
            ) : 'klaida' in z ? (
              <p key={z.raktas} className="burbulas klaidos">
                {z.klaida}
              </p>
            ) : irasai[z.irasoId] ? (
              <div key={z.raktas}>{asistentoZinute(irasai[z.irasoId])}</div>
            ) : null
          )}

          {klauso && (
            <p className="burbulas zmogaus klausosi">
              {balsas.girdima || 'Klausausi…'}
              <span className="klausosi-taskas" aria-hidden="true" />
            </p>
          )}
          {laukia && <p className="burbulas asistento laukia">{ilgai ? 'Dar galvoju — didesnis planas užtrunka kelias sekundes…' : 'Galvoju…'}</p>}
          {balsas.klaida && <p className="burbulas klaidos">{balsas.klaida}</p>}
        </div>

        <form
          className="asistento-ivestis"
          onSubmit={(e) => {
            e.preventDefault()
            void siusti(tekstas)
          }}
        >
          <textarea
            ref={ivestis}
            value={tekstas}
            onChange={(e) => setTekstas(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void siusti(tekstas)
              }
            }}
            placeholder="Parašyk ar pasakyk…"
            rows={1}
            maxLength={2000}
            enterKeyHint="send"
            aria-label="Žinutė asistentui"
          />
          {balsas.palaikomas && (
            <button
              type="button"
              className={`asistento-mikrofonas${klauso ? ' klauso' : ''}`}
              onClick={() => (klauso ? baigti() : pradeti(false))}
              aria-label={klauso ? 'Baigti klausytis' : 'Kalbėti'}
              aria-pressed={klauso}
            >
              {klauso ? '■' : '🎤'}
            </button>
          )}
          <button type="submit" disabled={!tekstas.trim() || laukia} aria-label="Siųsti">
            ↑
          </button>
        </form>
      </div>

      {taisoma && taisoma.v.laukai && (
        <UzduotiesDialogas
          uzduotis={null}
          visos={[]}
          sritys={sritys}
          juodrastis={{ ...taisoma.v.laukai, pouzduotys: taisoma.v.pouzduotys }}
          onIssaugoti={async (laukai, pouzduotys) => {
            const r = await asistentas.patvirtinti(taisoma.irasas.id, as, [taisoma.v.id], {
              [taisoma.v.id]: { laukai, pouzduotys },
            })
            atnaujinti(r)
            const v = r.veiksmai.find((x) => x.id === taisoma.v.id)
            if (v?.busena === 'klaida') throw new Error(v.klaida ?? 'Nepavyko įrašyti.')
          }}
          onPakeista={onPakeista}
          onUzdaryti={() => setTaisoma(null)}
        />
      )}
    </div>
  )
}
