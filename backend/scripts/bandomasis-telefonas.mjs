// Bandomasis „telefonas“ pranešimams tikrinti be tikro telefono.
//
// Užsiregistruoja tikroje Mozilla pranešimų tarnyboje (autopush — tuo pačiu protokolu,
// kaip Firefox), užregistruoja prenumeratą vietiniame appse (wrangler dev, :8787) ir
// laukia pranešimų: juos iššifruoja kaip naršyklė (RFC 8291) ir išspausdina. Taip
// patikrinama visa grandinė: VAPID parašas, šifravimas, laikmatis.
//
// Naudojimas (iš backend/):  node scripts/bandomasis-telefonas.mjs [laukti_sekundziu] [narys]
// Bandomąjį pranešimą jam išsiųsti (ENDPOINT — iš šio skripto išvesties):
//   curl -X POST localhost:8787/api/pranesimai/bandymas -H "Content-Type: application/json" -d '{"endpoint":"<ENDPOINT>"}'
// Priminimai ir suvestinė ateina patys — wrangler dev laikmatį paleidžia kas minutę.
// Pabaigus — įrenginį pašalinti appse („Pranešimai“ → „Pašalinti“).
const API = "http://localhost:8787";
const wait = Number(process.argv[2] ?? 60);
const memberId = Number(process.argv[3] ?? 1);
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString("base64url");
const unb64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));

const { raktas } = await (await fetch(`${API}/api/pranesimai`)).json();
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));

async function decrypt(body) {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const hkdf = async (s, ikm, info, n) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const ikm = await hkdf(auth, shared, new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + idLen)));
  return new TextDecoder().decode(plain.slice(0, -1));
}

const ws = new WebSocket("wss://push.services.mozilla.com/");
const channelID = crypto.randomUUID();
ws.onopen = () => ws.send(JSON.stringify({ messageType: "hello", use_webpush: true }));
ws.onerror = (e) => { console.log("WS klaida", e.message ?? e); process.exit(1); };
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.messageType === "hello") {
    ws.send(JSON.stringify({ messageType: "register", channelID, key: raktas }));
  } else if (m.messageType === "register") {
    if (m.status !== 200) { console.log("registracija nepavyko", m); process.exit(1); }
    const res = await fetch(`${API}/api/pranesimai/prenumerata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, device: "Bandomasis (Mozilla)", subscription: { endpoint: m.pushEndpoint, keys: { p256dh: b64u(uaPublic), auth: b64u(auth) } } }),
    });
    console.log("UŽREGISTRUOTA", res.status, JSON.stringify(await res.json()).slice(0, 120));
    console.log("ENDPOINT", m.pushEndpoint);
  } else if (m.messageType === "notification") {
    ws.send(JSON.stringify({ messageType: "ack", updates: [{ channelID: m.channelID, version: m.version }] }));
    console.log("GAUTA", new Date().toISOString(), m.headers?.encoding, await decrypt(unb64u(m.data)));
  }
};
setTimeout(() => { console.log("PABAIGA"); ws.close(); process.exit(0); }, wait * 1000);
