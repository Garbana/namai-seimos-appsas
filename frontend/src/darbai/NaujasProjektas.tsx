import { useEffect, useState } from 'react'
import { darbai, type ProjektoDuomenys, type Sablonas, type Sritis } from './api'
import { pilnaData, sumaCentais } from './datos'
import { useNariai } from './nariai'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko sukurti.')

/** Naujas projektas: iš šablono (etapai, darbai su terminais, biudžetas) arba tuščias. */
export default function NaujasProjektas({ onUzdaryti, onSukurta }: { onUzdaryti: () => void; onSukurta: (d: ProjektoDuomenys) => void }) {
  const { nariai, as } = useNariai()
  const [sablonai, setSablonai] = useState<Sablonas[]>([])
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [sablonas, setSablonas] = useState<string | null>(null)
  const [pavadinimas, setPavadinimas] = useState('')
  const [data, setData] = useState('')
  const [biudzetas, setBiudzetas] = useState('')
  const [atsakingas, setAtsakingas] = useState<number | null>(as)
  const [sritis, setSritis] = useState<number | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [saugoma, setSaugoma] = useState(false)

  useEffect(() => {
    darbai
      .sablonai()
      .then(setSablonai)
      .catch(() => setSablonai([]))
    darbai
      .sritys()
      .then(setSritys)
      .catch(() => setSritys([]))
  }, [])

  const pasirinktas = sablonai.find((s) => s.code === sablonas)

  async function sukurti() {
    const centai = sumaCentais(biudzetas)
    if (Number.isNaN(centai)) return setKlaida('Netinkamas biudžetas — rašyk, pvz., 500.')
    const title = pavadinimas.trim() || pasirinktas?.name
    if (!title) return setKlaida('Projektui reikia pavadinimo.')
    setSaugoma(true)
    setKlaida(null)
    try {
      const d = await darbai.sukurtiProjekta(
        { sablonas, title, targetDate: data || null, budgetCents: centai, ownerId: atsakingas, areaId: sritis },
        as
      )
      onSukurta(d)
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSaugoma(false)
    }
  }

  return (
    <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
      <div className="modal uzd-dialogas" role="dialog" aria-label="Naujas projektas" onClick={(e) => e.stopPropagation()}>
        <h3>Naujas projektas</h3>

        <div className="projekto-sablonai" role="group" aria-label="Šablonas">
          {[...sablonai, { code: '', name: 'Tuščias', icon: '📄', description: 'Etapus ir darbus pridėsite patys' }].map((s) => (
            <button
              key={s.code || 'tuscias'}
              type="button"
              aria-pressed={(sablonas ?? '') === s.code}
              onClick={() => setSablonas(s.code || null)}
            >
              <span className="projekto-sablono-ikona" aria-hidden="true">
                {s.icon}
              </span>
              <b>{s.name}</b>
              <small>{s.description}</small>
            </button>
          ))}
        </div>

        <label>
          Pavadinimas
          <input
            value={pavadinimas}
            onChange={(e) => setPavadinimas(e.target.value)}
            placeholder={pasirinktas ? `pvz., ${pasirinktas.code === 'gimtadienis' ? 'Emos gimtadienis' : pasirinktas.name}` : 'pvz., Kraustymasis'}
            maxLength={120}
          />
        </label>

        <div className="uzd-du-laukai">
          <label>
            Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <label>
            Biudžetas, €
            <input inputMode="decimal" value={biudzetas} onChange={(e) => setBiudzetas(e.target.value)} placeholder="pvz., 500" />
          </label>
        </div>
        {data && <p className="paaiskinimas">{pilnaData(data)}</p>}

        <div className="uzd-du-laukai">
          <label>
            Atsakingas
            <select value={atsakingas ?? ''} onChange={(e) => setAtsakingas(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {nariai
                .filter((n) => n.uses_app)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sritis
            <select value={sritis ?? ''} onChange={(e) => setSritis(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{sablonas ? 'pagal šabloną' : '— be srities —'}</option>
              {sritys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {pasirinktas && (
          <p className="paaiskinimas">
            Etapai, darbai ir biudžeto eilutės bus paruošti pagal šabloną{data ? ', terminai — atgal nuo datos' : ''}
            {biudzetas ? ', sumos — įverčiai' : ''}. Viską galėsite pakeisti.
          </p>
        )}
        <p className="paaiskinimas">Arba tiesiog pasakykite katinukui, pvz., „Emos gimtadienis lapkričio 7 d., 500 €“.</p>

        {klaida && <p className="error">{klaida}</p>}
        <div className="modal-mygtukai">
          <button className="ghost" onClick={onUzdaryti}>
            Atšaukti
          </button>
          <button onClick={() => void sukurti()} disabled={saugoma}>
            {saugoma ? 'Kuriama…' : 'Sukurti'}
          </button>
        </div>
      </div>
    </div>
  )
}
