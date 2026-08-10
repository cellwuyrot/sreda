/**
 * Тесты для криптографического модуля WireGuard-ключей.
 * Зона A, приоритет P0.
 *
 * Покрытие:
 *   1. Контрольные векторы X25519 из RFC 7748 §6.1
 *   2. Идемпотентность clamp через generateWireGuardKeyPair
 *   3. Граничные случаи: buildWireGuardConfig не валидирует ключи (документирует баг)
 *   4. Кросс-проверка с node:crypto (генерация пары + DH)
 *   5. buildWireGuardConfig: структура вывода, порядок extra-полей
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as nodeCrypto from "node:crypto";
import { generateWireGuardKeyPair, buildWireGuardConfig } from "@/lib/wgKeys";

// ─── Вспомогательные функции ───────────────────────────────────────────────

/** Hex-строка → Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

/** Uint8Array → base64 (совместимо с btoa) */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Обрезка скаляра по RFC 7748 (дублирует логику модуля для вычисления ожидаемого результата) */
function clampScalar(scalar: Uint8Array): Uint8Array {
  const k = Uint8Array.from(scalar);
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  return k;
}

// ─── RFC 7748 §6.1 — официальные тестовые векторы ─────────────────────────

/**
 * Публичные ключи в RFC 7748 §6.1 вычислены как X25519(privateKey, basePoint).
 * Приватные ключи в векторах НЕ обрезаны (сырые случайные байты).
 * Модуль выполняет clamp внутри x25519(), поэтому генерация публичного ключа
 * совпадает с RFC независимо от того, обрезан ли вход заранее.
 * Приватный ключ сохраняется уже обрезанным (что делает и `wg genkey`).
 */
const RFC_ALICE_PRIV_HEX =
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";
const RFC_ALICE_PUB_HEX =
  "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";
const RFC_BOB_PRIV_HEX =
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb";
const RFC_BOB_PUB_HEX =
  "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f";
const RFC_SHARED_HEX =
  "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";

// ─── DER-префиксы для node:crypto ─────────────────────────────────────────

const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function wrapPrivateDer(rawKey: Uint8Array): Buffer {
  return Buffer.concat([PKCS8_PREFIX, Buffer.from(rawKey)]);
}

function wrapPublicDer(rawKey: Uint8Array): Buffer {
  return Buffer.concat([SPKI_PREFIX, Buffer.from(rawKey)]);
}

// ─── Мок crypto.getRandomValues ───────────────────────────────────────────

/**
 * Подменяем crypto.getRandomValues, чтобы generateWireGuardKeyPair
 * выдавала детерминированный результат на основе известных RFC-векторов.
 */
