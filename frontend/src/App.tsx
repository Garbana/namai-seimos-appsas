import { useCallback, useEffect, useState } from 'react'
import './App.css'
import './asistentas/asistentas.css'
import './darbai/darbai.css'
import { api, type Category } from './api'
import Apzvalga from './Apzvalga'
import Asistentas from './asistentas/Asistentas'
import AsistentoIstorija from './asistentas/Istorija'
import Pastabos from './pastabos/Pastabos'
import ClaudeJungtis from './claude/ClaudeJungtis'
import GoogleKalendorius from './kalendorius/GoogleKalendorius'
import IvykioDialogas from './kalendorius/IvykioDialogas'
import Kalendorius from './kalendorius/Kalendorius'
import './kalendorius/kalendorius.css'
import ClaudeLeidimas from './claude/ClaudeLeidimas'
import './claude/claude.css'
import './pastabos/pastabos.css'
import Katinukas from './asistentas/Katinukas'
import AtsarginesKopijos from './AtsarginesKopijos'
import Daugiau from './Daugiau'
import { darbai, type Narys, type Sritis } from './darbai/api'
import KasAs from './darbai/KasAs'
import { NariuKontekstas } from './darbai/nariai'
import Pirkiniai from './darbai/Pirkiniai'
import { siandien } from './darbai/datos'
import { gautiNustatymus, NUMATYTI, NustatymuKontekstas, type Nustatymai } from './nustatymai'
import { eile, siustiEile } from './darbai/pirkiniuEile'
import Projektai from './darbai/Projektai'
import Ruosa from './darbai/Ruosa'
import ProjektoEkranas from './darbai/Projektas'
import './darbai/projektai.css'
import Siuksliadeze from './darbai/Siuksliadeze'
import Sritys from './darbai/Sritys'
import UzduotiesDialogas from './darbai/UzduotiesDialogas'
import Uzduotys from './darbai/Uzduotys'
import Grupe from './Grupe'
import Importas from './Importas'
import { KategorijuKontekstas } from './KategorijuKontekstas'
import Operacijos from './Operacijos'
import Pradzia from './Pradzia'
import Pranesimai from './Pranesimai'
import { sinchronizuoti } from './prenumerata'
import Siandien from './Siandien'
import Taisykles from './Taisykles'
import Turtas from './Turtas'

type Skiltis =
  | 'siandien'
  | 'kalendorius'
  | 'google'
  | 'uzduotys'
  | 'projektai'
  | 'pirkiniai'
  | 'ruosa'
  | 'finansai'
  | 'biudzetas'
  | 'turtas'
  | 'operacijos'
  | 'importas'
  | 'taisykles'
  | 'kopijos'
  | 'siuksliadeze'
  | 'sritys'
  | 'pranesimai'
  | 'asistentas'
  | 'pastabos'
  | 'claude'
  | 'daugiau'

/** „sistemos" — kol nepasirinkta pačiam; tada temą lemia sistemos nustatymas. */
type Tema = 'sistemos' | 'sviesi' | 'tamsi'

const sistemojeTamsu = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

const VARDAI: Record<Skiltis, string> = {
  siandien: 'Šiandien',
  kalendorius: 'Kalendorius',
  google: 'Google kalendorius',
  uzduotys: 'Užduotys',
  projektai: 'Projektai',
  pirkiniai: 'Pirkiniai',
  ruosa: 'Ruoša',
  finansai: 'Apžvalga',
  biudzetas: 'Biudžetas',
  turtas: 'Turtas',
  operacijos: 'Operacijos',
  importas: 'Importas',
  taisykles: 'Taisyklės',
  kopijos: 'Atsarginės kopijos',
  siuksliadeze: 'Šiukšliadėžė',
  sritys: 'Sritys ir atsakingi',
  pranesimai: 'Pranešimai',
  asistentas: 'Asistentas',
  pastabos: 'Pastabos ir klaidos',
  claude: 'Claude jungtis',
  daugiau: 'Daugiau',
}

type Punktas = { skiltis: Skiltis; ikona: string }

const DARBAI: Punktas[] = [
  { skiltis: 'uzduotys', ikona: '✓' },
  { skiltis: 'projektai', ikona: '◆' },
  { skiltis: 'pirkiniai', ikona: '□' },
  { skiltis: 'ruosa', ikona: '↻' },
]

