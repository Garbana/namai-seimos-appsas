-- Visa appso duomenų bazės schema (lentelės ir indeksai, be duomenų).
-- Pradiniai bendriniai duomenys — 0002_pradiniai_duomenys.sql; šeima (nariai, jų finansų
-- grupės) — generuojama `node scripts/sukurti-seima.mjs` pagal seima.json (žr. AGENTS.md).
-- Naujus pakeitimus rašyk naujose migracijose (0003_…), šio failo nekeisk.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank TEXT NOT NULL CHECK (bank IN ('swedbank', 'seb')),
  name TEXT NOT NULL,
  iban_last4 TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, owner TEXT, iban_hash TEXT);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  necessity TEXT CHECK (necessity IN ('butinosios', 'norai', 'taupymas')),
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
, subgroup TEXT);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  booking_date TEXT NOT NULL,
  value_date TEXT,
  -- Suma centais: teigiama = pajamos, neigiama = išlaidos.
  -- Centai (INTEGER), kad sumuojant nesikauptų slankiojo kablelio paklaidos.
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  counterparty_name TEXT,
  counterparty_account TEXT,
  description TEXT,
  reference TEXT,
  raw_type TEXT,
  category_id INTEGER REFERENCES categories(id),
  is_transfer INTEGER NOT NULL DEFAULT 0,
  is_split_parent INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES transactions(id),
  -- Hash iš datos + sumos + aprašymo + sąskaitos. Apsauga nuo dublikatų
  -- kartotinio importo metu. Skaidymo vaikinės eilutės fingerprint neturi.
  fingerprint TEXT,
  source TEXT NOT NULL DEFAULT 'csv' CHECK (source IN ('csv', 'api', 'manual')),
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
, country TEXT, rule_id INTEGER REFERENCES rules(id), offset_of_id INTEGER REFERENCES transactions(id));

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  period TEXT NOT NULL,
  planned_cents INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority INTEGER NOT NULL DEFAULT 100,
  -- 'any' tikrina gavėją ir paskirtį kartu: pavadinimas gali būti bet kuriame.
  field TEXT NOT NULL CHECK (field IN ('any', 'counterparty', 'description', 'amount')),
  operator TEXT NOT NULL CHECK (operator IN ('contains', 'equals', 'regex', 'range')),
  value TEXT NOT NULL,
  -- Taikinys: arba konkreti kategorija, arba tokio pavadinimo kategorija
  -- sąskaitos savininko grupėje (pvz. „Bolt" -> Jonas/Bolt arba Rūta/Bolt),
  -- arba operacija pažymima kaip vidinis pervedimas.
  category_id INTEGER REFERENCES categories(id),
  owner_category_name TEXT,
  mark_transfer INTEGER NOT NULL DEFAULT 0,
  -- Papildoma sąlyga: taikyti tik išlaidoms ('D') arba tik pajamoms ('C').
  direction TEXT CHECK (direction IN ('D', 'C')),
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, country_scope TEXT CHECK (country_scope IN ('lt', 'foreign')), amount_min_cents INTEGER, amount_max_cents INTEGER);

CREATE TABLE credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('busto_paskola', 'lizingas')),
  name TEXT NOT NULL,
  asset TEXT,
  lender TEXT NOT NULL,
  contract_no TEXT UNIQUE,
  contract_date TEXT,
  end_date TEXT NOT NULL,
  original_cents INTEGER NOT NULL,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('kintama', 'fiksuota')),
  -- Normos procentais (3.663 = 3,663 %). Tai ne pinigai, tad REAL tinka.
  rate_pct REAL NOT NULL,
  base_rate_name TEXT,
  base_rate_pct REAL,
  margin_pct REAL,
  next_rate_change TEXT,
  monthly_payment_cents INTEGER NOT NULL,
  residual_cents INTEGER,
  balance_cents INTEGER NOT NULL,
  balance_date TEXT NOT NULL,
  principal_category_id INTEGER REFERENCES categories(id),
  interest_category_id INTEGER REFERENCES categories(id),
  payment_category_id INTEGER REFERENCES categories(id),
  -- JSON: [{"etikete", "reiksme", "data"?, "ivykis"?}] — sutarties duomenys;
  -- įrašai su data rodomi kaip artėjantys įvykiai (pvz. KASKO pabaiga).
  details TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE credit_schedule (
  credit_id INTEGER NOT NULL REFERENCES credits(id),
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  principal_cents INTEGER NOT NULL,
  interest_cents INTEGER NOT NULL,
  payment_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  PRIMARY KEY (credit_id, seq)
);

