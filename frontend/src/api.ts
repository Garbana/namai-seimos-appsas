export type Category = {
  id: number
  name: string
  parent_id: number | null
  type: string
  necessity: string | null
  sort_order: number
  /** Poskyris grupės viduje (pvz., „Būreliai“). */
  subgroup: string | null
}

export type Transaction = {
  id: number
  booking_date: string
  amount_cents: number
  counterparty_name: string | null
  description: string | null
  reference: string | null
  raw_type: string | null
  counterparty_account: string | null
  value_date: string | null
  category_id: number | null
  is_transfer: number
  notes: string | null
  category_name: string | null
  group_name: string | null
  account_owner: string | null
  account_bank: string
  iban_last4: string | null
  parent_id: number | null
  /** Suskaidytos operacijos data banke — jei skiriasi, dalis perkelta į kitą laikotarpį. */
  parent_booking_date: string | null
  rule_id: number | null
  country: string | null
  /** Jei ši įplauka yra sudengimas — kurią išlaidą ji dengia. */
  offset_of_id: number | null
  offset_target_date: string | null
  offset_target_name: string | null
  offset_target_amount: number | null
  /** Išlaidą dengiančių įplaukų suma (teigiama) ir jų sąrašas. */
  offset_cents: number
  offsets: Sudengimas[]
}

export type Sudengimas = {
  id: number
  booking_date: string
  counterparty_name: string | null
  amount_cents: number
  account_owner: string | null
}

export type KreditoGrafikoEilute = {
  seq: number
  due_date: string
  principal_cents: number
  interest_cents: number
  payment_cents: number
  balance_after_cents: number
  paid: boolean
}

export type KreditoGrafikoTaskas = {
  date: string
  balance: number
  payment: number | null
  principal: number | null
  interest: number | null
}

export type KreditoMenesis = { month: string; principal: number; interest: number; total: number }

export type Kreditas = {
  id: number
  kind: string
  name: string
  asset: string | null
  lender: string
  contractNo: string | null
  contractDate: string | null
  endDate: string
  originalCents: number
  rateType: 'kintama' | 'fiksuota'
  ratePct: number
  baseRateName: string | null
  baseRatePct: number | null
  marginPct: number | null
  nextRateChange: string | null
  monthlyPaymentCents: number
  residualCents: number | null
  balanceCents: number
  anchor: { balanceCents: number; date: string; paymentsAfter: number; principalAfterCents: number }
  paidCents: number
  progress: number
  nextPayment: Omit<KreditoGrafikoEilute, 'paid'> | null
  remaining: { count: number; interestCents: number; totalCents: number; monthsLeft: number }
  lastPayment: Omit<KreditoGrafikoEilute, 'paid'> | null
  interestPaid: { cents: number; since: string | null }
  sensitivity: { basePaymentCents: number; variants: { deltaPct: number; paymentCents: number }[] } | null
  residualSavingCents: number | null
  events: { date: string; title: string; amountCents: number | null }[]
  history: (KreditoMenesis & { year: string; months: KreditoMenesis[] })[]
  historySource: 'israsai' | 'grafikas'
  schedule: KreditoGrafikoEilute[]
  chart: KreditoGrafikoTaskas[]
  details: { etikete: string; reiksme: string }[]
  categoryIds: number[]
}

export type DraudimoApsauga = {
  rizika: string
  suma_cents?: number | null
  suma_tekstas?: string | null
  isskaita?: string | null
  iki?: string | null
}

/** PZU investicinio gyvybės draudimo metinės ataskaitos ir savitarnos duomenys. */
export type DraudimoInvesticija = {
  ataskaita: {
    metai: string
    sumoketa_cents: number
    sumoketa_viso_cents: number
    imokos_mokestis_cents: number
    imokos_mokestis_viso_cents: number
    investuota_cents: number
    investuota_viso_cents: number
    mokesciai: { pavadinimas: string; cents: number; viso_cents: number }[]
    kapitalas_pradzioje_cents: number
    kapitalas_pabaigoje_cents: number
    isperkamoji_cents: number
    pelnas_cents: number
    graza_proc: number
    vienetai: number
    vieneto_kaina: number
  }
  savitarna: {
    data: string
    kapitalas_cents: number
    sumoketa_viso_cents: number
    vienetai: number
    vieneto_kaina: number
    graza_12men_proc: number
    pelnas_12men_cents: number
  }
}

