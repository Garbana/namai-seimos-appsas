import { afterEach, describe, expect, it, vi } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  loadVapid,
  sendWebPush,
  validKeys,
  vapidAuthorization,
} from "../src/pranesimai/webpush";

const enc = new TextEncoder();

/** Telefono pusė (RFC 8291): iššifruoja tai, ką gautų naršyklė. */
async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const ciphertext = body.slice(21 + idLen);

  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        n * 8
      )
    );
  const keyInfo = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function phone() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, publicRaw, auth, p256dh: b64urlEncode(publicRaw), authText: b64urlEncode(auth) };
}

describe("šifravimas (RFC 8291)", () => {
  it("sutampa su RFC 8291 pavyzdžiu baitas į baitą", async () => {
    // RFC 8291, A priedas.
    const asPublic = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const jwk = {
      kty: "EC",
      crv: "P-256",
      d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      x: b64urlEncode(asPublic.slice(1, 33)),
      y: b64urlEncode(asPublic.slice(33)),
    };
    const serverKeys = {
      privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
    };

    const body = await encryptPayload(
      b64urlDecode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "BTBZMqHH6r4Tts7J_aSIgg",
      { salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys }
    );

    const header = b64urlDecode(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    );
    const ciphertext = b64urlDecode("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ");
    expect(header.length).toBe(86);
    expect([...body]).toEqual([...header, ...ciphertext]);
  });

  it("telefonas iššifruoja (atsitiktiniai raktai, lietuviškas tekstas)", async () => {
    const p = await phone();
    const text = JSON.stringify({ title: "Dantistė", body: "Šiandien 15:00 · Sveikata" });
    const body = await encryptPayload(enc.encode(text), p.p256dh, p.authText);
    expect(await decrypt(body, p.keys.privateKey, p.publicRaw, p.auth)).toBe(text);
  });

  it("tikrina telefono raktų dydį", async () => {
    const p = await phone();
    expect(validKeys(p.p256dh, p.authText)).toBe(true);
    expect(validKeys(p.p256dh.slice(4), p.authText)).toBe(false);
    expect(validKeys(p.p256dh, "AAAA")).toBe(false);
    expect(validKeys("!!!", p.authText)).toBe(false);
  });
});

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { pair, vapid: (await loadVapid(JSON.stringify(jwk), "https://namai.example"))! };
}

describe("VAPID parašas", () => {
  it("JWT pasirašytas mūsų raktu, skirtas tarnybai, galioja 12 val.", async () => {
    const { pair, vapid } = await vapidKeys();
    const now = new Date("2026-10-10T07:30:00Z");
    const header = await vapidAuthorization(vapid, "https://fcm.googleapis.com/fcm/send/abc:123", now);

    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    const [, h, p, sig, k] = m;
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: "https://namai.example",
    });

    // k — tas pats viešasis raktas, kuriuo tikrinamas parašas.
    const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    expect(k).toBe(b64urlEncode(publicRaw));
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      b64urlDecode(sig),
      enc.encode(`${h}.${p}`)
    );
    expect(ok).toBe(true);
  });

  it("be paslapties pranešimai išjungti", async () => {
    expect(await loadVapid(undefined, "x")).toBeNull();
    await expect(loadVapid('{"x":"a"}', "x")).rejects.toThrow("d, x ir y");
  });
});

describe("siuntimas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POST su reikiamomis antraštėmis, telefonas turinį iššifruoja", async () => {
    const { vapid } = await vapidKeys();
    const p = await phone();
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    });

    const result = await sendWebPush(
      { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", p256dh: p.p256dh, auth: p.authText },
      '{"title":"Labas"}',
      vapid,
      new Date()
    );

    expect(result).toEqual({ status: 201, text: "" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "86400", Urgency: "high" });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(await decrypt(calls[0].init.body as Uint8Array, p.keys.privateKey, p.publicRaw, p.auth)).toBe('{"title":"Labas"}');
  });

  it("klaidos atveju grąžina tarnybos atsakymą", async () => {
    const { vapid } = await vapidKeys();
    const p = await phone();
    vi.stubGlobal("fetch", async () => new Response("invalid JWT", { status: 403 }));
    const result = await sendWebPush({ endpoint: "https://fcm.googleapis.com/x", p256dh: p.p256dh, auth: p.authText }, "{}", vapid, new Date());
    expect(result).toEqual({ status: 403, text: "invalid JWT" });
  });
});