CREATE TABLE pension_people (
  owner TEXT PRIMARY KEY,
  birth_date TEXT NOT NULL,
  payout_date TEXT NOT NULL
);

CREATE TABLE pension_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  pillar TEXT NOT NULL CHECK (pillar IN ('II', 'III', 'PZU')),
  name TEXT NOT NULL,
  provider TEXT,
  fund_label TEXT,
  contract_no TEXT,
  start_date TEXT,
  end_date TEXT,
  valuation TEXT NOT NULL CHECK (valuation IN ('vienetai', 'rankinis')),
  monthly_contribution_cents INTEGER,
  contribution_day INTEGER,
  -- Banko operacijų kategorija, iš kurios imamos įmokos (pvz. „Pensija III pakopa (Rūta)").
  contribution_category_id INTEGER REFERENCES categories(id),
  -- Ar įmokoms taikoma GPM lengvata (III pakopa).
  gpm INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
, gpm_portfolio TEXT, gpm_payer TEXT);

CREATE TABLE pension_holdings (
  product_id INTEGER NOT NULL REFERENCES pension_products(id),
  portfolio TEXT NOT NULL DEFAULT '',
  isin TEXT NOT NULL,
  fund_name TEXT NOT NULL,
  price_source TEXT,
  units REAL,
  units_date TEXT,
  share REAL NOT NULL DEFAULT 1,
  portfolio_monthly_cents INTEGER,
  PRIMARY KEY (product_id, portfolio, isin)
);

CREATE TABLE pension_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES pension_products(id),
  portfolio TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('imoka', 'perkelimas')),
  amount_cents INTEGER NOT NULL,
  isin TEXT,
  units REAL,
  price REAL
);

CREATE TABLE pension_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES pension_products(id),
  date TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  -- Jei ataskaita nurodo, kiek iš viso sumokėta nuo sutarties pradžios.
  contributed_total_cents INTEGER,
  source TEXT NOT NULL CHECK (source IN ('rankinis', 'excel', 'ataskaita')),
  note TEXT,
  UNIQUE (product_id, date)
);

CREATE TABLE fund_prices (
  isin TEXT NOT NULL,
  date TEXT NOT NULL,
  price REAL NOT NULL,
  source TEXT,
  PRIMARY KEY (isin, date)
);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE group_related_categories (
  group_id INTEGER NOT NULL REFERENCES categories(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, category_id)
);

CREATE TABLE insurance_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  policy_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gyvybes', 'kasko', 'civiline', 'bustas', 'kita')),
  -- Kam priklauso: žmogus ar turtas (Jonas, Rūta, Ema, Automobilis, Būstas).
  object_group TEXT NOT NULL,
  title TEXT NOT NULL,
  insurer TEXT NOT NULL,
  policyholder TEXT,
  insured TEXT,
  beneficiary TEXT,
  -- Visos sutarties terminas (gyvybės draudimui); metinėms sutartims NULL.
  contract_start TEXT,
  contract_end TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  -- Laikotarpio kaina su saugumo įnašu.
  premium_cents INTEGER NOT NULL,
  security_levy_cents INTEGER NOT NULL DEFAULT 0,
  monthly_cents INTEGER,
  payment_category_id INTEGER REFERENCES categories(id),
  -- PZU investicinė dalis — sukaupta suma rodoma ir pensijų skiltyje.
  pension_product_code TEXT,
  coverages TEXT NOT NULL DEFAULT '[]',
  conditions TEXT NOT NULL DEFAULT '[]',
  schedule TEXT NOT NULL DEFAULT '[]',
  changes TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  investment TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recurring_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('kategorija', 'taupymas')),
  ref TEXT NOT NULL,
  -- 1 — rodyti visada (net jei automatika nerado), 0 — nerodyti niekada.
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  -- Rankiniai patikslinimai; NULL — skaičiuoti iš istorijos.
  expected_cents INTEGER,
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  note TEXT,
  UNIQUE (source, ref)
);

