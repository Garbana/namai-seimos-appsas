import { useEffect, useState } from 'react'
import type { Transaction } from './api'
import { darbai, type OperacijosProjektas } from './darbai/api'
import { useNariai } from './darbai/nariai'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/**
 * Operacijos detalėse: kuriam projektui (gimtadieniui, atostogoms) ši operacija priskirta, ir
 * „Priskirti projektui“. Kategorija finansuose nesikeičia — projektas tik pjūvis (7 etapas).
 */
export default function ProjektoPriskyrimas({ operacija: t }: { operacija: Transaction }) {
  const { as } = useNariai()
  const [d, setD] = useState<OperacijosProjektas | null>(null)
  const [projektas, setProjektas] = useState('')
  const [eilute, setEilute] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)
  const tinka = !t.is_transfer && t.offset_of_id === null

  useEffect(() => {
    if (!tinka) return
    darbai
      .operacijosProjektas(t.id)
      .then(setD)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [t.id, tinka])

  if (!tinka || !d || (d.link === null && d.projects.length === 0)) return klaida ? <p className="error">{klaida}</p> : null

  async function veiksmas(darbas: () => Promise<OperacijosProjektas>) {
    setDirbama(true)
    setKlaida(null)
    try {
      setD(await darbas())
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  const pasirinktas = d.projects.find((p) => String(p.id) === projektas) ?? null

  return (
    <div className="projekto-priskyrimas">
      {d.link ? (
        <p>
          Projektas: <b>{d.link.project_title}</b> → {d.link.cost_name}{' '}
          <button className="ghost small" disabled={dirbama} onClick={() => void veiksmas(() => darbai.atsietiOperacija(t.id))}>
            Atsieti
          </button>
        </p>
      ) : (
        <div className="projekto-priskyrimas-forma">
          <span className="paaiskinimas">Priskirti projektui:</span>
          <select
            value={projektas}
            onChange={(e) => {
              setProjektas(e.target.value)
              setEilute('')
            }}
            aria-label="Projektas"
          >
            <option value="">— pasirink —</option>
            {d.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {pasirinktas && (
            <select value={eilute} onChange={(e) => setEilute(e.target.value)} aria-label="Biudžeto eilutė">
              <option value="">+ nauja eilutė ({t.counterparty_name ?? 'operacija'})</option>
              {pasirinktas.costs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {pasirinktas && (
            <button
              className="small"
              disabled={dirbama}
              onClick={() => void veiksmas(() => darbai.priskirtiOperacija(t.id, { projectId: pasirinktas.id, costId: eilute ? Number(eilute) : null }, as))}
            >
              Priskirti
            </button>
          )}
        </div>
      )}
      {klaida && <p className="error">{klaida}</p>}
    </div>
  )
}
