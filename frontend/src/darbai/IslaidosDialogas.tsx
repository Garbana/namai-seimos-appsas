import { useState } from 'react'
import { darbai, type Islaida, type Uzduotis } from './api'
import { sumaCentais } from './datos'
import { eurai } from './projektuTvarka'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko išsaugoti.')

/** Biudžeto eilutė: pavadinimas, planas, faktas ir (nebūtina) darbas, kurio kaina tai yra. */
export default function IslaidosDialogas({
  projectId,
  islaida: c,
  darbai: uzduotys,
  onUzdaryti,
  onPakeista,
}: {
  projectId: number
  /** null — nauja eilutė. */
  islaida: Islaida | null
  darbai: Uzduotis[]
  onUzdaryti: () => void
  onPakeista: () => void
}) {
  const [pavadinimas, setPavadinimas] = useState(c?.name ?? '')
  const [planas, setPlanas] = useState(eurai(c?.planned_cents ?? null))
  // Kai faktas iš banko — čia ranka įvesta suma (grįš, jei operacijas atsiesi).
  const isBanko = (c?.bank_links ?? 0) > 0
  const [faktas, setFaktas] = useState(eurai((isBanko ? c?.manual_actual_cents : c?.actual_cents) ?? null))
  const [darbas, setDarbas] = useState<number | null>(c?.task_id ?? null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [saugoma, setSaugoma] = useState(false)

  async function veiksmas(darbasFn: () => Promise<unknown>) {
    setSaugoma(true)
    setKlaida(null)
    try {
      await darbasFn()
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSaugoma(false)
    }
  }

  function issaugoti() {
    const p = sumaCentais(planas)
    const f = sumaCentais(faktas)
    if (!pavadinimas.trim()) return setKlaida('Eilutei reikia pavadinimo.')
    if (Number.isNaN(p) || Number.isNaN(f)) return setKlaida('Netinkama suma — rašyk, pvz., 65 arba 12,50.')
    const laukai = { name: pavadinimas, plannedCents: p, actualCents: f, taskId: darbas }
    void veiksmas(() => (c ? darbai.keistiIslaida(c.id, laukai) : darbai.sukurtiIslaida(projectId, laukai)))
  }

  return (
    <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
      <div className="modal uzd-dialogas" role="dialog" aria-label="Biudžeto eilutė" onClick={(e) => e.stopPropagation()}>
        <h3>{c ? 'Biudžeto eilutė' : 'Nauja biudžeto eilutė'}</h3>
        <label>
          Pavadinimas
          <input value={pavadinimas} onChange={(e) => setPavadinimas(e.target.value)} placeholder="pvz., Tortas" maxLength={100} autoFocus={!c} />
        </label>
        <div className="uzd-du-laukai">
          <label>
            Planas, €
            <input inputMode="decimal" value={planas} onChange={(e) => setPlanas(e.target.value)} placeholder="kiek planuojat" />
          </label>
          <label>
            {isBanko ? 'Faktas ranka, €' : 'Faktas, €'}
            <input inputMode="decimal" value={faktas} onChange={(e) => setFaktas(e.target.value)} placeholder="kiek išleista" />
          </label>
        </div>
        {isBanko && (
          <p className="paaiskinimas">
            Faktas imamas iš susietų banko operacijų ({c!.bank_links}): {c!.actual_cents !== null ? eurai(c!.actual_cents) : '0'} €. Ranka įvesta suma
            bus naudojama, jei operacijas atsiesite.
          </p>
        )}
        {c?.is_estimate === 1 && <p className="paaiskinimas">Plano suma — įvertis. Pataisius ji taps jūsų suma.</p>}
        <label>
          Darbas (nebūtina)
          <select value={darbas ?? ''} onChange={(e) => setDarbas(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— nesusieta —</option>
            {uzduotys
              .filter((u) => u.parent_id === null)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.title}
                </option>
              ))}
          </select>
        </label>
        <p className="paaiskinimas">Susietą darbą pažymėjus atliktu su suma (pvz., katinukui „tortą užsakiau už 65“), ji įrašoma į faktą.</p>
        {klaida && <p className="error">{klaida}</p>}
        <div className="modal-mygtukai">
          {c && (
            <button
              className="ghost uzd-trinti"
              disabled={saugoma}
              onClick={() => confirm(`Ištrinti eilutę „${c.name}“?`) && void veiksmas(() => darbai.istrintiIslaida(c.id))}
            >
              Ištrinti
            </button>
          )}
          <button className="ghost" onClick={onUzdaryti}>
            Atšaukti
          </button>
          <button onClick={issaugoti} disabled={saugoma}>
            {saugoma ? 'Saugoma…' : 'Išsaugoti'}
          </button>
        </div>
      </div>
    </div>
  )
}
