import { useState } from 'react'
import { api, eur, menuoVardas, type Priminimai as PriminimuDuomenys, type Priminimas } from './api'

type Props = {
  duomenys: PriminimuDuomenys
  onChanged: () => void
  /**
   * Ką rodyti. Apžvalgoje — tik būtini mokėjimai (komunaliniai, draudimai,
   * kreditai), o taupymo įnašai atskirai taupymo skiltyje, kad pradinis langas
   * neužspamintų.
   */
  rodyti?: 'mokejimai' | 'taupymas'
}

const BUSENOS: Record<Priminimas['state'], { tekstas: string; klase: string }> = {
  sumoketa: { tekstas: 'sumokėta', klase: 'sumoketa' },
  dalinai: { tekstas: 'iš dalies', klase: 'dalinai' },
  laukiama: { tekstas: 'laukiama', klase: 'laukiama' },
  neapmoketa: { tekstas: 'dar nematyti', klase: 'neapmoketa' },
}

const PAAISKINIMAI: Record<Priminimas['basis'], string> = {
  rankinis: 'suma nurodyta ranka',
  grafikas: 'suma ir data iš sutarties grafiko',
  istorija: 'suma ir diena apskaičiuotos iš istorijos',
}

/**
 * Priminimai apžvalgos viršuje: ar šį mėnesį jau atlikti reguliarūs mokėjimai.
 * Duomenys tik primetami iš operacijų ir sutarčių — nieko naujo nesaugoma,
 * išskyrus rankinius pataisymus (išjungti / laukiama suma).
 */
