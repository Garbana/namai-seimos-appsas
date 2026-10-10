import { useState } from 'react'
import { darbai, type Sritis, type Uzduotis } from './api'
import { DIENU_RAIDES, pakartojimoTekstas, pilnaData, pridetiDienu, rasytiPakartojima, savaitesDiena, siandien, skaitytiPakartojima } from './datos'
import { useNariai } from './nariai'

type Props = {
  /** null — nauja ruoša. */
  ruosa: Uzduotis | null
  sritys: Sritis[]
  onUzdaryti: () => void
  onPakeista: () => void
}

type Kas = 'vienas' | 'pakaitomis' | 'betkas'
type Vienetas = 'diena' | 'savaite' | 'menuo'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/** Artimiausia diena nuo šiandien, kuri yra viena iš pasirinktų savaitės dienų. */
function artimiausia(nuo: string, dienos: number[]): string {
  if (dienos.length === 0) return nuo
  for (let i = 0; i < 7; i++) {
    const d = pridetiDienu(nuo, i)
    if (dienos.includes(savaitesDiena(d))) return d
  }
  return nuo
}

/**
 * Ruošos langas: kas kiek laiko (pagal kalendorių ar nuo atlikimo), kas daro (vienas,
 * pakaitomis ar bet kas), kada kitą kartą. Saugoma kaip pasikartojanti užduotis su žyme „ruoša“.
 */
