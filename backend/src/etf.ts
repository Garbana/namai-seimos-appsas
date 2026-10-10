/**
 * ETF kainos iš Yahoo Finance.
 *
 * Tas pats principas kaip pensijų fondų kainose: viešas puslapis, jokių raktų,
 * atnaujinama fone kartą per 12 val., o klaidos matomos appse, o ne tyliai
 * praryjamos. Kainos rašomos į tą pačią `fund_prices` lentelę (`isin` = Yahoo
 * simbolis), tad istorija kaupiasi savaime ir tinka portfelio grafikui.
 */

const YAHOO_URL = (symbol: string, range: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
  `?range=${range}&interval=1d`;

/** Kiek laiko kainos laikomos šviežiomis. */
const MAX_AGE_HOURS = 12;
/** Kiek kainų eilučių rašoma vienu INSERT'u (D1 nemėgsta labai ilgų sakinių). */
const CHUNK = 50;

export type FundPoint = { date: string; price: number };

export type PriceRefreshResult = {
  symbol: string;
  name: string;
  ok: boolean;
  price?: number;
  date?: string;
  added?: number;
  error?: string;
};

type YahooResponse = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
};

/** Dienos uždarymo kainos. Yahoo švenčių dienoms grąžina null — tokias praleidžiam. */
export async function fetchFundSeries(
  symbol: string,
  range: string,
  fetcher: typeof fetch = fetch
): Promise<FundPoint[]> {
  const response = await fetcher(YAHOO_URL(symbol, range), {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Yahoo atsakė ${response.status}`);

  const data = (await response.json()) as YahooResponse;
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(data?.chart?.error?.description ?? `fondas „${symbol}“ nerastas`);
  }

  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: FundPoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const price = closes[i];
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    points.push({
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      price: Math.round(price * 10000) / 10000,
    });
  }
  if (points.length === 0) throw new Error("Yahoo negrąžino nė vienos kainos");
  return points;
}

/**
 * Atnaujina visų taupymo fondų kainas.
 *
 * Pirmą kartą imama dvejų metų istorija (kad grafikas turėtų ką rodyti), vėliau —
 * tik paskutinis mėnuo.
 */
export async function refreshEtfPrices(db: D1Database, fetcher: typeof fetch = fetch) {
  const { results: funds } = await db
    .prepare(
      `SELECT symbol, MIN(name) AS name FROM savings_funds
       WHERE price_source = 'yahoo' GROUP BY symbol`
    )
    .all<{ symbol: string; name: string }>();

  const results: PriceRefreshResult[] = [];

  for (const fund of funds) {
    try {
      const turime = await db
        .prepare("SELECT COUNT(*) AS kiek FROM fund_prices WHERE isin = ?")
        .bind(fund.symbol)
        .first<{ kiek: number }>();
      const range = (turime?.kiek ?? 0) > 5 ? "1mo" : "2y";

      const points = await fetchFundSeries(fund.symbol, range, fetcher);

      for (let i = 0; i < points.length; i += CHUNK) {
        const dalis = points.slice(i, i + CHUNK);
        const values = dalis.map(() => "(?, ?, ?, 'yahoo')").join(", ");
        await db
          .prepare(`INSERT OR REPLACE INTO fund_prices (isin, date, price, source) VALUES ${values}`)
          .bind(...dalis.flatMap((p) => [fund.symbol, p.date, p.price]))
          .run();
      }

      const last = points[points.length - 1];
      results.push({
        symbol: fund.symbol,
        name: fund.name,
        ok: true,
        price: last.price,
        date: last.date,
        added: points.length,
      });
    } catch (error) {
      results.push({
        symbol: fund.symbol,
        name: fund.name,
        ok: false,
        error: error instanceof Error ? error.message : "nežinoma klaida",
      });
    }
  }

  const santrauka = { at: new Date().toISOString(), results };
  await db
    .prepare(
      `INSERT INTO app_state (key, value, updated_at) VALUES ('etf_kainos', ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(JSON.stringify(santrauka))
    .run();

  return santrauka;
}

/** Ar verta bandyti atnaujinti (praėjo daugiau nei 12 val. nuo paskutinio karto). */
export async function etfPricesStale(db: D1Database): Promise<boolean> {
  const funds = await db
    .prepare("SELECT COUNT(*) AS kiek FROM savings_funds WHERE price_source = 'yahoo'")
    .first<{ kiek: number }>();
  if ((funds?.kiek ?? 0) === 0) return false;

  const row = await db
    .prepare("SELECT updated_at FROM app_state WHERE key = 'etf_kainos'")
    .first<{ updated_at: string }>();
  if (!row) return true;

  const amzius = Date.now() - Date.parse(`${row.updated_at.replace(" ", "T")}Z`);
  return !Number.isFinite(amzius) || amzius > MAX_AGE_HOURS * 3600 * 1000;
}

export async function lastEtfRefresh(db: D1Database) {
  const row = await db
    .prepare("SELECT value, updated_at FROM app_state WHERE key = 'etf_kainos'")
    .first<{ value: string; updated_at: string }>();
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.value) as { at: string; results: PriceRefreshResult[] }), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}
