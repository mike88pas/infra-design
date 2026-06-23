/**
 * Keystore — brama hasła aplikacji (proces główny). „Logowanie" dla desktopa.
 *
 * Hasło użytkownika → klucz główny (scrypt, memory-hard). Klucza NIGDY nie zapisujemy
 * ani nie wystawiamy do renderera; żyje wyłącznie w pamięci procesu głównego, dopóki
 * aplikacja jest odblokowana. Na dysku trzymamy tylko sól + weryfikator (HMAC klucza),
 * by sprawdzić poprawność hasła bez przechowywania sekretu.
 *
 * Klucz służy do szyfrowania paczek `.infra` at-rest (patrz crypto/container.ts).
 * Utrata hasła = brak dostępu do zaszyfrowanych projektów (świadomy kompromis dla NDA).
 */

import { app } from 'electron'
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface KeyFile {
  version: 1
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  salt: string // base64
  verifier: string // base64
}

// Parametry scrypt: N=2^15 (32768) — memory-hard, ~kilkadziesiąt ms przy starcie.
const SCRYPT = { N: 1 << 15, r: 8, p: 1 }
const MIN_PASSWORD = 8

let masterKey: Buffer | null = null

function keyFilePath(): string {
  return join(app.getPath('userData'), 'keyfile.json')
}

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return scryptSync(password, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 })
}

function verifierOf(key: Buffer): Buffer {
  return createHmac('sha256', key).update('infra-verify').digest()
}

/** Czy hasło zostało już kiedyś ustawione (istnieje keyfile). */
export function isInitialized(): boolean {
  return existsSync(keyFilePath())
}

/** Czy aplikacja jest odblokowana (klucz w pamięci). */
export function isUnlocked(): boolean {
  return masterKey !== null
}

/** Pierwsze uruchomienie: ustawia hasło i odblokowuje. */
export function setupPassword(password: string): void {
  if (isInitialized()) throw new Error('Hasło jest już ustawione')
  if (!password || password.length < MIN_PASSWORD) {
    throw new Error(`Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków`)
  }
  const salt = randomBytes(16)
  const key = derive(password, salt, SCRYPT)
  const kf: KeyFile = {
    version: 1,
    kdf: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString('base64'),
    verifier: verifierOf(key).toString('base64')
  }
  writeFileSync(keyFilePath(), JSON.stringify(kf), { encoding: 'utf-8', mode: 0o600 })
  masterKey = key
}

/** Odblokowanie istniejącym hasłem. Zwraca false przy złym haśle. */
export function unlock(password: string): boolean {
  if (!isInitialized()) throw new Error('Hasło nie zostało jeszcze ustawione')
  const kf = JSON.parse(readFileSync(keyFilePath(), 'utf-8')) as KeyFile
  const salt = Buffer.from(kf.salt, 'base64')
  const key = derive(password, salt, { N: kf.N, r: kf.r, p: kf.p })
  const expected = Buffer.from(kf.verifier, 'base64')
  const got = verifierOf(key)
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false
  masterKey = key
  return true
}

/** Blokuje aplikację — usuwa klucz z pamięci. */
export function lock(): void {
  masterKey = null
}

/** Klucz główny (do szyfrowania paczek). Rzuca, gdy aplikacja zablokowana. */
export function getMasterKey(): Buffer {
  if (!masterKey) throw new Error('Aplikacja zablokowana')
  return masterKey
}