CREATE TABLE savings_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rezervas', 'investicijos', 'tikslas')),
  -- Kur pinigai realiai laikomi: „E. taupyklė (Swedbank indėlis)", „Revolut ETF".
  where_kept TEXT,
  target_cents INTEGER,
  target_date TEXT,
  monthly_plan_cents INTEGER,
  -- Raktažodžiai (JSON masyvas) pervedimams atpažinti, pvz. ["investavimui"].
  match_keywords TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
, category_id INTEGER REFERENCES categories(id), interest_category_id INTEGER REFERENCES categories(id));

CREATE TABLE savings_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  -- Teigiama — įnašas, neigiama — išėmimas.
  cents INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'inasas' CHECK (kind IN ('inasas', 'isemimas', 'palukanos')),
  -- Viena banko operacija gali būti priskirta tik vienam katiliukui.
  transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('pervedimas', 'rankinis', 'excel')),
  note TEXT
);

CREATE TABLE savings_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('rankinis', 'excel')),
  note TEXT,
  UNIQUE (goal_id, date)
);

CREATE TABLE savings_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  -- Yahoo Finance simbolis, pvz. „VUAA.DE" (XETRA, eurais).
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  price_source TEXT NOT NULL DEFAULT 'yahoo',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (goal_id, symbol)
);

CREATE TABLE savings_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL REFERENCES savings_funds(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  units REAL NOT NULL,
  unit_price REAL NOT NULL,
  -- Kiek sumokėta (centai) — turi sutapti su vienetai × kaina.
  cents INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('rankinis', 'israsas')),
  note TEXT
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  -- El. paštai (JSON masyvas), kuriais žmogus prisijungia per Access. Bendro pašto
  -- čia nėra — tada appsas klausia, kas naudoja įrenginį.
  emails TEXT NOT NULL DEFAULT '[]',
  -- 0 — appsu nesinaudoja (Ema): darbą priskirti galima, prisijungimo nėra.
  uses_app INTEGER NOT NULL DEFAULT 1 CHECK (uses_app IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  default_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  -- Použduotis (kontrolinio sąrašo punktas) — tik vienas lygis.
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  area_id INTEGER REFERENCES task_areas(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'iprasta' CHECK (priority IN ('svarbu', 'iprasta', 'kada_nors')),
  status TEXT NOT NULL DEFAULT 'atvira' CHECK (status IN ('atvira', 'atlikta')),
  -- Vietinė data ir laikas (Vilnius), be laiko juostos: '2026-10-16', '15:00'.
  -- Taip 15:00 lieka 15:00 ir po vasaros laiko pakeitimo.
  due_date TEXT,
  due_time TEXT,
  -- Pakartojimas — RRULE poaibis, pvz. 'FREQ=WEEKLY;BYDAY=SA'. Užbaigus užduotis
  -- nekuriama iš naujo: pasislenka terminas, o atlikimas įrašomas į task_completions.
  recurrence TEXT,
  amount_cents INTEGER,
  completed_at TEXT,
  completed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'rankinis' CHECK (source IN ('rankinis', 'ai', 'claude', 'automatinis')),
  -- Minkštas trynimas: 30 d. šiukšliadėžėje, paskui ištrinama visam laikui.
  deleted_at TEXT
, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, section_id INTEGER REFERENCES project_sections(id) ON DELETE SET NULL, chore INTEGER NOT NULL DEFAULT 0, rotation_members TEXT, repeat_after_done INTEGER NOT NULL DEFAULT 0);

CREATE TABLE task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  completed_at TEXT NOT NULL,
  due_date_before TEXT,
  -- JSON [{ "id": 5, "status": "atlikta" }, ...]
  subtasks_before TEXT
, assignee_before INTEGER);

