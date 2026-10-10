import { useCallback, useEffect, useState } from 'react'
import { api, eur, type Rule } from './api'

const LAUKAI: Record<string, string> = {
  any: 'gavėjas arba paskirtis',
  counterparty: 'gavėjas',
  description: 'paskirtis',
  amount: 'suma',
}

const OPERATORIAI: Record<string, string> = {
  contains: 'turi tekstą',
  equals: 'lygu',
  regex: 'atitinka šabloną',
  range: 'patenka į rėžį',
}

export default function Taisykles() {
  const [rules, setRules] = useState<Rule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [zinute, setZinute] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRules(await api.rules())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko užkrauti taisyklių.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function veiksmas(fn: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      setZinute(await fn())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko įvykdyti veiksmo.')
    } finally {
      setBusy(false)
    }
  }

  function taikinys(rule: Rule) {
    if (rule.mark_transfer) return 'pažymi vidiniu pervedimu'
    if (rule.owner_category_name) {
      return `${rule.owner_category_name} (pagal sąskaitos savininką)`
    }
    return rule.group_name ? `${rule.group_name} / ${rule.category_name}` : (rule.category_name ?? '—')
  }

  function salygos(rule: Rule) {
    const dalys: string[] = []
    if (rule.country_scope === 'foreign') dalys.push('tik užsienyje')
    if (rule.country_scope === 'lt') dalys.push('tik Lietuvoje')
    if (rule.direction === 'D') dalys.push('tik išlaidos')
    if (rule.direction === 'C') dalys.push('tik pajamos')
    if (rule.amount_min_cents !== null) dalys.push(`nuo ${eur(rule.amount_min_cents)}`)
    if (rule.amount_max_cents !== null) dalys.push(`iki ${eur(rule.amount_max_cents)}`)
    return dalys
  }

  return (
    <section>
      <p className="paaiskinimas">
        Taisyklės tikrinamos iš eilės — pirma suveikusi laimi. Išjungta taisyklė lieka sąraše,
        bet nebeveikia. Ištrynus taisyklę jos jau priskirtos kategorijos nedingsta.
      </p>

      {error && <p className="error">{error}</p>}
      {zinute && <p className="done">{zinute}</p>}

      <div className="table-wrap">
        <table className="korteles">
          <thead>
            <tr>
              <th className="tight">Eilė</th>
              <th>Kada suveikia</th>
              <th>Priskiria</th>
              <th className="num">Pritaikyta</th>
              <th className="tight"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className={rule.is_active ? undefined : 'isjungta'}>
                <td className="tight">{rule.priority}</td>
                <td>
                  <div className="taisykles-salyga">
                    <code>{rule.value}</code>
                  </div>
                  <div className="taisykles-meta">
                    {LAUKAI[rule.field] ?? rule.field} {OPERATORIAI[rule.operator] ?? rule.operator}
                    {salygos(rule).map((s) => (
                      <span key={s} className="tag">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{taikinys(rule)}</td>
                <td className="num">{rule.pritaikyta}</td>
                <td className="tight nowrap">
                  <button
                    className="ghost small"
                    disabled={busy}
                    onClick={() =>
                      veiksmas(async () => {
                        const applied = await api.applyRule(rule.id)
                        return `Pritaikyta dar nepriskirtoms operacijoms: ${applied.applied}.`
                      })
                    }
                    title="Pritaikyti šią taisyklę jau importuotoms nepriskirtoms operacijoms"
                  >
                    pritaikyti
                  </button>
                  <button
                    className="ghost small"
                    disabled={busy}
                    onClick={() =>
                      veiksmas(async () => {
                        await api.setRuleActive(rule.id, !rule.is_active)
                        return rule.is_active ? 'Taisyklė išjungta.' : 'Taisyklė įjungta.'
                      })
                    }
                  >
                    {rule.is_active ? 'išjungti' : 'įjungti'}
                  </button>
                  <button
                    className="ghost small pavojinga"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Ištrinti taisyklę „${rule.value}"?`)) return
                      veiksmas(async () => {
                        await api.deleteRule(rule.id)
                        return 'Taisyklė ištrinta.'
                      })
                    }}
                  >
                    ištrinti
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rules.length === 0 && <p className="tuscia">Taisyklių dar nėra.</p>}
    </section>
  )
}
