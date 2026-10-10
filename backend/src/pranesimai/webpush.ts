/**
 * Web Push be bibliotekų — tik WebCrypto, kurį turi ir Worker'is, ir Node (testams).
 *
 * - Turinys šifruojamas pagal RFC 8291 (aes128gcm): telefonas užsiprenumeruodamas
 *   duoda savo viešąjį raktą (p256dh) ir paslaptį (auth); pranešimų tarnyba (Android'e —
 *   Google FCM) mato tik užšifruotus baitus.
 * - Siuntėjas prisistato VAPID parašu (RFC 8292): ES256 JWT, pasirašytas mūsų raktu.
 *   Privatus raktas — Worker'io paslaptis VAPID_JWK (JWK su d, x, y), viešasis iš jo
 *   išvedamas, todėl antros paslapties nereikia.
 */

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Vapid {
  /** Viešasis raktas (65 baitai, base64url) — jį naršyklė gauna užsiprenumeruodama. */
  publicKey: string;
  privateKey: CryptoKey;
  /** Kontaktas pranešimų tarnybai — appso adresas (ne asmeninis paštas). */
  subject: string;
}

export interface PushResult {
  status: number;
  /** Tarnybos atsakymo pradžia — klaidai parodyti. */
  text: string;
}

export type Sender = (sub: Subscription, payload: string, vapid: Vapid, now: Date) => Promise<PushResult>;

const enc = new TextEncoder();

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** HKDF-SHA256 (ištraukimas ir išplėtimas) — `length` baitų. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** Ar telefono atsiųsti raktai tinkamo dydžio (kitaip šifruoti neįmanoma). */
export function validKeys(p256dh: string, auth: string): boolean {
  try {
    const pub = b64urlDecode(p256dh);
    return pub.length === 65 && pub[0] === 4 && b64urlDecode(auth).length === 16;
  } catch {
    return false;
  }
}

/**
 * Užšifruoja pranešimo turinį (RFC 8291). `salt` ir `serverKeys` paprastai sugeneruojami
 * kiekvienam pranešimui atskirai; perduodami tik testuose (RFC pavyzdžiui patikrinti).
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  fixed: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {}
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server =
    fixed.serverKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", server.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Workers tipuose šis laukas vadinasi $public, bet vykdymo aplinka laukia `public`.
  const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, server.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 — paskutinio (vienintelio) įrašo žymė.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, Uint8Array.of(2)))
  );

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** VAPID raktai iš Worker'io paslapties; be paslapties — null (pranešimai išjungti). */
export async function loadVapid(jwkText: string | undefined, subject: string): Promise<Vapid | null> {
  if (!jwkText) return null;
  const jwk = JSON.parse(jwkText) as JsonWebKey;
  if (!jwk.d || !jwk.x || !jwk.y) throw new Error("VAPID_JWK turi turėti d, x ir y.");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const publicKey = b64urlEncode(concat(Uint8Array.of(4), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
  return { publicKey, privateKey, subject };
}

/** Authorization antraštė: JWT galioja 12 val. tai pranešimų tarnybai (endpoint kilmei). */
export async function vapidAuthorization(vapid: Vapid, endpoint: string, now: Date): Promise<string> {
  const part = (o: object) => b64urlEncode(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.privateKey, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/**
 * Išsiunčia vieną pranešimą. Aukštas prioritetas — kad Android'o baterijos taupymas
 * nepavėlintų; galioja parą (išjungtas telefonas gaus įsijungęs, jei per parą).
 */
export const sendWebPush: Sender = async (sub, payload, vapid, now) => {
  const body = await encryptPayload(enc.encode(payload), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(vapid, sub.endpoint, now),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });
  return { status: res.status, text: res.ok ? "" : (await res.text()).slice(0, 200) };
};