CREATE TABLE shopping_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE shopping_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  added_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL,
  checked_at TEXT,
  checked_by INTEGER REFERENCES members(id) ON DELETE SET NULL
, section TEXT);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_reminders (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  spec TEXT,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  remind_at TEXT,
  sent_at TEXT,
  UNIQUE (task_id, spec)
);

CREATE TABLE push_outbox (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE ai_requests (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  reply TEXT,
  content_json TEXT,
  actions_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('klaida', 'nepatogu', 'ideja', 'asistentas')),
  text TEXT NOT NULL DEFAULT '',
  -- Kuriame appso ekrane buvo žmogus (jei žinoma).
  screen TEXT,
  -- Asistento pokalbio ištrauka (klausimas, atsakymas, veiksmai) — išlieka, net kai
  -- ai_requests įrašas po 90 d. ištrinamas.
  details TEXT,
  ai_request_id INTEGER REFERENCES ai_requests(id) ON DELETE SET NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'nauja' CHECK (status IN ('nauja', 'sutvarkyta', 'atmesta')),
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  -- Tikslas ar trumpas aprašymas („Gimtadienis žaidimų kambaryje, ~15 vaikų“).
  goal TEXT,
  area_id INTEGER REFERENCES task_areas(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  -- Šventės, kelionės ar pabaigos data (vietinė, 'YYYY-MM-DD').
  target_date TEXT,
  -- Viso projekto biudžetas (tikslas); eilutės — project_costs.
  budget_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'aktyvus' CHECK (status IN ('aktyvus', 'baigtas', 'atidetas')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'rankinis' CHECK (source IN ('rankinis', 'ai', 'claude', 'sablonas')),
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  finished_at TEXT,
  deleted_at TEXT
, savings_goal_id INTEGER REFERENCES savings_goals(id) ON DELETE SET NULL);

CREATE TABLE project_sections (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_costs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  planned_cents INTEGER,
  actual_cents INTEGER,
  is_estimate INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
, manual_actual_cents INTEGER);

CREATE TABLE claude_jungtys (
  id INTEGER PRIMARY KEY,
  -- SHA-256 nuo vienkartinio „state“, kurį Claude jungties Worker'is įdeda į nuorodą į appsą
  -- (pats „state“ nesaugomas — be naršyklės slapuko jis vis tiek nieko neatrakina).
  state_hash TEXT NOT NULL UNIQUE,
  -- Kas jungiasi (programos pavadinimas, kaip ji prisistatė) ir kur bus išsiųstas raktas.
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_host TEXT NOT NULL,
  -- 1 — raktas keliauja programai šiame kompiuteryje (localhost): leisti tik jei ką tik jungei pats.
  local_app INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'laukia' CHECK (status IN ('laukia', 'leista', 'atmesta', 'prijungta', 'atjungta')),
  -- Kieno vardu Claude dirbs („aš“ = šis narys).
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  connected_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE shopping_sections (
  -- Prekės pavadinimas mažosiomis raidėmis.
  name TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shopping_purchases (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES shopping_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  bought_at TEXT NOT NULL,
  bought_by INTEGER REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE project_cost_links (
  id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_id INTEGER NOT NULL REFERENCES project_costs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE project_link_dismissals (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, transaction_id)
);

CREATE TABLE finance_deadline_tasks (
  kind TEXT NOT NULL CHECK (kind IN ('draudimas', 'palukanos', 'kreditas')),
  ref TEXT NOT NULL,
  date TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref, date)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  start_date TEXT NOT NULL,
  start_time TEXT,
  end_date TEXT NOT NULL,
  end_time TEXT,
  -- Kas dalyvauja (narių id JSON); [] — visa šeima / nenurodyta.
  member_ids TEXT NOT NULL DEFAULT '[]',
  -- Pasikartojimas (RRULE, kaip užduočių). Su google_id — kartus atsiunčia Google (atskiros
  -- eilutės su series_google_id), be jo — kartai skaičiuojami appse.
  recurrence TEXT,
  -- Google pasikartojančio įvykio kartas: kurios serijos.
  series_google_id TEXT,
  source TEXT NOT NULL DEFAULT 'rankinis' CHECK (source IN ('rankinis', 'ai', 'claude', 'google')),
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  -- Google: įvykio id ir būsena. 'laukia' — appse pakeista, dar neišsiųsta į Google.
  google_id TEXT UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'laukia' CHECK (sync_state IN ('laukia', 'sinchronizuota', 'klaida')),
  sync_error TEXT,
  -- Kasdienis pilnas patikrinimas pažymi matytus Google įvykius; ko nebuvo — ištrinta Google'e.
  seen_run TEXT
);

CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE UNIQUE INDEX idx_transactions_fingerprint ON transactions(fingerprint);

CREATE INDEX idx_transactions_booking_date ON transactions(booking_date);

CREATE INDEX idx_transactions_category ON transactions(category_id);

CREATE INDEX idx_transactions_account ON transactions(account_id);

CREATE INDEX idx_transactions_parent ON transactions(parent_id);

CREATE UNIQUE INDEX idx_budgets_category_period ON budgets(category_id, period);

CREATE UNIQUE INDEX idx_accounts_iban_hash ON accounts(iban_hash);

CREATE INDEX idx_rules_priority ON rules(priority);

CREATE INDEX idx_transactions_country ON transactions(country);

CREATE INDEX idx_transactions_rule ON transactions(rule_id);

CREATE INDEX idx_transactions_offset ON transactions(offset_of_id);

CREATE INDEX idx_pension_operations_product ON pension_operations(product_id, date);

CREATE INDEX idx_insurance_policies_policy ON insurance_policies(policy_no, period_start);

CREATE INDEX idx_savings_entries_goal ON savings_entries(goal_id, date);

CREATE INDEX idx_savings_purchases_fund ON savings_purchases(fund_id, date);

CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);

CREATE INDEX idx_tasks_parent ON tasks(parent_id);

CREATE INDEX idx_task_completions_task ON task_completions(task_id, completed_at);

CREATE INDEX idx_shopping_items_list ON shopping_items(list_id, checked_at);

CREATE INDEX idx_task_reminders_due ON task_reminders(remind_at) WHERE sent_at IS NULL;

CREATE INDEX idx_push_outbox_pending ON push_outbox(id) WHERE sent_at IS NULL;

CREATE INDEX idx_ai_requests_created ON ai_requests(created_at);

CREATE INDEX idx_ai_requests_conversation ON ai_requests(conversation_id);

CREATE INDEX idx_feedback_status ON feedback(status, created_at);

CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE INDEX idx_project_costs_project ON project_costs(project_id);

CREATE INDEX idx_claude_jungtys_status ON claude_jungtys(status);

CREATE INDEX idx_tasks_chore ON tasks(chore) WHERE chore = 1;

CREATE INDEX idx_shopping_purchases_list ON shopping_purchases(list_id, bought_at);

CREATE INDEX idx_project_cost_links_project ON project_cost_links(project_id);

CREATE INDEX idx_project_cost_links_cost ON project_cost_links(cost_id);

CREATE INDEX idx_events_dates ON events(start_date, end_date);

CREATE INDEX idx_events_series ON events(series_google_id);

CREATE INDEX idx_events_sync ON events(sync_state);