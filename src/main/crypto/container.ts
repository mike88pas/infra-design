/**
 * Kontener szyfrujący paczkę `.infra` w spoczynku (at-rest).
 *
 * Dane klienta (NDA) nie mogą leżeć jawnie na dysku — kradzież dysku/pliku nie może
 * skutkować wyciekiem. Szyfrujemy bajty bazy SQLite uwierzytelnionym AES-256-GCM
 * (integralność + poufność). Klucz pliku wyprowadzamy z klucza głównego przez HKDF
 * z solą per-plik (kompromitacja jednego pliku nie pomaga przy innych).
 *
 * Format binarny:
 *   magic "INFRA1\0" (7B) | version (1B) | salt (16B) | iv (12B) | tag (16B) | ciphertext
 *
 * Moduł jest czysty (tylko node:crypto) — testowalny bez Electrona.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const MAGIC = Buffer.from('INFRA1\0', 'latin1') // 7 bajtów
const VERSION = 1
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN

/** Nagłówek jawnego pliku SQLite (stare, niezaszyfrowane paczki `.infra`). */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

function fileKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, Buffer.from('infra-file'), 32))
}

/** Czy bufor to zaszyfrowana paczka Infra (magic INFRA1). */
export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)
}

/** Czy bufor to stara, jawna baza SQLite (paczka sprzed szyfrowania). */
export function isLegacyPlain(buf: Buffer): boolean {
  return buf.length >= SQLITE_MAGIC.length && buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
}

/** Szyfruje bajty (zrzut SQLite) → kontener INFRA1. */
export function encryptBundle(masterKey: Buffer, plaintext: Uint8Array): Buffer {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = fileKey(masterKey, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ct])
}

/** Odszyfrowuje kontener INFRA1 → oryginalne bajty. Rzuca przy złym kluczu/uszkodzeniu. */
export function decryptBundle(masterKey: Buffer, buf: Buffer): Buffer {
  if (!isEncrypted(buf)) throw new Error('Plik nie jest zaszyfrowaną paczką Infra')
  if (buf.length < HEADER_LEN) throw new Error('Uszkodzony kontener (za krótki)')
  let off = MAGIC.length
  const ver = buf[off]
  off += 1
  if (ver !== VERSION) throw new Error(`Nieobsługiwana wersja kontenera: ${ver}`)
  const salt = buf.subarray(off, off + SALT_LEN)
  off += SALT_LEN
  const iv = buf.subarray(off, off + IV_LEN)
  off += IV_LEN
  const tag = buf.subarray(off, off + TAG_LEN)
  off += TAG_LEN
  const ct = buf.subarray(off)
  const key = fileKey(masterKey, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    throw new Error('Nie udało się odszyfrować — złe hasło lub uszkodzony plik')
  }
}
