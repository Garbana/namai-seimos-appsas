/**
 * Pranešimai šiame įrenginyje: leidimas, prenumerata ir jos perdavimas serveriui.
 * Kam siųsti, serveris žino iš įrenginyje pasirinkto žmogaus („Kas naudoja šį įrenginį?“).
 */
import { request } from './api'

export type Irenginys = {
  id: number
  member_id: number
  endpoint: string
  device: string | null
  created_at: string
  last_success_at: string | null
  last_error: string | null
  failed_count: number
}

export type PranesimuBusena = {
  /** VAPID viešasis raktas; null — serveryje pranešimai nesukonfigūruoti. */
  raktas: string | null
  irenginiai: Irenginys[]
  tvarka: { suvestine: string; tylaNuo: string; tylaIki: string }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const pranesimuApi = {
  busena: () => request<PranesimuBusena>('/api/pranesimai'),
  prenumeruoti: (subscription: PushSubscriptionJSON, memberId: number, device: string) =>
    request<Irenginys>('/api/pranesimai/prenumerata', json({ subscription, memberId, device })),
  isjungti: (endpoint: string) => request<{ ok: true }>('/api/pranesimai/isjungti', json({ endpoint })),
  bandyti: (endpoint: string) => request<{ ok: boolean; klaida: string | null }>('/api/pranesimai/bandymas', json({ endpoint })),
  pasalinti: (id: number) => request<{ ok: true }>(`/api/pranesimai/irenginiai/${id}`, { method: 'DELETE' }),
}

export const palaikoma = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** Telefonas — kad „įjunk pranešimus“ kortelė nerodytų kompiuteryje. */
export const telefonas = () => /Android|iPhone|iPad/i.test(navigator.userAgent)

export async function sioPrenumerata(): Promise<PushSubscription | null> {
  if (!palaikoma()) return null
  const registracija = await navigator.serviceWorker.getRegistration()
  return registracija ? registracija.pushManager.getSubscription() : null
}

export function irenginioVardas(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android telefonas' : 'Android planšetė'
  if (/iPhone|iPad/i.test(ua)) return 'iPhone'
  if (/Windows/i.test(ua)) return 'Windows kompiuteris'
  if (/Macintosh/i.test(ua)) return 'Mac kompiuteris'
  return 'Įrenginys'
}

function raktoBaitai(raktas: string): Uint8Array<ArrayBuffer> {
  const b64 = raktas.replace(/-/g, '+').replace(/_/g, '/')
  const tekstas = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(tekstas, (c) => c.charCodeAt(0))
}

const tasPatsRaktas = (sub: PushSubscription, raktas: Uint8Array) => {
  const esamas = sub.options.applicationServerKey
  return esamas !== null && new Uint8Array(esamas).every((b, i) => b === raktas[i]) && esamas.byteLength === raktas.length
}

/** Paprašo leidimo, užsiprenumeruoja ir praneša serveriui, kam siųsti. */
export async function ijungti(memberId: number, raktas: string): Promise<PushSubscription> {
  const leidimas = await Notification.requestPermission()
  if (leidimas === 'denied') throw new Error('Pranešimai užblokuoti — leisk juos telefono nustatymuose (žr. žemiau).')
  if (leidimas !== 'granted') throw new Error('Leidimas nesuteiktas — pabandyk dar kartą ir spausk „Leisti“.')

  const registracija = await navigator.serviceWorker.ready
  const baitai = raktoBaitai(raktas)
  let sub = await registracija.pushManager.getSubscription()
  // Pasikeitus serverio raktui sena prenumerata nebetinka.
  if (sub && !tasPatsRaktas(sub, baitai)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await registracija.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: baitai })
  await pranesimuApi.prenumeruoti(sub.toJSON(), memberId, irenginioVardas())
  return sub
}

export async function isjungti(): Promise<void> {
  const sub = await sioPrenumerata()
  if (!sub) return
  await pranesimuApi.isjungti(sub.endpoint)
  await sub.unsubscribe()
}

/**
 * Atidarius appsą ar pakeitus, kas naudoja įrenginį, — serveriui primenam, kam siųsti
 * (ir atnaujinam prenumeratą, jei naršyklė ją pakeitė).
 */
export async function sinchronizuoti(memberId: number): Promise<void> {
  if (!palaikoma() || Notification.permission !== 'granted') return
  const sub = await sioPrenumerata()
  if (sub) await pranesimuApi.prenumeruoti(sub.toJSON(), memberId, irenginioVardas())
}