const FINANSAI: Punktas[] = [
  { skiltis: 'finansai', ikona: '▦' },
  { skiltis: 'biudzetas', ikona: '▤' },
  { skiltis: 'turtas', ikona: '◈' },
  { skiltis: 'operacijos', ikona: '≡' },
]

/** Kompiuteryje — šoninėje juostoje; telefone jie „Daugiau“ ekrane. */
const KITA: Punktas[] = [
  { skiltis: 'importas', ikona: '⇅' },
  { skiltis: 'taisykles', ikona: '⚙' },
]

const APACIOJE: Punktas[] = [
  { skiltis: 'asistentas', ikona: '✦' },
  { skiltis: 'pastabos', ikona: '✎' },
  { skiltis: 'claude', ikona: '✳' },
  { skiltis: 'google', ikona: '⇄' },
  { skiltis: 'pranesimai', ikona: '◔' },
  { skiltis: 'sritys', ikona: '◫' },
  { skiltis: 'siuksliadeze', ikona: '♲' },
  { skiltis: 'kopijos', ikona: '⤓' },
]

const DAUGIAU_SKILTYS: Skiltis[] = ['daugiau', 'importas', 'taisykles', 'kopijos', 'siuksliadeze', 'sritys', 'pranesimai', 'asistentas', 'pastabos', 'claude', 'google']

const priklauso = (skiltis: Skiltis, punktai: Punktas[]) => punktai.some((p) => p.skiltis === skiltis)

function skaitytiAs(): number | null {
  try {
    return Number(localStorage.getItem('narys')) || null
  } catch {
    return null
  }
}

type AsistentoPradzia = 'tekstu' | 'balsu'

/**
 * Adresas, kuriuo atidarytas appsas: iš pranešimo „?uzduotis=5“ (atidaryti užduotį) ar
 * „?skiltis=kopijos“, iš trumpinio „Pasakyk“ — „?asistentas=balsu“, iš Claude programos
 * jungimosi — „?claude=…“ (leidimo langas).
 */
function skaitytiAdresa(): {
  uzduotis: number | null
  skiltis: Skiltis | null
  asistentas: AsistentoPradzia | null
  claude: string | null
} {
  const p = new URLSearchParams(window.location.search)
  const s = p.get('skiltis')
  return {
    uzduotis: Number(p.get('uzduotis')) || null,
    skiltis: s && s in VARDAI ? (s as Skiltis) : null,
    asistentas: p.get('asistentas') === 'balsu' ? 'balsu' : null,
    claude: p.get('claude'),
  }
}

