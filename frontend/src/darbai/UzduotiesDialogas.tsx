import { useEffect, useState } from 'react'
import { darbai, type Etapas, type Prioritetas, type Projektas, type Sritis, type Uzduotis, type UzduotiesLaukai } from './api'
import {
  DIENU_RAIDES,
  pakartojimoTekstas,
  pilnaData,
  PRIMINIMAI_BE_LAIKO,
  PRIMINIMAI_SU_LAIKU,
  priminimasTinka,
  priminimoTekstas,
  rasytiPakartojima,
  skaitytiPakartojima,
  sumaCentais,
  type Pakartojimas,
  type PakartojimoRusis,
} from './datos'
import { useNariai } from './nariai'

type Props = {
  /** null — nauja užduotis. */
  uzduotis: Uzduotis | null
  /** Visos užduotys — použduotims rodyti. */
  visos: Uzduotis[]
  sritys: Sritis[]
  numatytieji?: { dueDate?: string | null; areaId?: number | null; projectId?: number | null; sectionId?: number | null }
  /** Naujai užduočiai — asistento paruošti laukai („Taisyti“). */
  juodrastis?: UzduotiesLaukai & { pouzduotys?: string[] }
  /** Jei nurodyta — nauja užduotis ne įrašoma, o atiduodama (asistentas ją patvirtina pats). */
  onIssaugoti?: (laukai: UzduotiesLaukai, pouzduotys: string[]) => Promise<void>
  onUzdaryti: () => void
  /** Kas nors pakeista — ekranas perkrauna sąrašą. */
  onPakeista: () => void
}

const PRIORITETAI: { reiksme: Prioritetas; vardas: string }[] = [
  { reiksme: 'svarbu', vardas: 'Svarbu' },
  { reiksme: 'iprasta', vardas: 'Įprasta' },
  { reiksme: 'kada_nors', vardas: 'Kada nors' },
]

const RUSYS: { reiksme: PakartojimoRusis; vardas: string; vienetas: string }[] = [
  { reiksme: 'ne', vardas: 'Nesikartoja', vienetas: '' },
  { reiksme: 'diena', vardas: 'Kas dieną', vienetas: 'd.' },
  { reiksme: 'savaite', vardas: 'Kas savaitę', vienetas: 'sav.' },
  { reiksme: 'menuo', vardas: 'Kas mėnesį', vienetas: 'mėn.' },
  { reiksme: 'metai', vardas: 'Kas metus', vienetas: 'm.' },
]

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko išsaugoti.')