export type DraudimoPolisas = {
  policyNo: string
  code: string
  kind: 'gyvybes' | 'kasko' | 'civiline' | 'bustas' | 'kita'
  kindLabel: string
  objectGroup: string
  title: string
  insurer: string
  policyholder: string | null
  insured: string | null
  beneficiary: string | null
  contractStart: string | null
  contractEnd: string | null
  periodStart: string
  periodEnd: string
  status: 'galioja' | 'baigesi' | 'busima'
  premiumCents: number
  securityLevyCents: number
  monthlyCents: number | null
  monthlyEquivalentCents: number
  paymentCategoryId: number | null
  pensionProductCode: string | null
  coverages: DraudimoApsauga[]
  conditions: string[]
  schedule: { data: string; cents: number }[]
  changes: string[]
  notes: string[]
  investment: DraudimoInvesticija | null
  lastPayment: { date: string; cents: number } | null
  nextPayment: { date: string; cents: number; estimated: boolean } | null
  upcoming: {
    periodStart: string
    periodEnd: string
    premiumCents: number
    securityLevyCents: number
    monthlyCents: number | null
    monthlyEquivalentCents: number
    coverages: DraudimoApsauga[]
    changes: string[]
    notes: string[]
  } | null
  sortOrder: number
}

export type Draudimai = {
  today: string
  policies: DraudimoPolisas[]
  events: { date: string; policyNo: string; title: string; amountCents: number | null; note: string | null }[]
  groups: { group: string; monthlyEquivalentCents: number; yearlyCents: number }[]
  totals: {
    activeCount: number
    monthlyEquivalentCents: number
    yearlyCents: number
    monthlyAfterChangesCents: number
    nextChangeDate: string | null
  }
}

/** Grupės ekrano langelis: kategorijos suma per mėnesį. */
export type GrupesLangelis = {
  month: string
  categoryId: number
  categoryName: string
  sortOrder: number
  amount: number
  count: number
  /** 1 — kategorija iš kitos grupės, primesta kaip papildomas pjūvis (pvz. lizingas prie automobilio). */
  related: number
  originGroupName: string | null
  /** Poskyris (pvz., „Būreliai“) — kelios kategorijos po viena antrašte su bendra suma. */
  subgroup: string | null
}

export type PensijuPakopa = 'II' | 'III' | 'PZU'

export type PensijosImoka = {
  date: string
  cents: number
  payer: string
  portfolio: string
  /**
   * ataskaita — iš fondo ataskaitos, bankas — banko nurašymas, excel — mėnesio suma
   * iš Excel istorijos, apytiksle — pagal planą.
   */
  source: 'ataskaita' | 'bankas' | 'excel' | 'apytiksle'
}

export type PensijuProduktas = {
  id: number
  code: string
  owner: string
  pillar: PensijuPakopa
  name: string
  provider: string | null
  fundLabel: string | null
  contractNo: string | null
  startDate: string | null
  endDate: string | null
  valuation: 'vienetai' | 'rankinis'
  /** Banko operacijų kategorija, į kurią patenka šio produkto įmokos. */
  contributionCategoryId: number | null
  valueCents: number | null
  valueDate: string | null
  valueEstimated: boolean
  holdings: {
    portfolio: string
    isin: string
    fundName: string
    units: number
    price: number
    priceDate: string
    priceSource: string | null
    valueCents: number
    estimated: boolean
  }[]
  monthlyContributionCents: number | null
  contributions: {
    totalCents: number
    since: string | null
    estimatedCents: number
    years: { year: string; cents: number }[]
    recent: PensijosImoka[]
  }
  transfersCents: number
  returns: {
    since: string
    startValueCents: number
    contributedCents: number
    gainCents: number
    xirr: number | null
    lifetime: { contributedCents: number; gainCents: number; since: string | null } | null
  } | null
  last12: { contributedCents: number; gainCents: number | null; startValueCents: number | null }
  valuations: { id: number; date: string; valueCents: number; source: 'rankinis' | 'excel' | 'ataskaita'; note: string | null }[]
  details: { etikete: string; reiksme: string }[]
  /** portfolio — jei lengvatai tinka tik ši sutarties dalis (pvz. „Papildoma"). */
  gpm: { payer: string; paidCents: number; projectedCents: number; portfolio: string | null } | null
}

