import { useCallback, useEffect, useState } from 'react'
import { eur } from '../api'
import { darbai, type BankoOperacija, type Islaida, type ProjektoBankas as Duomenys } from './api'
import { data, siandien } from './datos'
import { useNariai } from './nariai'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/** Naujos eilutės pasirinkimas sąraše. */
const NAUJA = 'nauja'

/**
 * Projekto biudžeto apačia: „Faktas iš banko“ (susietos operacijos su „Atsieti“) ir
 * „Gali būti šio projekto“ (pasiūlymai su eilutės pasirinkimu, „Susieti“ ir „Ne“).
 * Operacija lieka savo finansų kategorijoje — projektas tik parodo, kiek iš jos buvo šiam reikalui.
 */
export default function ProjektoBankas({ projectId, eilutes, onPakeista }: { projectId: number; eilutes: Islaida[]; onPakeista: () => void }) {
  const { as } = useNariai()
  const [d, setD] = useState<Duomenys | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)
  // Kiekvienam pasiūlymui pasirinkta eilutė (numatytai — kurią siūlo serveris).
  const [pasirinkta, setPasirinkta] = useState<Record<number, string>>({})
  const siandiena = siandien()

  const load = useCallback(() => {
    darbai
      .projektoBankas(projectId)
      .then(setD)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [projectId])

  useEffect(() => load(), [load])

  async function veiksmas(darbas: () => Promise<Duomenys>) {
    setDirbama(true)
    setKlaida(null)
    try {
      setD(await darbas())
      onPakeista()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  const operacija = (o: BankoOperacija) => (
    <span className="bankas-operacija">
      <b>{o.counterparty_name ?? o.description?.slice(0, 40) ?? '—'}</b>
      <small className="paaiskinimas">
        {data(o.booking_date, siandiena)}
        {o.account_owner ? ` · ${o.account_owner}` : ''}
        {o.category_name ? ` · ${o.category_name}` : ''}
      </small>
    </span>
  )

  if (!d) return klaida ? <p className="error">{klaida}</p> : null

  return (
    <div className="projekto-bankas">
      {klaida && <p className="error">{klaida}</p>}

      {d.links.length > 0 && (
        <>
          <h3>Faktas iš banko</h3>
          <ul className="bankas-sarasas">
            {d.links.map((l) => (
              <li key={l.transaction_id}>
                {operacija(l)}
                <span className="bankas-suma">
                  {eur(-l.amount_cents)}
                  <small className="paaiskinimas">→ {l.cost_name}</small>
                </span>
                <button
                  className="ghost small"
                  disabled={dirbama}
                  onClick={() =>
                    void veiksmas(async () => {
                      await darbai.atsietiOperacija(l.transaction_id)
                      return darbai.projektoBankas(projectId)
                    })
                  }
                >
                  Atsieti
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {d.suggestions.length > 0 && (
        <>
          <h3>Gali būti šio projekto ({d.suggestions.length})</h3>
          <p className="paaiskinimas">Banko operacijos projekto laikotarpiu. Susietos tampa eilutės faktu; kategorija finansuose nesikeičia.</p>
          <ul className="bankas-sarasas">
            {d.suggestions.map((s) => {
              const pas = pasirinkta[s.transaction_id] ?? (s.cost_id !== null ? String(s.cost_id) : NAUJA)
              return (
                <li key={s.transaction_id} className="bankas-pasiulymas">
                  {operacija(s)}
                  <span className="bankas-suma">
                    {eur(-s.amount_cents)}
                    <small className="paaiskinimas">{s.reason}</small>
                  </span>
                  <span className="bankas-veiksmai">
                    <select
                      value={pas}
                      onChange={(e) => setPasirinkta((p) => ({ ...p, [s.transaction_id]: e.target.value }))}
                      aria-label="Kuriai eilutei"
                    >
                      {eilutes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value={NAUJA}>+ nauja eilutė</option>
                    </select>
                    <button
                      className="small"
                      disabled={dirbama}
                      onClick={() =>
                        void veiksmas(() =>
                          darbai.susietiOperacija(
                            projectId,
                            { transactionId: s.transaction_id, costId: pas === NAUJA ? null : Number(pas) },
                            as
                          )
                        )
                      }
                    >
                      Susieti
                    </button>
                    <button className="ghost small" disabled={dirbama} onClick={() => void veiksmas(() => darbai.atmestiPasiulyma(projectId, s.transaction_id))}>
                      Ne
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {d.links.length === 0 && d.suggestions.length === 0 && (
        <p className="paaiskinimas">
          Banko operacijų šiam projektui dar nėra. Jas galima priskirti ir iš Finansai → Operacijos (atidarius operaciją).
        </p>
      )}
    </div>
  )
}