export default function UzduotiesDialogas({
  uzduotis: u,
  visos,
  sritys,
  numatytieji,
  juodrastis: j,
  onIssaugoti,
  onUzdaryti,
  onPakeista,
}: Props) {
  const { nariai, as } = useNariai()
  const pradineSritis = u ? u.area_id : (j?.areaId ?? numatytieji?.areaId ?? null)
  const pradineSuma = u ? u.amount_cents : (j?.amountCents ?? null)

  const [pavadinimas, setPavadinimas] = useState(u?.title ?? j?.title ?? '')
  const [sritis, setSritis] = useState<number | null>(pradineSritis)
  const [atsakingas, setAtsakingas] = useState<number | null>(
    u
      ? u.assignee_id
      : j?.assigneeId !== undefined
        ? j.assigneeId
        : (sritys.find((s) => s.id === pradineSritis)?.default_member_id ?? null)
  )
  // Kol atsakingo neparinko pats (ar asistentas) — jį siūlo pasirinkta sritis.
  const [atsakingasParinktas, setAtsakingasParinktas] = useState(u !== null || j?.assigneeId !== undefined)
  const [terminas, setTerminas] = useState(u?.due_date ?? j?.dueDate ?? numatytieji?.dueDate ?? '')
  const [laikas, setLaikas] = useState(u?.due_time ?? j?.dueTime ?? '')
  const [prioritetas, setPrioritetas] = useState<Prioritetas>(u?.priority ?? j?.priority ?? 'iprasta')
  const [pakartojimas, setPakartojimas] = useState<Pakartojimas>(skaitytiPakartojima(u?.recurrence ?? j?.recurrence ?? null))
  // „Po atlikimo“: kitas kartas — nuo atlikimo dienos (vandens filtras, padangų slėgis).
  const [nuoAtlikimo, setNuoAtlikimo] = useState(Boolean(u?.repeat_after_done ?? j?.repeatAfterDone))
  const [suma, setSuma] = useState(pradineSuma != null ? (pradineSuma / 100).toString().replace('.', ',') : '')
  const [pastabos, setPastabos] = useState(u?.notes ?? j?.notes ?? '')
  const [priminimai, setPriminimai] = useState<string[]>(u?.reminders ?? j?.reminders ?? [])
  const [naujosPouzduotys, setNaujosPouzduotys] = useState<string[]>(j?.pouzduotys ?? [])
  const [projektas, setProjektas] = useState<number | null>(u ? u.project_id : (j?.projectId ?? numatytieji?.projectId ?? null))
  const [etapas, setEtapas] = useState<number | null>(u ? u.section_id : (j?.sectionId ?? numatytieji?.sectionId ?? null))
  const [projektai, setProjektai] = useState<Projektas[]>([])
  const [etapai, setEtapai] = useState<Record<number, Etapas[]>>({})
  const [pouzduotis, setPouzduotis] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [saugoma, setSaugoma] = useState(false)

  const pouzduotys = u ? visos.filter((x) => x.parent_id === u.id) : []
  const projektoEtapai = projektas ? (etapai[projektas] ?? []) : []

  // Projektai (pasirinkimui) ir pasirinkto projekto etapai — kraunami tik kai reikia.
  useEffect(() => {
    darbai
      .projektai()
      .then(setProjektai)
      .catch(() => setProjektai([]))
  }, [])
  useEffect(() => {
    if (!projektas || etapai[projektas]) return
    darbai
      .projektas(projektas)
      .then((d) => setEtapai((prev) => ({ ...prev, [projektas]: d.sections })))
      .catch(() => setEtapai((prev) => ({ ...prev, [projektas]: [] })))
  }, [projektas, etapai])
  const taisykle = rasytiPakartojima(pakartojimas)
  const vienetas = RUSYS.find((r) => r.reiksme === pakartojimas.rusis)!.vienetas

  // Pasirinkimai priklauso nuo to, ar yra laikas; kitokie (pvz., sukurti asistento) rodomi gale.
  const suLaiku = Boolean(terminas && laikas)
  const pagrindiniai = suLaiku ? PRIMINIMAI_SU_LAIKU : PRIMINIMAI_BE_LAIKO
  const priminimuPasirinkimai = [
    ...pagrindiniai,
    ...priminimai.filter((s) => !pagrindiniai.includes(s) && priminimasTinka(s, suLaiku)),
  ]
  const galiojantys = terminas ? priminimai.filter((s) => priminimasTinka(s, suLaiku)) : []
  const gaus = nariai.some((n) => n.id === atsakingas && n.uses_app)
    ? nariai.filter((n) => n.id === atsakingas)
    : nariai.filter((n) => n.uses_app)

  function keistiSriti(id: number | null) {
    setSritis(id)
    if (!atsakingasParinktas) setAtsakingas(sritys.find((s) => s.id === id)?.default_member_id ?? null)
  }

  async function issaugoti() {
    const centai = sumaCentais(suma)
    if (!pavadinimas.trim()) return setKlaida('Užduočiai reikia pavadinimo.')
    if (Number.isNaN(centai)) return setKlaida('Netinkama suma — rašyk, pvz., 12,50.')
    if (taisykle && !terminas) return setKlaida('Pasikartojančiai užduočiai reikia termino — nuo jo skaičiuojami kiti.')

    const laukai: UzduotiesLaukai = {
      title: pavadinimas,
      areaId: sritis,
      assigneeId: atsakingas,
      priority: prioritetas,
      dueDate: terminas || null,
      dueTime: terminas && laikas ? laikas : null,
      recurrence: taisykle,
      repeatAfterDone: taisykle ? nuoAtlikimo : false,
      amountCents: centai,
      notes: pastabos.trim() || null,
      reminders: galiojantys,
      projectId: projektas,
      sectionId: projektas && projektoEtapai.some((s) => s.id === etapas) ? etapas : null,
    }

    setSaugoma(true)
    setKlaida(null)
    try {
      if (u) {
        await darbai.keisti(u.id, laukai, as)
      } else if (onIssaugoti) {
        await onIssaugoti(laukai, naujosPouzduotys)
      } else {
        const nauja = await darbai.sukurti(laukai, as)
        for (const title of naujosPouzduotys) await darbai.sukurti({ title, parentId: nauja.id }, as)
      }
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setSaugoma(false)
    }
  }

  async function istrinti() {
    if (!u || !confirm(`Ištrinti „${u.title}“? 30 dienų ją dar galėsi atkurti iš šiukšliadėžės.`)) return
    try {
      await darbai.istrinti(u.id)
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  /** Použduočių pakeitimai išsaugomi iškart — jie nepriklauso nuo „Išsaugoti“. */
  async function pouzduociuVeiksmas(darbas: () => Promise<unknown>) {
    try {
      await darbas()
      onPakeista()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  function pridetiPouzduoti() {
    const title = pouzduotis.trim()
    if (!title) return
    setPouzduotis('')
    if (u) void pouzduociuVeiksmas(() => darbai.sukurti({ title, parentId: u.id }, as))
    else setNaujosPouzduotys((prev) => [...prev, title])
  }

  return (
    <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
      <div className="modal uzd-dialogas" role="dialog" aria-label={u ? 'Užduotis' : 'Nauja užduotis'} onClick={(e) => e.stopPropagation()}>
        <h3>{u ? 'Užduotis' : 'Nauja užduotis'}</h3>

        <label>
          Pavadinimas
          <input
            value={pavadinimas}
            onChange={(e) => setPavadinimas(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void issaugoti()}
            placeholder="Ką reikia padaryti?"
            autoFocus={!u}
            maxLength={300}
          />
        </label>

        <div className="uzd-du-laukai">
          <label>
            Sritis
            <select value={sritis ?? ''} onChange={(e) => keistiSriti(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— be srities —</option>
              {sritys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atsakingas
            <select
              value={atsakingas ?? ''}
              onChange={(e) => {
                setAtsakingas(e.target.value ? Number(e.target.value) : null)
                setAtsakingasParinktas(true)
              }}
            >
              <option value="">Bet kas</option>
              {nariai.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="uzd-du-laukai">
          <label>
            Terminas
            <input type="date" value={terminas} onChange={(e) => setTerminas(e.target.value)} />
          </label>
          <label>
            Laikas
            <input type="time" value={laikas} disabled={!terminas} onChange={(e) => setLaikas(e.target.value)} />
          </label>
        </div>
        {terminas && <p className="paaiskinimas">{pilnaData(terminas)}</p>}

        {(projektai.length > 0 || projektas) && (
          <div className="uzd-du-laukai">
            <label>
              Projektas
              <select
                value={projektas ?? ''}
                onChange={(e) => {
                  setProjektas(e.target.value ? Number(e.target.value) : null)
                  setEtapas(null)
                }}
              >
                <option value="">— be projekto —</option>
                {projektai
                  .filter((pr) => pr.status !== 'baigtas' || pr.id === projektas)
                  .map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.title}
                    </option>
                  ))}
              </select>
            </label>
            {projektas && projektoEtapai.length > 0 && (
              <label>
                Etapas
                <select value={etapas ?? ''} onChange={(e) => setEtapas(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— be etapo —</option>
                  {projektoEtapai.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {terminas && (
          <div className="uzd-priminimai">
            <span className="uzd-pouzduotys-antraste">Priminti</span>
            <div className="perjungiklis" role="group" aria-label="Priminti">
              {priminimuPasirinkimai.map((spec) => (
                <button
                  key={spec}
                  type="button"
                  aria-pressed={priminimai.includes(spec)}
                  onClick={() =>
                    setPriminimai((prev) => (prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]))
                  }
                >
                  {priminimoTekstas(spec)}
                </button>
              ))}
            </div>
            {galiojantys.length > 0 && (
              <p className="paaiskinimas">Gaus: {gaus.map((n) => n.name).join(' ir ')} (jei jų telefonuose įjungti pranešimai).</p>
            )}
          </div>
        )}

        <div className="uzd-du-laukai">
          <label>
            Pasikartoja
            <select
              value={pakartojimas.rusis}
              onChange={(e) => setPakartojimas({ ...pakartojimas, rusis: e.target.value as PakartojimoRusis })}
            >
              {RUSYS.map((r) => (
                <option key={r.reiksme} value={r.reiksme}>
                  {r.vardas}
                </option>
              ))}
            </select>
          </label>
          {pakartojimas.rusis !== 'ne' && (
            <label>
              Kas kiek ({vienetas})
              <input
                type="number"
                min={1}
                max={365}
                value={pakartojimas.kasKiek}
                onChange={(e) => setPakartojimas({ ...pakartojimas, kasKiek: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          )}
        </div>

        {pakartojimas.rusis === 'savaite' && (
          <div className="perjungiklis uzd-dienos" role="group" aria-label="Savaitės dienos">
            {DIENU_RAIDES.map((raide, i) => (
              <button
                key={raide}
                type="button"
                aria-pressed={pakartojimas.dienos.includes(i)}
                onClick={() =>
                  setPakartojimas({
                    ...pakartojimas,
                    dienos: pakartojimas.dienos.includes(i)
                      ? pakartojimas.dienos.filter((d) => d !== i)
                      : [...pakartojimas.dienos, i],
                  })
                }
              >
                {raide}
              </button>
            ))}
          </div>
        )}

        {pakartojimas.rusis === 'menuo' && (
          <label>
            Mėnesio diena (tuščia — termino diena)
            <input
              type="number"
              min={1}
              max={31}
              value={pakartojimas.menesioDiena ?? ''}
              onChange={(e) => setPakartojimas({ ...pakartojimas, menesioDiena: Number(e.target.value) || null })}
            />
          </label>
        )}

        {taisykle && (
          <label className="check">
            <input type="checkbox" checked={nuoAtlikimo} onChange={(e) => setNuoAtlikimo(e.target.checked)} />
            Skaičiuoti nuo paskutinio karto (padarius vėliau, kitas kartas pasislenka kartu)
          </label>
        )}
        {taisykle && (
          <p className="paaiskinimas">
            Pasikartoja {pakartojimoTekstas(taisykle)}
            {nuoAtlikimo ? ' nuo paskutinio karto' : ''}. Pažymėjus atlikta, terminas pasislinks į kitą kartą.
          </p>
        )}

        <div className="perjungiklis" role="group" aria-label="Prioritetas">
          {PRIORITETAI.map((p) => (
            <button key={p.reiksme} type="button" aria-pressed={prioritetas === p.reiksme} onClick={() => setPrioritetas(p.reiksme)}>
              {p.vardas}
            </button>
          ))}
        </div>

        <label>
          Suma, € (nebūtina)
          <input inputMode="decimal" value={suma} onChange={(e) => setSuma(e.target.value)} placeholder="pvz., 50" />
        </label>

        <label>
          Pastabos
          <textarea value={pastabos} onChange={(e) => setPastabos(e.target.value)} rows={3} maxLength={5000} />
        </label>

        <div className="uzd-pouzduotys">
          <span className="uzd-pouzduotys-antraste">Použduotys</span>
          <ul>
            {pouzduotys.map((p) => (
              <li key={p.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.status === 'atlikta'}
                    onChange={() =>
                      void pouzduociuVeiksmas(() =>
                        darbai.keisti(p.id, { status: p.status === 'atlikta' ? 'atvira' : 'atlikta' }, as)
                      )
                    }
                  />
                  {p.title}
                </label>
                <button className="ghost small" onClick={() => void pouzduociuVeiksmas(() => darbai.istrinti(p.id))} aria-label={`Pašalinti „${p.title}“`}>
                  ×
                </button>
              </li>
            ))}
            {naujosPouzduotys.map((p, i) => (
              <li key={`nauja-${i}`}>
                <span>{p}</span>
                <button
                  className="ghost small"
                  onClick={() => setNaujosPouzduotys((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Pašalinti „${p}“`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="uzd-prideti">
            <input
              value={pouzduotis}
              onChange={(e) => setPouzduotis(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pridetiPouzduoti()}
              placeholder="Pridėti použduotį…"
              maxLength={300}
            />
            <button className="ghost small" onClick={pridetiPouzduoti} disabled={!pouzduotis.trim()}>
              Pridėti
            </button>
          </div>
        </div>

        {klaida && <p className="error">{klaida}</p>}

        <div className="modal-mygtukai">
          {u && (
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
