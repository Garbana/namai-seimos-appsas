import { useCallback, useEffect, useState } from 'react'
import { darbai, type Projektas } from './api'
import { siandien } from './datos'
import NaujasProjektas from './NaujasProjektas'
import ProjektoKortele from './ProjektoKortele'

/** Projektų sąrašas: aktyvūs pagal datą, baigti ir atidėti — suskleisti. */
export default function Projektai({ onAtidaryti }: { onAtidaryti: (p: Projektas) => void }) {
  const [projektai, setProjektai] = useState<Projektas[] | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [naujas, setNaujas] = useState(false)
  const [rodytiKitus, setRodytiKitus] = useState(false)
  const siandiena = siandien()

  const load = useCallback(() => {
    darbai
      .projektai()
      .then(setProjektai)
      .catch((err) => setKlaida(err instanceof Error ? err.message : 'Nepavyko užkrauti.'))
  }, [])

  useEffect(() => load(), [load])

  const aktyvus = (projektai ?? []).filter((p) => p.status === 'aktyvus')
  const kiti = (projektai ?? []).filter((p) => p.status !== 'aktyvus')

  return (
    <div className="projektai">
      <div className="projektai-virsus">
        <button onClick={() => setNaujas(true)}>+ Naujas projektas</button>
      </div>

      {klaida && <p className="error">{klaida}</p>}
      {!projektai && !klaida && <p className="paaiskinimas">Kraunama…</p>}
      {projektai && aktyvus.length === 0 && (
        <p className="tuscia">
          Projektų dar nėra. Sukurkite iš šablono (gimtadienis, atostogos, remontas) arba pasakykite katinukui, pvz.,
          „Emos gimtadienis lapkričio 7 d., 500 €, reikia salės, maisto ir pakvietimų“.
        </p>
      )}

      <div className="projektu-sarasas">
        {aktyvus.map((p) => (
          <ProjektoKortele key={p.id} projektas={p} siandiena={siandiena} onClick={() => onAtidaryti(p)} />
        ))}
      </div>

      {kiti.length > 0 && (
        <section className="uzd-atliktos">
          <button className="linkish" onClick={() => setRodytiKitus(!rodytiKitus)} aria-expanded={rodytiKitus}>
            {rodytiKitus ? '▾' : '▸'} Baigti ir atidėti ({kiti.length})
          </button>
          {rodytiKitus && (
            <div className="projektu-sarasas">
              {kiti.map((p) => (
                <ProjektoKortele key={p.id} projektas={p} siandiena={siandiena} onClick={() => onAtidaryti(p)} />
              ))}
            </div>
          )}
        </section>
      )}

      {naujas && (
        <NaujasProjektas
          onUzdaryti={() => setNaujas(false)}
          onSukurta={(d) => {
            setNaujas(false)
            onAtidaryti(d.project)
          }}
        />
      )}
    </div>
  )
}
