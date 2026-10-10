import { useCallback, useEffect, useState } from 'react'
import { darbai, type Sritis } from './api'
import { useNariai } from './nariai'

type Juodrastis = { name: string; icon: string; defaultMemberId: number | null }

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko išsaugoti.')

/**
 * Sritys ir atsakingi. Atsakingas siūlomas kiekvienai naujai tos srities užduočiai —
 * taip pasiskirstymas susitariamas kartą, o ne prie kiekvieno darbo.
 */
export default function Sritys() {
  const { nariai } = useNariai()
  const [sritys, setSritys] = useState<Sritis[] | null>(null)
  const [juodrasciai, setJuodrasciai] = useState<Record<number, Juodrastis>>({})
  const [nauja, setNauja] = useState<Juodrastis>({ name: '', icon: '', defaultMemberId: null })
  const [klaida, setKlaida] = useState<string | null>(null)

  const load = useCallback(() => {
    darbai
      .sritys()
      .then((s) => {
        setSritys(s)
        setJuodrasciai(
          Object.fromEntries(s.map((x) => [x.id, { name: x.name, icon: x.icon ?? '', defaultMemberId: x.default_member_id }]))
        )
      })
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  const pakeista = (s: Sritis) => {
    const j = juodrasciai[s.id]
    return j && (j.name !== s.name || j.icon !== (s.icon ?? '') || j.defaultMemberId !== s.default_member_id)
  }

  async function vykdyti(darbas: () => Promise<unknown>) {
    setKlaida(null)
    try {
      await darbas()
      load()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  const laukai = (j: Juodrastis, keisti: (j: Juodrastis) => void) => (
    <>
      <input
        className="sritis-ikona"
        value={j.icon}
        onChange={(e) => keisti({ ...j, icon: e.target.value })}
        aria-label="Ikona"
        maxLength={8}
      />
      <input value={j.name} onChange={(e) => keisti({ ...j, name: e.target.value })} aria-label="Pavadinimas" maxLength={40} />
      <select
        value={j.defaultMemberId ?? ''}
        onChange={(e) => keisti({ ...j, defaultMemberId: e.target.value ? Number(e.target.value) : null })}
        aria-label="Atsakingas"
      >
        <option value="">Bet kas</option>
        {nariai.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </>
  )

  return (
    <div className="kopijos">
      <p className="paaiskinimas">
        Atsakingas siūlomas kiekvienai naujai tos srities užduočiai — prie konkrečios užduoties jį visada galima
        pakeisti. Ikona — bet kuris simbolis ar jaustukas.
      </p>
      {klaida && <p className="error">{klaida}</p>}
      {!sritys && !klaida && <p className="paaiskinimas">Kraunama…</p>}

      {sritys && (
        <section className="kortele-sarasas">
          <ul className="sritys-sarasas">
            {sritys.map((s) => (
              <li key={s.id} className="sritis-eilute">
                {laukai(juodrasciai[s.id], (j) => setJuodrasciai((prev) => ({ ...prev, [s.id]: j })))}
                <div className="sritis-veiksmai">
                  {pakeista(s) && (
                    <button className="small" onClick={() => void vykdyti(() => darbai.keistiSriti(s.id, { ...juodrasciai[s.id], icon: juodrasciai[s.id].icon || null }))}>
                      Išsaugoti
                    </button>
                  )}
                  <button
                    className="ghost small"
                    onClick={() => {
                      if (confirm(`Ištrinti sritį „${s.name}“? Jos užduotys liks, tik be srities.`)) {
                        void vykdyti(() => darbai.istrintiSriti(s.id))
                      }
                    }}
                    aria-label={`Ištrinti sritį „${s.name}“`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
            <li className="sritis-eilute">
              {laukai(nauja, setNauja)}
              <div className="sritis-veiksmai">
                <button
                  className="small"
                  disabled={!nauja.name.trim()}
                  onClick={() =>
                    void vykdyti(async () => {
                      await darbai.sukurtiSriti({ ...nauja, icon: nauja.icon || null })
                      setNauja({ name: '', icon: '', defaultMemberId: null })
                    })
                  }
                >
                  Pridėti
                </button>
              </div>
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