export type FonduKainuAtnaujinimas = {
  at: string
  results: {
    isin: string
    fundName: string
    provider: 'SEB' | 'Swedbank'
    ok: boolean
    price?: number
    date?: string
    error?: string
  }[]
}

export type Pensijos = {
  today: string
  groupId: number | null
  refreshingPrices: boolean
  products: PensijuProduktas[]
  history: {
    months: string[]
    series: { code: string; owner: string; pillar: PensijuPakopa; name: string; points: (number | null)[] }[]
  }
  people: {
    owner: string
    birthDate: string
    payoutDate: string
    monthsToPayout: number
    valueCents: number
    monthlyContributionCents: number
  }[]
  funds: {
    isin: string
    fundName: string
    price: number | null
    date: string | null
    source: string | null
    returns: { y1: number | null; y3: number | null; y5: number | null }
  }[]
  gpm: { year: string; rate: number; limitCents: number; deadline: string }
  priceUpdate: (FonduKainuAtnaujinimas & { updatedAt: string }) | null
}

export type TaupymoIrasas = {
  id: number
  date: string
  /** Teigiama — įnašas, neigiama — išėmimas. */
  cents: number
  kind: 'inasas' | 'isemimas' | 'palukanos'
  /** `kategorija` — įrašas suskaičiuotas iš operacijos, o ne įvestas ranka. */
  source: 'pervedimas' | 'rankinis' | 'excel' | 'kategorija'
  transactionId: number | null
  note: string | null
}

export type TaupymoFondoPirkimas = {
  id: number
  date: string
  units: number
  unitPrice: number
  cents: number
  source: 'rankinis' | 'israsas'
}

export type TaupymoFondas = {
  id: number
  symbol: string
  name: string
  units: number
  investedCents: number
  price: number | null
  priceDate: string | null
  valueCents: number
  gainCents: number | null
  /** Grąža procentais nuo investuotos sumos. */
  gainPct: number | null
  purchases: TaupymoFondoPirkimas[]
}

export type TaupymoTikslas = {
  id: number
  code: string
  name: string
  owner: string
  kind: 'rezervas' | 'investicijos' | 'tikslas'
  whereKept: string | null
  note: string | null
  targetCents: number | null
  targetDate: string | null
  monthlyPlanCents: number | null
  valueCents: number
  /** Kategorija, kurios operacijos pačios tampa šio katiliuko įnašais. */
  categoryId: number | null
  interestCategoryId: number | null
  /** Vienetuose laikoma dalis, dar neinvestuoti pinigai ir kiek už vienetus sumokėta. */
  fundsValueCents: number
  cashCents: number
  investedCents: number
  gainPct: number | null
  funds: TaupymoFondas[]
  /** Portfelio vertė pagal dienas — grafikui. */
  chart: { date: string; valueCents: number }[]
  /** true — po paskutinės įvestos vertės pridėti tik įnašai, rinkos pokytis nežinomas. */
  valueEstimated: boolean
  lastValuation: { id: number; date: string; valueCents: number } | null
  contributedCents: number
  withdrawnCents: number
  interestCents: number
  netCents: number
  /** null — tikros vertės dar neįvesta, tad uždarbio nėra iš ko skaičiuoti. */
  gainCents: number | null
  thisMonthCents: number
  progress: number | null
  leftCents: number | null
  monthsLeft: number | null
  neededMonthlyCents: number | null
  history: { month: string; cents: number; balanceCents: number }[]
  entries: TaupymoIrasas[]
  valuations: { id: number; date: string; valueCents: number; source: string; note: string | null }[]
}

/** Dar nepriskirtas vidinis pervedimas. */
export type TaupymoKandidatas = {
  id: number
  date: string
  amountCents: number
  centsIfAssigned: number
  counterpartyName: string | null
  description: string | null
  accountOwner: string | null
  ibanLast4: string | null
  suggestedCode: string | null
  suggestedName: string | null
}

export type ETFKainuAtnaujinimas = {
  at: string
  updatedAt?: string
  results: { symbol: string; name: string; ok: boolean; price?: number; date?: string; added?: number; error?: string }[]
}