export default function RuososDialogas({ ruosa: r, sritys, onUzdaryti, onPakeista }: Props) {
  const { nariai, as } = useNariai()
  const pradinis = skaitytiPakartojima(r?.recurrence ?? 'FREQ=WEEKLY')
  const eile0 = r?.rotation_members ? (JSON.parse(r.rotation_members) as number[]) : []

  const [pavadinimas, setPavadinimas] = useState(r?.title ?? '')
  const [kasKiek, setKasKiek] = useState(String(pradinis.kasKiek))
  const [vienetas, setVienetas] = useState<Vienetas>(pradinis.rusis === 'diena' || pradinis.rusis === 'menuo' ? pradinis.rusis : 'savaite')
  const [dienos, setDienos] = useState<number[]>(pradinis.dienos)
  const [nuoAtlikimo, setNuoAtlikimo] = useState(Boolean(r?.repeat_after_done))
  const [kas, setKas] = useState<Kas>(eile0.length > 1 ? 'pakaitomis' : r ? (r.assignee_id === null ? 'betkas' : 'vienas') : 'vienas')
  const [vienas, setVienas] = useState<number | null>(r?.assignee_id ?? as)
  const [eile, setEile] = useState<number[]>(eile0.length > 1 ? eile0 : nariai.filter((n) => n.uses_app).map((n) => n.id))
  const [dabar, setDabar] = useState<number | null>(eile0.length > 1 ? r!.assignee_id : (as ?? null))
  const [kitas, setKitas] = useState(r?.due_date ?? siandien())
  const [kitasParinktas, setKitasParinktas] = useState(Boolean(r))
  const namai = sritys.find((s) => s.name === 'Namai')?.id ?? null
  const [sritis, setSritis] = useState<number | null>(r ? r.area_id : namai)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [saugoma, setSaugoma] = useState(false)

  const n = Math.max(1, Math.min(365, Number(kasKiek) || 1))
  const taisykle = rasytiPakartojima({ rusis: vienetas, kasKiek: n, dienos: vienetas === 'savaite' && !nuoAtlikimo ? dienos : [], menesioDiena: null })!
  const dabartinis = eile.includes(dabar ?? -1) ? dabar : (eile[0] ?? null)

  function keistiDienas(naujos: number[]) {
    setDienos(naujos)
    // Kol žmogus pats nepasirinko datos — pirmas kartas pagal pasirinktas dienas.
    if (!kitasParinktas) setKitas(artimiausia(siandien(), naujos))
  }

  function keistiEile(id: number) {
    setEile((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function issaugoti() {
    if (!pavadinimas.trim()) return setKlaida('Įrašyk, ką reikia daryti.')
    if (kas === 'pakaitomis' && eile.length < 2) return setKlaida('Pakaitomis — pasirink bent du žmones.')
    if (!kitas) return setKlaida('Nurodyk, kada kitą kartą.')
    setSaugoma(true)
    setKlaida(null)
    try {
      const laukai = {
        title: pavadinimas.trim(),
        chore: true,
        recurrence: taisykle,
        repeatAfterDone: nuoAtlikimo,
        dueDate: kitas,
        areaId: sritis,
        rotationMembers: kas === 'pakaitomis' ? eile : null,
        assigneeId: kas === 'pakaitomis' ? dabartinis : kas === 'vienas' ? vienas : null,
      }
      if (r) await darbai.keisti(r.id, laukai, as)
      else await darbai.sukurti(laukai, as)
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSaugoma(false)
    }
  }

  async function istrinti() {
    if (!r || !confirm(`Ištrinti „${r.title}“? 30 dienų ją bus galima atkurti iš šiukšliadėžės.`)) return
    try {
      await darbai.istrinti(r.id)
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  const vardas = (id: number | null) => nariai.find((x) => x.id === id)?.name ?? '—'

  return (
    <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
      <div className="modal uzd-dialogas" role="dialog" aria-label={r ? 'Ruoša' : 'Nauja ruoša'} onClick={(e) => e.stopPropagation()}>
        <h3>{r ? 'Ruoša' : 'Nauja ruoša'}</h3>

        <label>
          Ką daryti
          <input value={pavadinimas} onChange={(e) => setPavadinimas(e.target.value)} placeholder="pvz., Išvalyti vonią" autoFocus={!r} maxLength={300} />
        </label>

        <div className="ruosa-dazniai">
          <span className="paaiskinimas">Kas</span>
          <input type="number" inputMode="numeric" min={1} max={365} value={kasKiek} onChange={(e) => setKasKiek(e.target.value)} aria-label="Kas kiek" />
          <div className="perjungiklis" role="group" aria-label="Vienetas">
            {(
              [
                ['diena', 'd.'],
                ['savaite', 'sav.'],
                ['menuo', 'mėn.'],
              ] as const
            ).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={vienetas === v} onClick={() => setVienetas(v)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {vienetas === 'savaite' && !nuoAtlikimo && (
          <div className="perjungiklis uzd-dienos" role="group" aria-label="Savaitės dienos">
            {DIENU_RAIDES.map((raide, i) => (
              <button
                key={raide}
                type="button"
                aria-pressed={dienos.includes(i)}
                onClick={() => keistiDienas(dienos.includes(i) ? dienos.filter((d) => d !== i) : [...dienos, i])}
              >
                {raide}
              </button>
            ))}
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={nuoAtlikimo} onChange={(e) => setNuoAtlikimo(e.target.checked)} />
          Skaičiuoti nuo paskutinio karto (pvz., filtras, kraikas)
        </label>
        <p className="paaiskinimas">
          {pakartojimoTekstas(taisykle)}
          {nuoAtlikimo ? ' nuo paskutinio karto — padarius vėliau, kitas kartas pasislenka kartu' : ' pagal kalendorių'}
        </p>

        <div className="perjungiklis" role="group" aria-label="Kas daro">
          {(
            [
              ['vienas', 'Vienas žmogus'],
              ['pakaitomis', 'Pakaitomis'],
              ['betkas', 'Bet kas'],
            ] as const
          ).map(([v, t]) => (
            <button key={v} type="button" aria-pressed={kas === v} onClick={() => setKas(v)}>
              {t}
            </button>
          ))}
        </div>

        {kas === 'vienas' && (
          <div className="ruosa-nariai">
            {nariai.map((x) => (
              <button key={x.id} type="button" className={x.id === vienas ? undefined : 'ghost'} aria-pressed={x.id === vienas} onClick={() => setVienas(x.id)}>
                <span className="uzd-narys" style={{ background: x.color }} aria-hidden="true">
                  {x.name.slice(0, 2)}
                </span>
                {x.name}
              </button>
            ))}
          </div>
        )}

        {kas === 'pakaitomis' && (
          <>
            <div className="ruosa-nariai">
              {nariai.map((x) => (
                <button key={x.id} type="button" className={eile.includes(x.id) ? undefined : 'ghost'} aria-pressed={eile.includes(x.id)} onClick={() => keistiEile(x.id)}>
                  <span className="uzd-narys" style={{ background: x.color }} aria-hidden="true">
                    {x.name.slice(0, 2)}
                  </span>
                  {x.name}
                </button>
              ))}
            </div>
            {eile.length >= 2 && (
              <label>
                Eilė: {eile.map(vardas).join(' → ')}. Dabar daro
                <select value={dabartinis ?? ''} onChange={(e) => setDabar(Number(e.target.value))}>
                  {eile.map((id) => (
                    <option key={id} value={id}>
                      {vardas(id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {kas === 'betkas' && <p className="paaiskinimas">Padaro, kas tuo metu gali.</p>}

        <div className="uzd-du-laukai">
          <label>
            Kitą kartą
            <input
              type="date"
              value={kitas}
              onChange={(e) => {
                setKitas(e.target.value)
                setKitasParinktas(true)
              }}
            />
          </label>
          <label>
            Sritis
            <select value={sritis ?? ''} onChange={(e) => setSritis(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— be srities —</option>
              {sritys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {kitas && <p className="paaiskinimas">{pilnaData(kitas)}</p>}

        {klaida && <p className="error">{klaida}</p>}

        <div className="modal-mygtukai">
          {r && (
            <button className="ghost uzd-trinti" onClick={() => void istrinti()}>
              Ištrinti
            </button>
          )}
          <button className="ghost" onClick={onUzdaryti}>
            Atšaukti
          </button>
          <button onClick={() => void issaugoti()} disabled={saugoma}>
            {saugoma ? 'Saugoma…' : 'Išsaugoti'}
          </button>
        </div>
      </div>
    </div>
  )
}
