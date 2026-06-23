import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptBundle, decryptBundle, isEncrypted, isLegacyPlain } from './container'

describe('kontener szyfrujący .infra (AES-256-GCM)', () => {
  const key = randomBytes(32)
  const data = Buffer.from('SQLite format 3\0reszta-bazy-danych-projektu', 'latin1')

  it('round-trip: encrypt → decrypt zwraca te same bajty', () => {
    const enc = encryptBundle(key, data)
    expect(isEncrypted(enc)).toBe(true)
    const dec = decryptBundle(key, enc)
    expect(Buffer.from(dec).equals(data)).toBe(true)
  })

  it('dwa szyfrowania tych samych danych dają różne ciphertexty (losowe salt/iv)', () => {
    const a = encryptBundle(key, data)
    const b = encryptBundle(key, data)
    expect(a.equals(b)).toBe(false)
  })

  it('zły klucz → błąd odszyfrowania', () => {
    const enc = encryptBundle(key, data)
    expect(() => decryptBundle(randomBytes(32), enc)).toThrow(/odszyfrowa/)
  })

  it('manipulacja ciphertextem → błąd (GCM wykrywa)', () => {
    const enc = encryptBundle(key, data)
    enc[enc.length - 1] ^= 0xff
    expect(() => decryptBundle(key, enc)).toThrow(/odszyfrowa/)
  })

  it('wykrywa stary jawny plik SQLite', () => {
    expect(isLegacyPlain(data)).toBe(true)
    expect(isEncrypted(data)).toBe(false)
  })

  it('odrzuca bufor, który nie jest kontenerem INFRA1', () => {
    expect(() => decryptBundle(key, Buffer.from('cokolwiek'))).toThrow(/nie jest/)
  })
})
