import { useState, type ReactNode } from 'react'
import { eur, menuoVardas } from './api'
import { menesiuSeka, perkeltiMenesi, pokytis, type GrupesEilute } from './grupesSkaiciavimai'
import LinijuGrafikas, { type LinijuSerija } from './LinijuGrafikas'

type Props = {
  eilutes: GrupesEilute[]
  menesiai: string[]
  /** Pajamų grupė: didėjimas yra gerai, ne blogai. */
  pajamos: boolean
}

/** Fiksuota kategorijų spalvų eilė (dataviz paletė, patikrinta validatoriumi). */
const SPALVOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
const MAX_KATEGORIJU = SPALVOS.length
/** Metų palyginimui — viena spalva nuo šviesios (seniausi) iki tamsios (naujausi). */
const METU_SPALVOS = ['#1f5fb0', '#4a8ede', '#8ab8ec', '#bcd6f4']

type Laikotarpis = '12' | '24' | 'visa'

/** ▲ 12 % / ▼ 5 %; išlaidų didėjimas raudonas, mažėjimas žalias (pajamoms atvirkščiai). */
export function PokycioZyme({ santykis, pajamos, eilute = false }: { santykis: number | null; pajamos: boolean; eilute?: boolean }) {
  if (santykis === null || !Number.isFinite(santykis)) return null
  const lygu = Math.abs(santykis) < 0.005
  const kyla = santykis > 0
  const klase = lygu ? 'lygu' : kyla !== pajamos ? 'blogai' : 'gerai'
  const procentai = Math.abs(santykis) >= 10 ? '>999' : Math.round(Math.abs(santykis) * 100).toLocaleString('lt-LT')
  const tekstas = lygu ? '≈ 0 %' : `${kyla ? '▲' : '▼'} ${procentai} %`
  return (
    <span
      className={`pokytis ${klase}${eilute ? ' eiluteje' : ''}`}
      title={lygu ? 'beveik nepasikeitė' : `${kyla ? 'daugiau' : 'mažiau'} ${procentai} %`}
    >
      {tekstas}
    </span>
  )
}

function Rodiklis({ etikete, reiksme, pastaba }: { etikete: string; reiksme: string; pastaba?: ReactNode }) {
  return (
    <div className="rodiklis">
      <span className="rodiklis-etikete">{etikete}</span>
      <strong className="rodiklis-reiksme">{reiksme}</strong>
      {pastaba && <span className="rodiklis-pastaba">{pastaba}</span>}
    </div>
  )
}

function Perjungiklis<T extends string>({
  reiksme,
  variantai,
  onChange,
  pavadinimas,
}: {
  reiksme: T
  variantai: [T, string][]
  onChange: (v: T) => void
  pavadinimas: string
}) {
  return (
    <div className="perjungiklis" role="group" aria-label={pavadinimas}>
      {variantai.map(([v, tekstas]) => (
        <button key={v} type="button" aria-pressed={reiksme === v} onClick={() => onChange(v)}>
          {tekstas}
        </button>
      ))}
    </div>
  )
}

/**
 * Grupės išlaidų analizė iš jau turimų mėnesių sumų: rodikliai, linijos pagal
 * kategorijas, metų palyginimas ir sumos pagal metus. Naujų duomenų nereikia.
 */