export type Taupymas = {
  today: string
  month: string
  goals: TaupymoTikslas[]
  candidates: TaupymoKandidatas[]
  /** true — kainos šiuo metu atnaujinamos fone. */
  refreshingPrices?: boolean
  priceUpdate?: ETFKainuAtnaujinimas | null
  totals: {
    valueCents: number
    fundsValueCents: number
    cashCents: number
    investedCents: number
    contributedCents: number
    withdrawnCents: number
    interestCents: number
    gainCents: number | null
    gainPct: number | null
    thisMonthCents: number
    monthlyPlanCents: number
    unassignedCount: number
  }
}

/** Vienos grupės biudžeto riba ir kaip ji laikoma šį mėnesį. */
export type BiudzetoEilute = {
  categoryId: number
  name: string
  /** null — riba nenustatyta. */
  plannedCents: number | null
  /** 'numatyta' arba 'YYYY-MM', jei riba nustatyta tik šiam mėnesiui. */
  periodas: string | null
  spentCents: number
  pct: number | null
  leftCents: number | null
  /** Kiek turėtų būti išleista, jei tempas tolygus per visą mėnesį. */
  tempasCents: number | null
  /** Kiek išeis mėnesio gale, jei tempas nesikeis. */
  prognozeCents: number
  busena: 'gerai' | 'baigiasi' | 'virsyta' | 'neribota'
}

export type BiudzetoRibos = {
  month: string
  today: string
  dienos: { praejo: number; viso: number; dalis: number }
  eilutes: BiudzetoEilute[]
  /** Visos išlaidų grupės — iš ko rinktis pridedant naują ribą. */
  grupes: { id: number; name: string }[]
  paskirstymas: {
    necessity: string
    name: string
    cents: number
    dalis: number
    tikslas: number
  }[]
  totals: {
    plannedCents: number
    spentCents: number
    beRibosCents: number
    spentWithLimitCents: number
    pct: number | null
    tempasCents: number
    virsytos: number
    beRibos: number
  }
}

/** Vienas reguliarus mokėjimas šį mėnesį. */
export type Priminimas = {
  source: 'kategorija' | 'taupymas'
  ref: string
  categoryId: number
  name: string
  groupId: number
  groupName: string
  priority: number
  expectedCents: number
  /** false — suma kas mėnesį kitokia (komunaliniai), tad tai tik orientyras. */
  fixed: boolean
  minCents: number
  maxCents: number
  paidCents: number
  leftCents: number
  dueDay: number | null
  dueDate: string | null
  state: 'sumoketa' | 'dalinai' | 'laukiama' | 'neapmoketa'
  /** Iki kurios dienos matomi tos sąskaitos, iš kurios mokama, nurašymai. */
  knownThrough: string
  lastPaid: string | null
  monthsPaid: number
  /** Iš kur laukiama suma: rankinė, sutarties grafikas ar istorijos vidurkis. */
  basis: 'rankinis' | 'grafikas' | 'istorija'
  manual: boolean
  note: string | null
}

export type Priminimai = {
  today: string
  month: string
  /** Iki kurios dienos duomenys tikri — vėliau nurašymų tiesiog dar neįkelta. */
  dataThrough: string | null
  /** Kieno išrašai kiek seni — seniausi pirma. */
  sources: { owner: string; through: string }[]
  items: Priminimas[]
  totals: {
    count: number
    paidCount: number
    lateCount: number
    expectedCents: number
    paidCents: number
    leftCents: number
  }
}

export type Rule = {
  id: number
  priority: number
  field: string
  operator: string
  value: string
  category_id: number | null
  owner_category_name: string | null
  mark_transfer: number
  direction: 'D' | 'C' | null
  country_scope: 'lt' | 'foreign' | null
  amount_min_cents: number | null
  amount_max_cents: number | null
  is_active: number
  note: string | null
  category_name: string | null
  group_name: string | null
  pritaikyta: number
}

export type TransactionList = {
  rows: Transaction[]
  totals: { count: number; income: number; expense: number }
}

