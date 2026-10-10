import { useCallback, useEffect, useState } from 'react'
import { darbai, type Projektas, type Uzduotis } from './api'
import { data, siandien } from './datos'

/** Ištrintos užduotys: 30 d. galima atkurti, paskui jos ištrinamos visam laikui. */
export default function Siuksliadeze() {
  const [uzduotys, setUzduotys] = useState<Uzduotis[] | null>(null)
  const [projektai, setProjektai] = useState<Projektas[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)
  const siandiena = siandien()

  const load = useCallback(() => {
    Promise.all([darbai.siuksliadeze(), darbai.istrintiProjektai()])
      .then(([u, p]) => {
        setUzduotys(u)
        setProjektai(p)
      })
      .catch((err) => setKlaida(err instanceof Error ? err.message : 'Nepavyko užkrauti.'))
  }, [])

  useEffect(() => load(), [load])

  async function atkurti(u: Uzduotis | Projektas, projektas = false) {
    setKlaida(null)
    try {
      await (projektas ? darbai.atkurtiProjekta(u.id) : darbai.atkurti(u.id))
      load()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko atkurti.')
    }
  }

  return (
    <div className="kopijos">
      <p className="paaiskinimas">
        Ištrintos užduotys čia laikomos 30 dienų — jas galima atkurti kartu su použduotimis. Senesnės ištrinamos
        visam laikui.
      </p>
      {klaida && <p className="error">{klaida}</p>}
      {!uzduotys && !klaida && <p className="paaiskinimas">Kraunama…</p>}
      {uzduotys && uzduotys.length === 0 && projektai.length === 0 && <p className="tuscia">Šiukšliadėžė tuščia.</p>}
      {projektai.length > 0 && (
        <section className="kortele-sarasas">
          <ul className="uzd-sarasas">
            {projektai.map((p) => (
              <li key={`p${p.id}`} className="sarasas-eilute nespaudziama">
                <span>
                  ◆ {p.title}
                  <small className="po-tekstu">projektas su darbais · ištrintas {data(p.deleted_at!.slice(0, 10), siandiena)}</small>
                </span>
                <button className="ghost small" onClick={() => void atkurti(p, true)}>
                  atkurti
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {uzduotys && uzduotys.filter((u) => !projektai.some((p) => p.id === u.project_id && p.deleted_at === u.deleted_at)).length > 0 && (
        <section className="kortele-sarasas">
          <ul className="uzd-sarasas">
            {uzduotys
              .filter((u) => !projektai.some((p) => p.id === u.project_id && p.deleted_at === u.deleted_at))
              .map((u) => (
              <li key={u.id} className="sarasas-eilute nespaudziama">
                <span>
                  {u.title}
                  <small className="po-tekstu">
                    {u.parent_id ? 'použduotis · ' : ''}ištrinta {data(u.deleted_at!.slice(0, 10), siandiena)}
                  </small>
                </span>
                <button className="ghost small" onClick={() => void atkurti(u)}>
                  atkurti
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