export default function GrupesAnalize({ eilutes, menesiai, pajamos }: Props) {
  const turiSusijusiu = eilutes.some((e) => e.related)
  const [apimtis, setApimtis] = useState<'visa' | 'grupe'>('visa')
  const [vaizdas, setVaizdas] = useState<'laikas' | 'metai'>('laikas')
  const [laikotarpis, setLaikotarpis] = useState<Laikotarpis>('visa')
  const [rodytiViso, setRodytiViso] = useState(true)
  const [pasirinktos, setPasirinktos] = useState<Map<number, number> | null>(null)
  const [metuKategorija, setMetuKategorija] = useState<number | 'viso'>('viso')

  const rodomos = eilutes.filter((e) => apimtis === 'visa' || !e.related)
  const zenklas = pajamos ? 1 : -1
  const siandienMenuo = new Date().toLocaleDateString('sv-SE').slice(0, 7)

  if (menesiai.length === 0) return null
  const seka = menesiuSeka(menesiai[0], menesiai[menesiai.length - 1])
  const turimi = new Set(seka)
  const pilni = seka.filter((m) => m < siandienMenuo)
  const paskutinis = pilni[pilni.length - 1] ?? null

  const reiksme = (e: GrupesEilute, m: string) => zenklas * (e.pagalMenesi.get(m) ?? 0)
  /** Nesibaigusiame mėnesyje dar neįvykęs mokėjimas grafike — tuščias, ne nulis. */
  const grafikoReiksme = (e: GrupesEilute, m: string) =>
    m >= siandienMenuo && !e.pagalMenesi.has(m) ? null : reiksme(e, m)
  const viso = (m: string) => rodomos.reduce((s, e) => s + reiksme(e, m), 0)
  const suma = (mm: string[]) => mm.reduce((s, m) => s + viso(m), 0)

  // Pagal nutylėjimą — daugiausia per 12 mėn. išleidusios kategorijos, spalvos pagal jų eilę grupėje.
  const paskutiniai12 = pilni.slice(-12)
  const numatytosios = new Map(
    rodomos
      .map((e) => ({ e, s: paskutiniai12.reduce((acc, m) => acc + reiksme(e, m), 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_KATEGORIJU)
      .map((x) => x.e)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((e, i) => [e.id, i])
  )
  const aktyvios = new Map([...(pasirinktos ?? numatytosios)].filter(([id]) => rodomos.some((e) => e.id === id)))

  function perjungti(id: number) {
    const naujos = new Map(aktyvios)
    if (naujos.has(id)) naujos.delete(id)
    else {
      if (naujos.size >= MAX_KATEGORIJU) return
      const uzimti = new Set(naujos.values())
      naujos.set(id, SPALVOS.findIndex((_, slotas) => !uzimti.has(slotas)))
    }
    setPasirinktos(naujos)
  }

  // --- Rodikliai
  const priesPaskutini = paskutinis ? perkeltiMenesi(paskutinis, -1) : null
  const ankstesni12 = pilni.slice(-24, -12)
  const metaiDabar = siandienMenuo.slice(0, 4)
  const siemet = pilni.filter((m) => m.startsWith(metaiDabar))
  const pernaiTiePatys = siemet.map((m) => `${Number(metaiDabar) - 1}${m.slice(4)}`)
  const pernaiTuri = siemet.length > 0 && pernaiTiePatys.every((m) => turimi.has(m))

  // --- Grafikas pagal mėnesius
  const rodomiMenesiai = laikotarpis === 'visa' ? seka : seka.slice(-Number(laikotarpis))
  const serijos: LinijuSerija[] = [
    ...rodomos
      .filter((e) => aktyvios.has(e.id))
      .map((e) => ({
        key: String(e.id),
        name: e.name,
        color: SPALVOS[aktyvios.get(e.id)!],
        points: rodomiMenesiai.map((m) => grafikoReiksme(e, m)),
      })),
    ...(rodytiViso
      ? [{ key: 'viso', name: 'Iš viso', color: 'var(--tekstas)', points: rodomiMenesiai.map(viso), storas: true }]
      : []),
  ]
  const trumpas = rodomiMenesiai.length <= 24
  const laikoZymos = rodomiMenesiai.flatMap((m, i) =>
    trumpas
      ? (Number(m.slice(5)) - 1) % 3 === 0
        ? [{ i, tekstas: menuoVardas(m, true) }]
        : []
      : m.endsWith('-01')
        ? [{ i, tekstas: m.slice(0, 4) }]
        : []
  )

  // --- Metų palyginimas
  const metuKat = metuKategorija !== 'viso' && rodomos.some((e) => e.id === metuKategorija) ? metuKategorija : 'viso'
  const metuEilute = metuKat === 'viso' ? null : rodomos.find((e) => e.id === metuKat)!
  const metai = [...new Set(pilni.map((m) => m.slice(0, 4)))].sort().slice(-METU_SPALVOS.length)
  const metuSerijos: LinijuSerija[] = metai.map((y, i) => ({
    key: y,
    name: y,
    color: METU_SPALVOS[metai.length - 1 - i],
    storas: i === metai.length - 1,
    points: Array.from({ length: 12 }, (_, k) => {
      const m = `${y}-${String(k + 1).padStart(2, '0')}`
      if (!turimi.has(m) || m >= siandienMenuo) return null
      return metuEilute ? reiksme(metuEilute, m) : viso(m)
    }),
  }))
  const menesiuVardai = Array.from({ length: 12 }, (_, k) => menuoVardas(`2000-${String(k + 1).padStart(2, '0')}`).split(' ')[0])

  const susijusiuVardai = eilutes.filter((e) => e.related).map((e) => e.name)

  return (
    <section className="grupes-analize">
      <div className="analizes-virsus">
        <h3 className="skyriaus-antraste">{pajamos ? 'Pajamos laike' : 'Išlaidos laike'}</h3>
        {turiSusijusiu && (
          <Perjungiklis
            pavadinimas="Kurias išlaidas skaičiuoti"
            reiksme={apimtis}
            onChange={setApimtis}
            variantai={[
              ['visa', 'Bendra suma'],
              ['grupe', 'Tik biudžeto išlaidos'],
            ]}
          />
        )}
      </div>
      {turiSusijusiu && (
        <p className="paaiskinimas">
          {apimtis === 'visa'
            ? `Įskaičiuota ir tai, kas primesta iš kitų skilčių: ${susijusiuVardai.join(', ')}. Bendrose šeimos išlaidose jos skaičiuojamos savo skiltyse.`
            : 'Tik šios skilties kategorijos — tai, kas patenka į bendrą biudžetą.'}
        </p>
      )}

      {paskutinis && (
        <div className="kreditu-suvestine">
          <Rodiklis
            etikete={`Paskutinis mėnuo · ${menuoVardas(paskutinis)}`}
            reiksme={eur(viso(paskutinis))}
            pastaba={
              priesPaskutini && turimi.has(priesPaskutini) ? (
                <>
                  <PokycioZyme santykis={pokytis(viso(paskutinis), viso(priesPaskutini))} pajamos={pajamos} eilute /> nei{' '}
                  {menuoVardas(priesPaskutini)}
                </>
              ) : undefined
            }
          />
          <Rodiklis
            etikete="Vidurkis per mėnesį"
            reiksme={eur(Math.round(suma(paskutiniai12) / paskutiniai12.length))}
            pastaba={`per paskutinius ${paskutiniai12.length} mėn.`}
          />
          <Rodiklis
            etikete={`Per ${paskutiniai12.length} mėn.`}
            reiksme={eur(suma(paskutiniai12))}
            pastaba={
              ankstesni12.length === 12 ? (
                <>
                  <PokycioZyme santykis={pokytis(suma(paskutiniai12), suma(ankstesni12))} pajamos={pajamos} eilute /> nei
                  ankstesni 12 mėn.
                </>
              ) : undefined
            }
          />
          {siemet.length > 0 && (
            <Rodiklis
              etikete={`${metaiDabar} m. iki ${menuoVardas(paskutinis).split(' ')[0]} imtinai`}
              reiksme={eur(suma(siemet))}
              pastaba={
                pernaiTuri ? (
                  <>
                    <PokycioZyme santykis={pokytis(suma(siemet), suma(pernaiTiePatys))} pajamos={pajamos} eilute /> nei{' '}
                    {Number(metaiDabar) - 1} m. tuo pačiu metu
                  </>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      <div className="kreditas">
        <div className="analizes-irankiai">
          <Perjungiklis
            pavadinimas="Grafiko vaizdas"
            reiksme={vaizdas}
            onChange={setVaizdas}
            variantai={[
              ['laikas', 'Pagal mėnesius'],
              ['metai', 'Metų palyginimas'],
            ]}
          />
          {vaizdas === 'laikas' ? (
            <Perjungiklis
              pavadinimas="Laikotarpis"
              reiksme={laikotarpis}
              onChange={setLaikotarpis}
              variantai={[
                ['12', '12 mėn.'],
                ['24', '24 mėn.'],
                ['visa', 'Visa istorija'],
              ]}
            />
          ) : (
            <label className="metu-kategorija">
              Rodyti
              <select
                value={String(metuKat)}
                onChange={(e) => setMetuKategorija(e.target.value === 'viso' ? 'viso' : Number(e.target.value))}
              >
                <option value="viso">Iš viso</option>
                {rodomos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {vaizdas === 'laikas' ? (
          <>
            <div className="kategoriju-zymos" role="group" aria-label="Kurias kategorijas rodyti grafike">
              <button type="button" aria-pressed={rodytiViso} onClick={() => setRodytiViso(!rodytiViso)}>
                <span className="viso-zyme" /> Iš viso
              </button>
              {rodomos.map((e) => {
                const slotas = aktyvios.get(e.id)
                const ijungta = slotas !== undefined
                const pilna = !ijungta && aktyvios.size >= MAX_KATEGORIJU
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={ijungta}
                    disabled={pilna}
                    title={pilna ? `Vienu metu galima rodyti iki ${MAX_KATEGORIJU} kategorijų` : undefined}
                    onClick={() => perjungti(e.id)}
                  >
                    <span
                      className={ijungta ? 'spalvos-zyme' : 'spalvos-zyme isjungta'}
                      style={ijungta ? { background: SPALVOS[slotas] } : undefined}
                    />
                    {e.name}
                    {e.related && <small> · {e.originGroupName}</small>}
                  </button>
                )
              })}
            </div>
            <LinijuGrafikas
              serijos={serijos}
              pavadinimai={rodomiMenesiai.map((m) => `${menuoVardas(m)}${m >= siandienMenuo ? ' (dar nesibaigęs)' : ''}`)}
              zymos={laikoZymos}
              ariaLabel="Sumos pagal mėnesius ir kategorijas. Tikslios sumos — lentelėje po grafiku."
            />
          </>
        ) : (
          <>
            <ul className="grafiko-legenda">
              {metuSerijos.map((s) => (
                <li key={s.key}>
                  <span className="spalvos-zyme" style={{ background: s.color }} />
                  {s.name}
                </li>
              ))}
            </ul>
            <LinijuGrafikas
              serijos={metuSerijos}
              pavadinimai={menesiuVardai}
              zymos={menesiuVardai.map((_, i) => ({
                i,
                tekstas: menuoVardas(`2000-${String(i + 1).padStart(2, '0')}`, true).split(' ')[0],
              }))}
              ariaLabel="Tų pačių mėnesių sumos skirtingais metais. Tikslios sumos — lentelėje „Pagal metus“."
            />
          </>
        )}

        <MetuLentele rodomos={rodomos} pilni={pilni} zenklas={zenklas} pajamos={pajamos} />
      </div>
    </section>
  )
}

function MetuLentele({
  rodomos,
  pilni,
  zenklas,
  pajamos,
}: {
  rodomos: GrupesEilute[]
  pilni: string[]
  zenklas: number
  pajamos: boolean
}) {
  if (pilni.length === 0) return null
  const metai = [...new Set(pilni.map((m) => m.slice(0, 4)))].sort().reverse()
  const paskutinis = pilni[pilni.length - 1]
  const nepilniMetai = paskutinis.endsWith('-12') ? null : paskutinis.slice(0, 4)
  const turimi = new Set(pilni)

  const metuSuma = (f: (m: string) => number, y: string) =>
    pilni.filter((m) => m.startsWith(y)).reduce((s, m) => s + f(m), 0)
  /** Praėjusių metų tų pačių mėnesių suma — kad nepilni metai būtų lyginami sąžiningai. */
  const baze = (f: (m: string) => number, y: string) => {
    const menesiai = pilni.filter((m) => m.startsWith(y)).map((m) => `${Number(y) - 1}${m.slice(4)}`)
    return menesiai.length > 0 && menesiai.every((m) => turimi.has(m)) ? menesiai.reduce((s, m) => s + f(m), 0) : undefined
  }

  const eilutes = [
    ...rodomos.map((e) => ({
      key: String(e.id),
      name: e.name,
      f: (m: string) => zenklas * (e.pagalMenesi.get(m) ?? 0),
      viso: false,
    })),
    {
      key: 'viso',
      name: 'Iš viso',
      f: (m: string) => rodomos.reduce((s, e) => s + zenklas * (e.pagalMenesi.get(m) ?? 0), 0),
      viso: true,
    },
  ]

  return (
    <details className="kreditas-skyrius">
      <summary>
        Pagal metus
        <span>
          {nepilniMetai
            ? `${nepilniMetai}* — iki ${menuoVardas(paskutinis)} imtinai, lyginama su tais pačiais ${Number(nepilniMetai) - 1} m. mėnesiais`
            : 'pokytis — palyginus su praėjusiais metais'}
        </span>
      </summary>
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Kategorija</th>
              {metai.map((y) => (
                <th key={y} className="num">
                  {y}
                  {y === nepilniMetai ? '*' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eilutes.map((r) => (
              <tr key={r.key} className={r.viso ? 'metu-eilute' : undefined}>
                <td>{r.name}</td>
                {metai.map((y) => {
                  const s = metuSuma(r.f, y)
                  return (
                    <td key={y} className="num">
                      {eur(s)}
                      <PokycioZyme santykis={pokytis(s, baze(r.f, y))} pajamos={pajamos} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