const MENESIAI = [
  'sausis', 'vasaris', 'kovas', 'balandis', 'gegužė', 'birželis',
  'liepa', 'rugpjūtis', 'rugsėjis', 'spalis', 'lapkritis', 'gruodis',
]

const MENESIAI_TRUMPAI = [
  'saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.',
  'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.',
]

/** „2026-07" -> „liepa 2026" arba „liep. 26". */
export function menuoVardas(month: string, trumpai = false) {
  const [metai, men] = month.split('-')
  const i = Number(men) - 1
  return trumpai ? `${MENESIAI_TRUMPAI[i]} ${metai.slice(2)}` : `${MENESIAI[i]} ${metai}`
}

export const eur = (cents: number) =>
  new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok) throw new Error((data as { klaida?: string }).klaida ?? 'Nepavyko įvykdyti veiksmo.')
  return data as T
}

export const api = {
  categories: () => request<Category[]>('/api/categories'),

  createCategory: (body: { name: string; parentId: number; subgroup?: string | null }) =>
    request<Category>('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  transactions: (params: Record<string, string>) =>
    request<TransactionList>(`/api/transactions?${new URLSearchParams(params)}`),

  updateTransactions: (body: { ids: number[]; categoryId?: number | null; isTransfer?: boolean }) =>
    request<{ changed: number }>('/api/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  createRule: (body: {
    field: string
    operator: string
    value: string
    categoryId?: number | null
    markTransfer?: boolean
    applyToExisting?: boolean
    note?: string
  }) =>
    request<{ id: number; applied: number }>('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  overview: () =>
    request<{
      months: { month: string; income: number; expense: number }[]
      cells: {
        month: string
        groupId: number | null
        groupName: string
        side: 'income' | 'expense'
        amount: number
        count: number
      }[]
    }>('/api/overview'),

  credits: () => request<Kreditas[]>('/api/credits'),

  pensions: () => request<Pensijos>('/api/pensions'),

  insurance: () => request<Draudimai>('/api/insurance'),

  savings: () => request<Taupymas>('/api/savings'),

  addSavingsEntry: (
    code: string,
    body: { transactionId?: number; date?: string; cents?: number; kind?: string; note?: string | null }
  ) =>
    request<{ ok: true }>(`/api/savings/${code}/irasai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteSavingsEntry: (id: number) => request<{ ok: true }>(`/api/savings/irasai/${id}`, { method: 'DELETE' }),

  addSavingsValue: (code: string, body: { date: string; valueCents: number; note?: string | null }) =>
    request<{ ok: true }>(`/api/savings/${code}/vertes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteSavingsValue: (id: number) => request<{ ok: true }>(`/api/savings/vertes/${id}`, { method: 'DELETE' }),

  refreshSavingsPrices: () => request<ETFKainuAtnaujinimas>('/api/savings/kainos', { method: 'POST' }),

  addSavingsFund: (code: string, body: { symbol: string; name: string }) =>
    request<{ ok: true }>(`/api/savings/${code}/fondai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  addSavingsPurchase: (
    code: string,
    body: { symbol: string; date: string; units: number; unitPrice: number; cents?: number }
  ) =>
    request<{ ok: true }>(`/api/savings/${code}/pirkimai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteSavingsPurchase: (id: number) =>
    request<{ ok: true }>(`/api/savings/pirkimai/${id}`, { method: 'DELETE' }),

  createSavingsGoal: (body: {
    name: string
    owner: string
    kind: string
    whereKept?: string | null
    targetCents?: number | null
    targetDate?: string | null
    monthlyPlanCents?: number | null
    note?: string | null
  }) =>
    request<TaupymoTikslas>('/api/savings/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateSavingsGoal: (
    code: string,
    body: {
      name?: string
      whereKept?: string | null
      targetCents?: number | null
      targetDate?: string | null
      monthlyPlanCents?: number | null
      note?: string | null
      isActive?: boolean
    }
  ) =>
    request<{ ok: true }>(`/api/savings/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  budgets: (menuo?: string) =>
    request<BiudzetoRibos>(`/api/budgets${menuo ? `?menuo=${menuo}` : ''}`),

  /** Nulinė suma ribą panaikina. */
  saveBudget: (body: {
    categoryId: number
    period?: string
    plannedCents: number
    note?: string | null
  }) =>
    request<{ ok: true }>('/api/budgets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  reminders: () => request<Priminimai>('/api/reminders'),

  saveReminder: (
    source: string,
    ref: string,
    body: { isActive?: boolean; expectedCents?: number | null; dueDay?: number | null; note?: string | null }
  ) =>
    request<{ ok: true }>(`/api/reminders/${source}/${ref}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  refreshPensionPrices: () =>
    request<FonduKainuAtnaujinimas>('/api/pensions/kainos', { method: 'POST' }),

  addPensionValue: (code: string, body: { date: string; valueCents: number; note?: string }) =>
    request<{ ok: true }>(`/api/pensions/${code}/vertes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deletePensionValue: (id: number) =>
    request<{ ok: true }>(`/api/pensions/vertes/${id}`, { method: 'DELETE' }),

  setPensionUnits: (code: string, body: { portfolio: string; isin: string; units: number; unitsDate: string }) =>
    request<{ ok: true }>(`/api/pensions/${code}/vienetai`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  groupOverview: (groupId: number) => request<GrupesLangelis[]>(`/api/overview/group/${groupId}`),

  rules: () => request<Rule[]>('/api/rules'),

  setRuleActive: (id: number, isActive: boolean) =>
    request<{ ok: true }>(`/api/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    }),

  applyRule: (id: number) =>
    request<{ applied: number }>(`/api/rules/${id}/apply`, { method: 'POST' }),

  deleteRule: (id: number) => request<{ ok: true }>(`/api/rules/${id}`, { method: 'DELETE' }),

  splitTransaction: (
    id: number,
    parts: { categoryId: number | null; amountCents: number; bookingDate?: string }[]
  ) =>
    request<{ created: number }>(`/api/transactions/${id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    }),

  unsplitTransaction: (parentId: number) =>
    request<{ ok: true }>(`/api/transactions/${parentId}/split`, { method: 'DELETE' }),

  linkOffsets: (expenseId: number, incomeIds: number[]) =>
    request<{ linked: number }>(`/api/transactions/${expenseId}/offsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incomeIds }),
    }),

  unlinkOffset: (incomeId: number) =>
    request<{ ok: true }>(`/api/transactions/${incomeId}/offset`, { method: 'DELETE' }),

  backups: () => request<{ items: AtsargineKopija[]; state: KopijuBusena }>('/api/backups'),

  createBackup: () => request<AtsargineKopija>('/api/backups', { method: 'POST' }),

  /** Be rakto — dabartinė kopija, sugeneruojama čia pat; su raktu — išsaugota KV. */
  downloadBackup: (key?: string) =>
    downloadFile(key ? `/api/backups/file?key=${encodeURIComponent(key)}` : '/api/backups/current'),
}