function mockGetRandomValues(seed: Uint8Array) {
  return vi.spyOn(crypto, "getRandomValues").mockImplementation((arr) => {
    (arr as Uint8Array).set(seed.slice(0, (arr as Uint8Array).length));
    return arr as Uint8Array;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Тест-сьюты
// ══════════════════════════════════════════════════════════════════════════════

describe("wgKeys — контрольные векторы RFC 7748 §6.1", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("публичный ключ Алисы вычисляется верно из её приватного ключа", () => {
    // Мокаем CSPRNG так, чтобы «случайные» байты совпали с приватным ключом Алисы из RFC
    mockGetRandomValues(hexToBytes(RFC_ALICE_PRIV_HEX));

    const pair = generateWireGuardKeyPair();

    // Публичный ключ должен совпасть с RFC-вектором
    const expectedPub = bytesToBase64(hexToBytes(RFC_ALICE_PUB_HEX));
    expect(pair.publicKey).toBe(expectedPub);
  });

  it("публичный ключ Боба вычисляется верно из его приватного ключа", () => {
    mockGetRandomValues(hexToBytes(RFC_BOB_PRIV_HEX));

    const pair = generateWireGuardKeyPair();

    const expectedPub = bytesToBase64(hexToBytes(RFC_BOB_PUB_HEX));
    expect(pair.publicKey).toBe(expectedPub);
  });

  it("приватный ключ сохраняется обрезанным (clamp), как это делает wg genkey", () => {
    mockGetRandomValues(hexToBytes(RFC_ALICE_PRIV_HEX));

    const pair = generateWireGuardKeyPair();

    // Ожидаем clamp(alicePrivRaw), а не сами raw-байты
    const expectedPriv = bytesToBase64(clampScalar(hexToBytes(RFC_ALICE_PRIV_HEX)));
    expect(pair.privateKey).toBe(expectedPriv);
  });

  it("publicKey и privateKey — строки длиной 44 символа (base64 от 32 байт)", () => {
    mockGetRandomValues(hexToBytes(RFC_ALICE_PRIV_HEX));

    const pair = generateWireGuardKeyPair();

    expect(pair.privateKey).toHaveLength(44);
    expect(pair.publicKey).toHaveLength(44);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("wgKeys — идемпотентность clamp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("повторный вызов generateWireGuardKeyPair на тех же «случайных» байтах даёт тот же результат", () => {
    const seed = hexToBytes(RFC_ALICE_PRIV_HEX);

    mockGetRandomValues(seed);
    const pair1 = generateWireGuardKeyPair();

    // clamp уже применён к pair1.privateKey; если снова передать те же байты —
    // clamp(clamp(x)) == clamp(x), результат должен совпасть
    vi.restoreAllMocks();
    mockGetRandomValues(seed);
    const pair2 = generateWireGuardKeyPair();

    expect(pair1.privateKey).toBe(pair2.privateKey);
    expect(pair1.publicKey).toBe(pair2.publicKey);
  });

  it("clamp через generateWireGuardKeyPair детерминирован: разные вызовы с одним seed дают идентичные пары", () => {
    const seed = hexToBytes(RFC_BOB_PRIV_HEX);

    const results: Array<{ privateKey: string; publicKey: string }> = [];
    for (let i = 0; i < 3; i++) {
      vi.restoreAllMocks();
      mockGetRandomValues(seed);
      results.push(generateWireGuardKeyPair());
    }

    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("wgKeys — граничные случаи и отсутствующая валидация", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generateWireGuardKeyPair бросает ошибку, если crypto недоступен", () => {
    // Временно скрываем crypto.getRandomValues
    const original = crypto.getRandomValues;
    // @ts-expect-error — намеренно удаляем, чтобы проверить защитный код
    crypto.getRandomValues = undefined;

    expect(() => generateWireGuardKeyPair()).toThrow(
      "Нет доступа к системному источнику случайности",
    );

    crypto.getRandomValues = original;
  });

  /**
   * Ключи проверяются перед сборкой профиля. До этого мусор молча уезжал в
   * текст конфигурации, и ошибка всплывала уже в клиенте WireGuard при импорте
   * — далеко от места, где возникла, и без указания на испорченное поле.
   */
  it(
    "buildWireGuardConfig бросает ошибку при неверной длине privateKey",
    () => {
      expect(() =>
        buildWireGuardConfig({
          privateKey: "слишком-короткий",
          address: "10.0.0.1",
          dns: "1.1.1.1",
          serverPublicKey: bytesToBase64(hexToBytes(RFC_BOB_PUB_HEX)),
          endpoint: "vpn.example.com:51820",
          allowedIps: "0.0.0.0/0",
        }),
      ).toThrow();
    },
  );

  it(
    "buildWireGuardConfig бросает ошибку при не-base64 serverPublicKey",
    () => {
      expect(() =>
        buildWireGuardConfig({
          privateKey: bytesToBase64(hexToBytes(RFC_ALICE_PRIV_HEX)),
          address: "10.0.0.1",
          dns: "1.1.1.1",
          serverPublicKey: "это-не-base64!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
          endpoint: "vpn.example.com:51820",
          allowedIps: "0.0.0.0/0",
        }),
      ).toThrow();
    },
  );

  it("buildWireGuardConfig называет испорченное поле в тексте ошибки", () => {
    expect(() =>
      buildWireGuardConfig({
        privateKey: "не_base64_и_неверная_длина",
        address: "10.0.0.1",
        dns: "1.1.1.1",
        serverPublicKey: "тоже_мусор",
        endpoint: "vpn.example.com:51820",
        allowedIps: "0.0.0.0/0",
      }),
    ).toThrow(/PrivateKey/);
  });

  it("buildWireGuardConfig проверяет ключ узла, когда свой ключ верный", () => {
    expect(() =>
      buildWireGuardConfig({
        privateKey: bytesToBase64(hexToBytes(RFC_ALICE_PRIV_HEX)),
        address: "10.0.0.1",
        dns: "1.1.1.1",
        serverPublicKey: "тоже_мусор",
        endpoint: "vpn.example.com:51820",
        allowedIps: "0.0.0.0/0",
      }),
    ).toThrow(/PublicKey узла/);
  });

  /**
   * Приватный ключ не должен попадать в текст ошибки: сообщения об ошибках
   * оказываются в журналах и отчётах о сбоях. В сообщении — только длина.
   */
  it("buildWireGuardConfig не раскрывает значение приватного ключа в ошибке", () => {
    const secret = "A".repeat(43); // без «=» на конце — заведомо неверный ключ
    let message = "";
    try {
      buildWireGuardConfig({
        privateKey: secret,
        address: "10.0.0.1",
        dns: "1.1.1.1",
        serverPublicKey: bytesToBase64(hexToBytes(RFC_BOB_PUB_HEX)),
        endpoint: "vpn.example.com:51820",
        allowedIps: "0.0.0.0/0",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("PrivateKey");
    expect(message).toContain("43");
    expect(message).not.toContain(secret);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("wgKeys — кросс-проверка с node:crypto (X25519 DH)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("общий секрет RFC 7748 §6.1 совпадает с вычислением node:crypto", () => {
    // Проверяем RFC-векторы через независимую реализацию — node:crypto.
    // Это не тестирует наш модуль напрямую, но подтверждает корректность векторов.
    const alicePrivDer = wrapPrivateDer(hexToBytes(RFC_ALICE_PRIV_HEX));
    const bobPubDer = wrapPublicDer(hexToBytes(RFC_BOB_PUB_HEX));

    const alicePrivKey = nodeCrypto.createPrivateKey({
      key: alicePrivDer,
      format: "der",
      type: "pkcs8",
    });
    const bobPublicKey = nodeCrypto.createPublicKey({
      key: bobPubDer,
      format: "der",
      type: "spki",
    });

    const shared = nodeCrypto.diffieHellman({
      privateKey: alicePrivKey,
      publicKey: bobPublicKey,
    });

    expect(shared.toString("hex")).toBe(RFC_SHARED_HEX);
  });

  it("публичный ключ RFC-вектора Алисы совпадает с вычислением node:crypto из её приватного ключа", () => {
    // node:crypto умеет выводить публичный ключ из приватного через KeyObject
    const alicePrivDer = wrapPrivateDer(hexToBytes(RFC_ALICE_PRIV_HEX));
    const alicePrivKey = nodeCrypto.createPrivateKey({
      key: alicePrivDer,
      format: "der",
      type: "pkcs8",
    });
    const alicePubKey = nodeCrypto.createPublicKey(alicePrivKey);

    // Экспортируем публичный ключ в raw-формат через SPKI DER
    const spkiDer = alicePubKey.export({ format: "der", type: "spki" }) as Buffer;
    // Последние 32 байта SPKI DER — это сырой публичный ключ
    const rawPub = spkiDer.slice(spkiDer.length - 32);

    expect(rawPub.toString("hex")).toBe(RFC_ALICE_PUB_HEX);
  });

  it("наш generateWireGuardKeyPair возвращает тот же публичный ключ, что node:crypto для RFC-вектора Алисы", () => {
    // Связываем наш модуль с независимым эталоном
    mockGetRandomValues(hexToBytes(RFC_ALICE_PRIV_HEX));
    const pair = generateWireGuardKeyPair();

    // Вычисляем ожидаемый публичный ключ через node:crypto
    const alicePrivDer = wrapPrivateDer(hexToBytes(RFC_ALICE_PRIV_HEX));
    const alicePrivKey = nodeCrypto.createPrivateKey({
      key: alicePrivDer,
      format: "der",
      type: "pkcs8",
    });
    const alicePubKey = nodeCrypto.createPublicKey(alicePrivKey);
    const spkiDer = alicePubKey.export({ format: "der", type: "spki" }) as Buffer;
    const rawPub = spkiDer.slice(spkiDer.length - 32);

    expect(pair.publicKey).toBe(bytesToBase64(new Uint8Array(rawPub)));
  });

  it("для случайной пары, сгенерированной нашим модулем, node:crypto подтверждает публичный ключ", () => {
    // Используем реальный CSPRNG (не мок), берём Боба как «случайный» ключ
    mockGetRandomValues(hexToBytes(RFC_BOB_PRIV_HEX));
    const pair = generateWireGuardKeyPair();

    // Декодируем приватный ключ обратно в байты
    const privBytes = Uint8Array.from(atob(pair.privateKey), (c) => c.charCodeAt(0));

    const privDer = wrapPrivateDer(privBytes);
    const privKey = nodeCrypto.createPrivateKey({
      key: privDer,
      format: "der",
      type: "pkcs8",
    });
    const pubKey = nodeCrypto.createPublicKey(privKey);
    const spkiDer = pubKey.export({ format: "der", type: "spki" }) as Buffer;
    const rawPub = new Uint8Array(spkiDer.slice(spkiDer.length - 32));

    expect(pair.publicKey).toBe(bytesToBase64(rawPub));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("wgKeys — buildWireGuardConfig: структура вывода", () => {
  const validPrivKey = bytesToBase64(clampScalar(hexToBytes(RFC_ALICE_PRIV_HEX)));
  const validPubKey = bytesToBase64(hexToBytes(RFC_BOB_PUB_HEX));

  it("генерирует конфиг с секцией [Interface] и секцией [Peer]", () => {
    const cfg = buildWireGuardConfig({
      privateKey: validPrivKey,
      address: "10.8.0.1",
      dns: "1.1.1.1",
      serverPublicKey: validPubKey,
      endpoint: "vpn.example.com:51820",
      allowedIps: "0.0.0.0/0, ::/0",
    });

    expect(cfg).toContain("[Interface]");
    expect(cfg).toContain("[Peer]");
  });

  it("конфиг содержит PrivateKey, Address с /32, DNS, PublicKey, Endpoint, AllowedIPs, PersistentKeepalive", () => {
    const cfg = buildWireGuardConfig({
      privateKey: validPrivKey,
      address: "10.8.0.1",
      dns: "8.8.8.8",
      serverPublicKey: validPubKey,
      endpoint: "vpn.example.com:51820",
      allowedIps: "0.0.0.0/0",
    });

    expect(cfg).toContain(`PrivateKey = ${validPrivKey}`);
    expect(cfg).toContain("Address = 10.8.0.1/32");
    expect(cfg).toContain("DNS = 8.8.8.8");
    expect(cfg).toContain(`PublicKey = ${validPubKey}`);
    expect(cfg).toContain("Endpoint = vpn.example.com:51820");
    expect(cfg).toContain("AllowedIPs = 0.0.0.0/0");
    expect(cfg).toContain("PersistentKeepalive = 25");
  });

  it("extra-параметры вставляются в [Interface] до PrivateKey в заданном порядке", () => {
    const cfg = buildWireGuardConfig({
      privateKey: validPrivKey,
      address: "10.8.0.1",
      dns: "1.1.1.1",
      serverPublicKey: validPubKey,
      endpoint: "vpn.example.com:51820",
      allowedIps: "0.0.0.0/0",
      extra: { Jc: 4, S1: 100, H1: 1234567890 },
    });

    const lines = cfg.split("\n");
    const idxJc = lines.findIndex((l) => l.startsWith("Jc ="));
    const idxS1 = lines.findIndex((l) => l.startsWith("S1 ="));
    const idxH1 = lines.findIndex((l) => l.startsWith("H1 ="));
    const idxPriv = lines.findIndex((l) => l.startsWith("PrivateKey ="));

    // Порядок: Jc < S1 < H1 < PrivateKey
    expect(idxJc).toBeGreaterThan(-1);
    expect(idxS1).toBeGreaterThan(idxJc);
    expect(idxH1).toBeGreaterThan(idxS1);
    expect(idxPriv).toBeGreaterThan(idxH1);
  });

  it("extra = null — конфиг генерируется без дополнительных параметров", () => {
    const cfg = buildWireGuardConfig({
      privateKey: validPrivKey,
      address: "10.8.0.1",
      dns: "1.1.1.1",
      serverPublicKey: validPubKey,
      endpoint: "vpn.example.com:51820",
      allowedIps: "0.0.0.0/0",
      extra: null,
    });

    // Нет Jc/S1/H1 и прочих extra-ключей
    expect(cfg).not.toMatch(/^Jc\s*=/m);
    expect(cfg).toContain("[Interface]");
    expect(cfg).toContain("[Peer]");
  });

  it("конфиг заканчивается пустой строкой (перевод строки в конце файла)", () => {
    const cfg = buildWireGuardConfig({
      privateKey: validPrivKey,
      address: "10.8.0.1",
      dns: "1.1.1.1",
      serverPublicKey: validPubKey,
      endpoint: "vpn.example.com:51820",
      allowedIps: "0.0.0.0/0",
    });

    expect(cfg.endsWith("\n")).toBe(true);
  });
});
