import { useEffect, useState, type FormEvent } from 'react'

/**
 * Brama dostępu (logowanie). Pierwsze uruchomienie: ustawienie hasła. Kolejne:
 * odblokowanie. Hasło chroni dostęp i szyfruje projekty `.infra` at-rest — klucz
 * żyje tylko w procesie głównym. Renderer nie widzi klucza ani hasła po odblokowaniu.
 */
export function Gate({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const [mode, setMode] = useState<'loading' | 'setup' | 'unlock'>('loading')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.infra.security
      .status()
      .then((s) => {
        if (s.unlocked) onUnlocked()
        else setMode(s.initialized ? 'unlock' : 'setup')
      })
      .catch(() => setMode('unlock'))
  }, [onUnlocked])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      if (mode === 'setup') {
        if (pwd.length < 8) throw new Error('Hasło musi mieć co najmniej 8 znaków')
        if (pwd !== pwd2) throw new Error('Hasła nie są takie same')
        await window.infra.security.setup(pwd)
        onUnlocked()
      } else {
        const r = await window.infra.security.unlock(pwd)
        if (!r.ok) throw new Error('Nieprawidłowe hasło')
        onUnlocked()
      }
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inp =
    'w-full rounded bg-black/30 px-3 py-2 text-sm outline-none focus:bg-black/40 border border-white/10'

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0b1220] text-slate-100">
      <form
        onSubmit={submit}
        className="w-[360px] rounded-xl border border-white/10 bg-white/5 p-6 shadow-2xl"
      >
        <div className="mb-1 text-lg font-semibold">
          Infra<span className="text-sky-400">Design</span>
        </div>
        {mode === 'loading' ? (
          <p className="text-sm text-slate-400">Ładowanie…</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-400">
              {mode === 'setup'
                ? 'Ustaw hasło dostępu. Chroni projekty i szyfruje je na dysku. Hasła nie da się odzyskać — zapamiętaj je.'
                : 'Wpisz hasło, aby odblokować aplikację i projekty.'}
            </p>
            <label className="mb-1 block text-xs text-slate-400">Hasło</label>
            <input
              type="password"
              className={inp}
              value={pwd}
              autoFocus
              onChange={(e) => setPwd(e.target.value)}
            />
            {mode === 'setup' && (
              <>
                <label className="mb-1 mt-3 block text-xs text-slate-400">Powtórz hasło</label>
                <input
                  type="password"
                  className={inp}
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                />
              </>
            )}
            {err && <p className="mt-3 text-sm text-amber-400">{err}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-4 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? '…' : mode === 'setup' ? 'Ustaw hasło i wejdź' : 'Odblokuj'}
            </button>
            <p className="mt-4 text-[11px] leading-snug text-slate-500">
              Dane klienta nigdy nie opuszczają tego komputera. Projekty są szyfrowane (AES-256-GCM)
              kluczem wyprowadzonym z hasła.
            </p>
          </>
        )}
      </form>
    </div>
  )
}