export default function Priminimai({ duomenys, onChanged, rodyti = 'mokejimai' }: Props) {
  const [issketa, setIsskleista] = useState(false)
  const [rodytiVisus, setRodytiVisus] = useState(false)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [tvarkomas, setTvarkomas] = useState<string | null>(null)

  const taupymas = rodyti === 'taupymas'
  const items = duomenys.items.filter((i) => (taupymas ? i.source === 'taupymas' : i.source !== 'taupymas'))
  const neatlikti = items.filter((i) => i.state !== 'sumoketa')
  const rodomi = rodytiVisus ? items : neatlikti
  const viskas = neatlikti.length === 0 && items.length > 0
  // Sumos skaičiuojamos iš to, kas rodoma, o ne iš viso sąrašo.
  const s = {
    count: items.length,
    paidCount: items.length - neatlikti.length,
    lateCount: items.filter((i) => i.state === 'neapmoketa').length,
    leftCents: neatlikti.reduce((suma, i) => suma + i.leftCents, 0),
  }

  // Duomenys tesiekia tiek, kiek įkelta išrašų — kitaip „nesumokėta" meluotų.
  const senosSaskaitos = duomenys.sources.filter((s) => s.through < duomenys.today)

  async function isjungti(item: Priminimas) {
    if (!confirm(`Nerodyti „${item.name}" tarp reguliarių mokėjimų?`)) return
    setTvarkomas(item.ref)
    try {
      await api.saveReminder(item.source, item.ref, { isActive: false })
      onChanged()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko išsaugoti.')
    } finally {
      setTvarkomas(null)
    }
  }

  if (items.length === 0) return null

  return (
    <section className={viskas ? 'priminimai viskas' : 'priminimai'}>
      <button className="priminimu-antraste" onClick={() => setIsskleista(!issketa)} aria-expanded={issketa}>
        <span className="priminimu-zenklas" aria-hidden="true">
          {viskas ? '✓' : s.lateCount > 0 ? '!' : '•'}
        </span>
        <span className="priminimu-tekstas">
          <strong>
            {menuoVardas(duomenys.month)}: {taupymas ? 'atidėta' : 'atlikta'} {s.paidCount} iš {s.count}{' '}
            {taupymas ? 'taupymo įnašų' : 'reguliarių mokėjimų'}
          </strong>
          <small>
            {viskas
              ? taupymas
                ? 'visi šio mėnesio taupymo įnašai jau atidėti'
                : 'visi šio mėnesio reguliarūs mokėjimai jau nurašyti'
              : `liko ${eur(s.leftCents)}${
                  s.lateCount > 0 && !taupymas ? ` · ${s.lateCount} jau turėjo būti nurašyti` : ''
                }`}
          </small>
        </span>
        <span className="rodykle" aria-hidden="true">
          {issketa ? '▾' : '▸'}
        </span>
      </button>

      {!issketa && neatlikti.length > 0 && (
        <ul className="priminimu-santrauka">
          {neatlikti.slice(0, 4).map((i) => (
            <li key={i.ref} className={BUSENOS[i.state].klase}>
              {i.name}
              <span>{eur(i.leftCents)}</span>
            </li>
          ))}
          {neatlikti.length > 4 && <li className="daugiau">ir dar {neatlikti.length - 4}…</li>}
        </ul>
      )}

      {issketa && (
        <>
          {klaida && <p className="error">{klaida}</p>}
          {!taupymas && senosSaskaitos.length > 0 && (
            <p className="paaiskinimas">
              Įkelti išrašai siekia: {senosSaskaitos.map((s) => `${s.owner} — iki ${s.through}`).join(', ')}.
              Vėlesni nurašymai dar nematomi, todėl tų sąskaitų mokėjimai rodomi kaip „laukiama", o ne
              neapmokėti.
            </p>
          )}

          <div className="table-wrap">
            <table className="priminimu-lentele">
              <thead>
                <tr>
                  <th>Mokėjimas</th>
                  <th className="num">Laukiama</th>
                  <th className="num">Nurašyta</th>
                  <th>Diena</th>
                  <th>Būsena</th>
                  <th className="tight"></th>
                </tr>
              </thead>
              <tbody>
                {rodomi.map((i) => (
                  <tr key={i.ref} className={i.state === 'sumoketa' ? 'atlikta' : undefined}>
                    <td>
                      {i.name}
                      <small className="po-tekstu" title={PAAISKINIMAI[i.basis]}>
                        {i.groupName}
                        {i.manual ? ' · pataisyta ranka' : ''}
                      </small>
                    </td>
                    <td className="num">
                      {i.fixed ? eur(i.expectedCents) : `~${eur(i.expectedCents)}`}
                      {!i.fixed && i.minCents !== i.maxCents && (
                        <small className="po-tekstu">
                          {eur(i.minCents)}–{eur(i.maxCents)}
                        </small>
                      )}
                    </td>
                    <td className="num">{i.paidCents > 0 ? eur(i.paidCents) : '—'}</td>
                    <td className="nowrap">{i.dueDay === null ? 'per mėnesį' : `${i.dueDay} d.`}</td>
                    <td>
                      <span className={`tag ${BUSENOS[i.state].klase}`}>{BUSENOS[i.state].tekstas}</span>
                    </td>
                    <td className="tight">
                      <button
                        className="ghost small"
                        disabled={tvarkomas === i.ref}
                        onClick={() => isjungti(i)}
                        title="Nerodyti šio mokėjimo tarp reguliarių"
                      >
                        nerodyti
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="priminimu-apacia">
            <button className="ghost small" onClick={() => setRodytiVisus(!rodytiVisus)}>
              {rodytiVisus ? 'rodyti tik neatliktus' : `rodyti visus (${items.length})`}
            </button>
            <span className="paaiskinimas">
              {taupymas
                ? 'Rodomi katiliukai, kuriems nustatytas mėnesio planas. Atidėta suma imama iš tam mėnesiui priskirtų įnašų.'
                : 'Sąrašas sudaromas pats: kreditų ir draudimų grafikai, o kitur — kategorijos, mokamos beveik kas mėnesį. Kur suma kas mėnesį kitokia (komunaliniai, būreliai), rodomas „~" ir istorinis intervalas — ten svarbu, ar nurašymas buvo, o ne kiek tiksliai.'}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
