/**
 * Service worker'is: appsas telefono ekrane, pranešimai ir pirkinių sąrašas be ryšio
 * (parduotuvėje). Duomenys ateina iš API (jį saugo Cloudflare Access); pirkinių sąrašas
 * be ryšio imamas iš telefono atminties (frontend/src/darbai/pirkiniuEile.ts).
 *
 * Svarbu: HTML imamas iš kešo TIK kai nėra ryšio. Jame įrašyti JS failų vardai, tad
 * senas HTML, esant ryšiui, reikštų amžinai seną appso versiją.
 */
const KESAS = 'finansai-v3'
const HTML = '/'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((vardai) => Promise.all(vardai.filter((v) => v !== KESAS).map((v) => caches.delete(v))))
      .then(() => self.clients.claim())
  )
})

/** Ar atsakymą verta įsiminti. */
function tinkaKesui(atsakymas) {
  if (!atsakymas || !atsakymas.ok || atsakymas.type !== 'basic') return false

  // Jei failo nėra, serveris atiduoda index.html (SPA atsarginis kelias).
  // Įsiminus tokį atsakymą kaip JS, appsas nustotų veikti visam laikui —
  // būtent taip ir nutiko kuriant.
  const tipas = atsakymas.headers.get('content-type') ?? ''
  return !tipas.includes('text/html')
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Puslapis: visada iš tinklo; tik be ryšio — paskutinis sėkmingai gautas.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((atsakymas) => {
          const tipas = atsakymas.headers.get('content-type') ?? ''
          if (atsakymas.ok && atsakymas.type === 'basic' && tipas.includes('text/html')) {
            const kopija = atsakymas.clone()
            caches.open(KESAS).then((kesas) => kesas.put(HTML, kopija))
          }
          return atsakymas
        })
        .catch(() => caches.match(HTML).then((issaugotas) => issaugotas || Response.error()))
    )
    return
  }

  // Failai su turinio maiša varde nesikeičia, tad juos galima imti iš kešo.
  const nekintamas =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/ikona-') ||
    url.pathname.startsWith('/fontai/')
  if (!nekintamas) return

  event.respondWith(
    caches.match(event.request).then((issaugotas) => {
      if (issaugotas) return issaugotas

      return fetch(event.request).then((atsakymas) => {
        if (tinkaKesui(atsakymas)) {
          const kopija = atsakymas.clone()
          caches.open(KESAS).then((kesas) => kesas.put(event.request, kopija))
        }
        return atsakymas
      })
    })
  )
})

// ---------- Pranešimai (siunčia Worker'io laikmatis, žr. backend/src/pranesimai) ----------

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { title: 'Namai', body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(d.title || 'Namai', {
      body: d.body || '',
      tag: d.tag,
      renotify: Boolean(d.tag),
      icon: '/ikona-192.png',
      badge: '/zenkliukas-96.png',
      lang: 'lt',
      data: { url: d.url || '/', taskId: d.taskId ?? null, memberId: d.memberId ?? null },
      actions: d.veiksmai
        ? [
            { action: 'atlikta', title: 'Atlikta' },
            { action: 'atideti', title: 'Atidėti 1 val.' },
          ]
        : [],
    })
  )
})

/** Atidaro appsą nurodytu adresu: jei jau atidarytas — tą langą. */
async function atidaryti(url) {
  const langai = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const langas of langai) {
    if (new URL(langas.url).origin !== self.location.origin) continue
    const atnaujintas = 'navigate' in langas ? await langas.navigate(url).catch(() => null) : null
    return (atnaujintas || langas).focus()
  }
  return self.clients.openWindow(url)
}

/**
 * Mygtukas pranešime — veiksmas be appso atidarymo. Jei nepavyksta (pvz., baigėsi
 * prisijungimo galiojimas ir Access nukreipia į prisijungimą), atidaroma užduotis appse.
 */
async function veiksmas(kas, taskId, memberId) {
  const res = await fetch(`/api/darbai/uzduotys/${taskId}/${kas}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId, minutes: 60 }),
    credentials: 'same-origin',
    redirect: 'manual',
  })
  const json = (res.headers.get('content-type') || '').includes('application/json')
  if (!res.ok || !json) throw new Error(`HTTP ${res.status}`)
}

self.addEventListener('notificationclick', (event) => {
  const { url, taskId, memberId } = event.notification.data || {}
  event.notification.close()

  if ((event.action === 'atlikta' || event.action === 'atideti') && taskId) {
    event.waitUntil(veiksmas(event.action, taskId, memberId).catch(() => atidaryti(`/?uzduotis=${taskId}`)))
    return
  }
  event.waitUntil(atidaryti(url || '/'))
})