function App() {
  const [adresas] = useState(skaitytiAdresa)
  const [pradineUzduotis, setPradineUzduotis] = useState(adresas.uzduotis)
  const [categories, setCategories] = useState<Category[]>([])
  const [skiltis, setSkiltis] = useState<Skiltis>(adresas.uzduotis ? 'uzduotys' : (adresas.skiltis ?? 'siandien'))
  const [paskutineDarbu, setPaskutineDarbu] = useState<Skiltis>('uzduotys')
  const [paskutineFinansu, setPaskutineFinansu] = useState<Skiltis>('finansai')
  const [atnaujinimas, setAtnaujinimas] = useState(0)
  const [grupe, setGrupe] = useState<Category | null>(null)
  // Atidarytas projektas (kaip finansų grupė — ekranas virš skilties).
  const [projektas, setProjektas] = useState<{ id: number; title: string } | null>(null)
  const [asistentas, setAsistentas] = useState<AsistentoPradzia | null>(adresas.asistentas)
  const [veiksmai, setVeiksmai] = useState(false)
  // Claude programa jungiasi — leidimo langas virš appso.
  const [claudePrasymas, setClaudePrasymas] = useState(adresas.claude)
  const [error, setError] = useState<string | null>(null)

  const [nariai, setNariai] = useState<Narys[]>([])
  const [as, setAs] = useState<number | null>(null)
  const [nariaiPasikrove, setNariaiPasikrove] = useState(false)
  const [rodytiKasAs, setRodytiKasAs] = useState(false)

  const [naujaUzduotis, setNaujaUzduotis] = useState(false)
  const [naujasIvykis, setNaujasIvykis] = useState(false)
  // Šeimos pavadinimas ir įjungti moduliai (wrangler.toml [vars]).
  const [nustatymai, setNustatymai] = useState<Nustatymai>(NUMATYTI)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [pirkiniuFokusas, setPirkiniuFokusas] = useState(false)

  const [tema, setTema] = useState<Tema>(() => {
    const issaugota = localStorage.getItem('tema')
    return issaugota === 'sviesi' || issaugota === 'tamsi' ? issaugota : 'sistemos'
  })

  // Nepasirinkus temos žyma nededama — tada galioja sistemos nustatymas ir
  // appsas persijungia kartu su telefonu.
  useEffect(() => {
    if (tema === 'sistemos') {
      delete document.documentElement.dataset.tema
      localStorage.removeItem('tema')
    } else {
      document.documentElement.dataset.tema = tema
      localStorage.setItem('tema', tema)
    }
  }, [tema])

  const tamsuDabar = tema === 'tamsi' || (tema === 'sistemos' && sistemojeTamsu())

  useEffect(() => {
    api
      .categories()
      .then(setCategories)
      // Be ryšio (pvz., parduotuvėje) — tylim: pirkiniai veikia ir be kategorijų.
      .catch(() => navigator.onLine && setError('Nepavyko užkrauti kategorijų.'))
    // Adresas iš pranešimo jau perskaitytas — kad perkrovus neatsidarytų iš naujo.
    if (window.location.search) window.history.replaceState(null, '', '/')
  }, [])

  useEffect(() => {
    gautiNustatymus()
      .then(setNustatymai)
      .catch(() => {})
  }, [])

  const finansai = nustatymai.moduliai.includes('finansai')
  /** Skiltis, kurios modulis išjungtas, nerodoma (šoninėje juostoje ir „Daugiau“). */
  const matoma = (sk: Skiltis) =>
    ({ importas: finansai, taisykles: finansai, asistentas: nustatymai.moduliai.includes('asistentas'), claude: nustatymai.moduliai.includes('claude'), google: nustatymai.moduliai.includes('google') } as Partial<Record<Skiltis, boolean>>)[sk] ?? true

  // Kas naudoja įrenginį, įsimenama pačiame įrenginyje (ne pagal prisijungimo paštą):
  // pirmą kartą paklausiam, vėliau pakeisti galima bet kada.
  useEffect(() => {
    const pritaikyti = (nariai: Narys[]) => {
      setNariai(nariai)
      const zinomas = skaitytiAs()
      setAs(nariai.some((n) => n.id === zinomas && n.uses_app) ? zinomas : null)
    }
    darbai
      .nariai()
      .then(({ nariai }) => {
        pritaikyti(nariai)
        try {
          localStorage.setItem('nariai-kesas', JSON.stringify(nariai))
        } catch {
          // Be ryšio tada tiesiog nebus vardų.
        }
      })
      .catch(() => {
        // Be ryšio — paskutinis žinomas sąrašas (kad pirkiniuose matytųsi, kas pridėjo).
        let issaugoti: Narys[] | null = null
        try {
          issaugoti = JSON.parse(localStorage.getItem('nariai-kesas') ?? 'null') as Narys[] | null
        } catch {
          issaugoti = null
        }
        if (issaugoti) pritaikyti(issaugoti)
        else setError('Nepavyko užkrauti šeimos narių.')
      })
      .finally(() => setNariaiPasikrove(true))
  }, [])

  // Pranešimai keliauja tam, kas naudoja įrenginį — serveriui primenam po kiekvieno pasikeitimo.
  useEffect(() => {
    if (as !== null) sinchronizuoti(as).catch(() => {})
    // Be ryšio parduotuvėje padaryti pirkinių pakeitimai — išsiunčiami, vos atsiradus ryšiui.
    if (as !== null && eile().length > 0) siustiEile(as).catch(() => {})
  }, [as])

  const keistiAs = useCallback((id: number) => {
    setAs(id)
    try {
      localStorage.setItem('narys', String(id))
      // Kad naršyklė, trūkstant vietos, neištrintų pasirinkimo.
      void navigator.storage?.persist?.()
    } catch {
      // Privačiame lange įsimins tik iki uždarymo.
    }
  }, [])

  const pridetiKategorija = useCallback((category: Category) => {
    setCategories((prev) => [...prev, category].sort((a, b) => a.sort_order - b.sort_order))
  }, [])

  /** Perėjimas į skiltį visada uždaro grupės ekraną, veiksmų lapą ir asistentą. */
  const eiti = useCallback((nauja: Skiltis) => {
    setSkiltis(nauja)
    setPradineUzduotis(null)
    setGrupe(null)
    setProjektas(null)
    setVeiksmai(false)
    setAsistentas(null)
    setPirkiniuFokusas(false)
    if (priklauso(nauja, DARBAI)) setPaskutineDarbu(nauja)
    if (priklauso(nauja, FINANSAI)) setPaskutineFinansu(nauja)
  }, [])

  function atidarytiNaujaUzduoti() {
    setVeiksmai(false)
    darbai
      .sritys()
      .then(setSritys)
      .catch(() => setSritys([]))
    setNaujaUzduotis(true)
  }

  const temosJungiklis = (
    <button
      className="ghost small temos-jungiklis"
      onClick={() => setTema(tamsuDabar ? 'sviesi' : 'tamsi')}
      aria-pressed={tamsuDabar}
      title={tamsuDabar ? 'Įjungti šviesią temą' : 'Įjungti tamsią temą'}
    >
      <span aria-hidden="true">{tamsuDabar ? '☀' : '☾'}</span>
      {tamsuDabar ? 'Šviesi' : 'Tamsi'}
    </button>
  )

  const atidarytiProjekta = (p: { id: number; title: string }) => setProjektas({ id: p.id, title: p.title })

  const turinys = grupe ? (
    <Grupe group={grupe} categories={categories} onBack={() => setGrupe(null)} />
  ) : projektas ? (
    <ProjektoEkranas key={`${projektas.id}-${atnaujinimas}`} id={projektas.id} onAtgal={() => setProjektas(null)} />
  ) : skiltis === 'kalendorius' ? (
    <Kalendorius key={atnaujinimas} onGoogle={() => eiti('google')} />
  ) : skiltis === 'google' ? (
    <GoogleKalendorius />
  ) : skiltis === 'siandien' ? (
    <Siandien key={atnaujinimas} onEiti={eiti} onAtidarytiProjekta={atidarytiProjekta} />
  ) : skiltis === 'uzduotys' ? (
    <Uzduotys key={atnaujinimas} pradinisId={pradineUzduotis} onAtidarytiProjekta={atidarytiProjekta} />
  ) : skiltis === 'projektai' ? (
    <Projektai key={atnaujinimas} onAtidaryti={atidarytiProjekta} />
  ) : skiltis === 'ruosa' ? (
    <Ruosa key={atnaujinimas} />
  ) : skiltis === 'pirkiniai' ? (
    <Pirkiniai fokusuoti={pirkiniuFokusas} />
  ) : skiltis === 'finansai' ? (
    <Pradzia key={atnaujinimas} categories={categories} onOpenGroup={setGrupe} onEiti={eiti} />
  ) : skiltis === 'biudzetas' ? (
    <Apzvalga key={atnaujinimas} categories={categories} onOpenGroup={setGrupe} />
  ) : skiltis === 'turtas' ? (
    <Turtas categories={categories} onOpen={setGrupe} />
  ) : skiltis === 'operacijos' ? (
    <Operacijos key={atnaujinimas} categories={categories} />
  ) : skiltis === 'taisykles' ? (
    <Taisykles />
  ) : skiltis === 'kopijos' ? (
    <AtsarginesKopijos />
  ) : skiltis === 'siuksliadeze' ? (
    <Siuksliadeze />
  ) : skiltis === 'sritys' ? (
    <Sritys />
  ) : skiltis === 'pranesimai' ? (
    <Pranesimai onKeistiAs={() => setRodytiKasAs(true)} />
  ) : skiltis === 'pastabos' ? (
    <Pastabos key={atnaujinimas} />
  ) : skiltis === 'claude' ? (
    <ClaudeJungtis />
  ) : skiltis === 'asistentas' ? (
    <AsistentoIstorija key={atnaujinimas} onAtidaryti={() => setAsistentas('tekstu')} />
  ) : skiltis === 'daugiau' ? (
    <Daugiau onEiti={eiti} onKeistiAs={() => setRodytiKasAs(true)} temosJungiklis={temosJungiklis} matoma={matoma} />
  ) : (
    <Importas
      categories={categories}
      onImported={() => {
        setAtnaujinimas((n) => n + 1)
        eiti('biudzetas')
      }}
    />
  )

  const meniuMygtukas = (p: Punktas) => (
    <button
      key={p.skiltis}
      className={skiltis === p.skiltis && !grupe && !projektas ? 'aktyvus' : undefined}
      aria-current={skiltis === p.skiltis ? 'page' : undefined}
      onClick={() => eiti(p.skiltis)}
    >
      <span className="ikona" aria-hidden="true">
        {p.ikona}
      </span>
      {VARDAI[p.skiltis]}
    </button>
  )

  /** Telefone skilties poskiltys — perjungiklis turinio viršuje. */
  const poskiltys = grupe || projektas ? null : priklauso(skiltis, DARBAI) ? DARBAI : priklauso(skiltis, FINANSAI) ? FINANSAI : null

  const darbuAktyvi = priklauso(skiltis, DARBAI) || projektas !== null
  const finansuAktyvi = priklauso(skiltis, FINANSAI) || grupe !== null
  const daugiauAktyvi = DAUGIAU_SKILTYS.includes(skiltis) && !grupe
  const asVardas = nariai.find((n) => n.id === as)?.name

  return (
    <NustatymuKontekstas.Provider value={nustatymai}>
    <NariuKontekstas.Provider value={{ nariai, as, keistiAs }}>
      <KategorijuKontekstas.Provider value={pridetiKategorija}>
        <div className="karkasas">
          <aside className="sonine">
            <div className="sonine-logo">
              Namai
              <span>{nustatymai.seima}</span>
            </div>

            <nav className="meniu" aria-label="Skiltys">
              {meniuMygtukas({ skiltis: 'siandien', ikona: '⌂' })}
              {meniuMygtukas({ skiltis: 'kalendorius', ikona: '▦' })}
              <span className="meniu-antraste">Darbai</span>
              {DARBAI.map(meniuMygtukas)}
              {finansai && <span className="meniu-antraste">Finansai</span>}
              {finansai && [...FINANSAI, ...KITA].map(meniuMygtukas)}
            </nav>

            <div className="sonine-apacia">
              <nav className="meniu" aria-label="Kita">
                {APACIOJE.filter((p) => matoma(p.skiltis)).map(meniuMygtukas)}
                <button onClick={() => setRodytiKasAs(true)} title="Kas naudoja šį įrenginį">
                  <span className="ikona" aria-hidden="true">
                    ●
                  </span>
                  {asVardas ?? 'Kas tu?'}
                </button>
              </nav>
              {temosJungiklis}
            </div>
          </aside>

          <div className="turinys">
            <header className="virsutine">
              <h1>{grupe ? grupe.name : projektas ? projektas.title : VARDAI[skiltis]}</h1>
              <div className="virsutine-veiksmai">
                {/* Telefone „Daugiau“ — čia (apačioje vietos neliko: Šiandien · Kalendorius · + · Darbai · Finansai). */}
                {finansai ? (
                  <button
                  className={`ghost small virsutine-daugiau${daugiauAktyvi ? ' aktyvus' : ''}`}
                  onClick={() => eiti('daugiau')}
                  aria-current={skiltis === 'daugiau' ? 'page' : undefined}
                >
                  <span aria-hidden="true">≡</span> Daugiau
                  </button>
                ) : (
                  temosJungiklis
                )}
              </div>
            </header>

            <main>
              {poskiltys && (
                <div className="perjungiklis poskiltys" role="group" aria-label="Poskiltys">
                  {poskiltys.map((p) => (
                    <button key={p.skiltis} aria-pressed={skiltis === p.skiltis} onClick={() => eiti(p.skiltis)}>
                      {VARDAI[p.skiltis]}
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="error">{error}</p>}
              {turinys}
            </main>
          </div>

          <nav className="apatine" aria-label="Skiltys">
            <button
              className={skiltis === 'siandien' && !grupe && !projektas ? 'aktyvus' : undefined}
              aria-current={skiltis === 'siandien' ? 'page' : undefined}
              onClick={() => eiti('siandien')}
            >
              <span className="ikona" aria-hidden="true">
                ⌂
              </span>
              Šiandien
            </button>
            <button
              className={skiltis === 'kalendorius' && !grupe && !projektas ? 'aktyvus' : undefined}
              aria-current={skiltis === 'kalendorius' ? 'page' : undefined}
              onClick={() => eiti('kalendorius')}
            >
              <span className="ikona" aria-hidden="true">
                ▦
              </span>
              Kalendorius
            </button>
            <button className="plius" onClick={() => setVeiksmai(true)} aria-label="Pridėti">
              <span aria-hidden="true">+</span>
            </button>

            <button className={darbuAktyvi ? 'aktyvus' : undefined} onClick={() => eiti(paskutineDarbu)}>
              <span className="ikona" aria-hidden="true">
                ✓
              </span>
              Darbai
            </button>

            {finansai ? (
              <button className={finansuAktyvi ? 'aktyvus' : undefined} onClick={() => eiti(paskutineFinansu)}>
                <span className="ikona" aria-hidden="true">
                  €
                </span>
                Finansai
              </button>
            ) : (
              // Be finansų — apačioje „Daugiau“.
              <button className={daugiauAktyvi ? 'aktyvus' : undefined} onClick={() => eiti('daugiau')}>
                <span className="ikona" aria-hidden="true">
                  ≡
                </span>
                Daugiau
              </button>
            )}
          </nav>

          {/* Asistentas — atskiras „gyvūnėlis“: katinukas kampe, paspaudus išsiskleidžia pokalbis. */}
          {!asistentas && matoma('asistentas') && (
            <button className="katinuko-burbulas" onClick={() => setAsistentas('tekstu')} aria-label="Asistentas">
              <Katinukas dydis={54} mojuoja />
            </button>
          )}
          {asistentas && (
            <Asistentas
              pradzia={asistentas}
              ekranas={grupe ? `${VARDAI[skiltis]} → ${grupe.name}` : projektas ? `Projektas „${projektas.title}“` : VARDAI[skiltis]}
              onUzdaryti={() => setAsistentas(null)}
              onPakeista={() => setAtnaujinimas((n) => n + 1)}
            />
          )}

          {veiksmai && (
            <div className="lapo-fonas" onClick={() => setVeiksmai(false)} role="presentation">
              <div className="lapas" role="dialog" aria-label="Ką norite pridėti" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => {
                    setVeiksmai(false)
                    setNaujasIvykis(true)
                  }}
                >
                  <span aria-hidden="true">▦</span> Naujas įvykis kalendoriuje
                </button>
                <button onClick={atidarytiNaujaUzduoti}>
                  <span aria-hidden="true">✓</span> Nauja užduotis
                </button>
                <button
                  onClick={() => {
                    eiti('pirkiniai')
                    setPirkiniuFokusas(true)
                  }}
                >
                  <span aria-hidden="true">□</span> Pridėti pirkinį
                </button>
                {finansai && (
                  <button onClick={() => eiti('importas')}>
                    <span aria-hidden="true">⇅</span> Importuoti banko išrašą
                  </button>
                )}
                <button className="ghost" onClick={() => setVeiksmai(false)}>
                  Atšaukti
                </button>
              </div>
            </div>
          )}

          {naujasIvykis && (
            <IvykioDialogas ivykis={null} data={siandien()} onUzdaryti={() => setNaujasIvykis(false)} onPakeista={() => setAtnaujinimas((n) => n + 1)} />
          )}

          {naujaUzduotis && (
            <UzduotiesDialogas
              uzduotis={null}
              visos={[]}
              sritys={sritys}
              onUzdaryti={() => setNaujaUzduotis(false)}
              onPakeista={() => setAtnaujinimas((n) => n + 1)}
            />
          )}

          {claudePrasymas ? (
            nariaiPasikrove && <ClaudeLeidimas state={claudePrasymas} onUzdaryti={() => setClaudePrasymas(null)} />
          ) : (
            (rodytiKasAs || (nariaiPasikrove && as === null && nariai.some((n) => n.uses_app))) && (
              <KasAs onUzdaryti={as === null ? undefined : () => setRodytiKasAs(false)} />
            )
          )}
        </div>
      </KategorijuKontekstas.Provider>
    </NariuKontekstas.Provider>
    </NustatymuKontekstas.Provider>
  )
}

export default App