export type AtsargineKopija = {
  key: string
  createdAt: string
  kind: 'auto' | 'rankine'
  bytes: number
  rows: number
  tables: number
  schema: string | null
}

export type KopijuBusena = {
  lastAttemptAt: string | null
  lastOkAt: string | null
  lastError: string | null
  lastDownloadAt: string | null
}

/**
 * Parsisiunčia failą per fetch, o ne paprasta nuoroda: jei serveris grąžina klaidą,
 * ji parodoma appse, o ne išsaugoma kaip neva tinkamas failas.
 */
async function downloadFile(url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { klaida?: string }
    throw new Error(data.klaida ?? 'Nepavyko parsisiųsti.')
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'kopija.sql'
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  // Atlaisvinti iškart negalima — kai kurios naršyklės tada nutraukia parsisiuntimą.
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/** „Bendros išlaidos / Kavinės" — kad sąrašuose būtų aišku, kur kategorija priklauso. */
export function categoryLabeller(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  return (id: number | null) => {
    if (id === null) return null
    const category = byId.get(id)
    if (!category) return null
    const parent = category.parent_id ? byId.get(category.parent_id) : null
    return parent ? `${parent.name} / ${category.name}` : category.name
  }
}

/** Kategorijos pasirinkimui: grupės su savo vaikais, tvarkinga eilė. */
export function groupedCategories(categories: Category[]) {
  const groups = categories.filter((c) => c.parent_id === null)
  return groups.map((group) => ({
    group,
    children: categories.filter((c) => c.parent_id === group.id),
  }))
}
