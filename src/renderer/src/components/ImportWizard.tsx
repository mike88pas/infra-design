/**
 * Kreator importu rzutu — formularz WARTOŚCI POCZĄTKOWYCH (F2).
 *
 * Pokazywany po wczytaniu DXF, zanim geometria zamieni się w urządzenia/BOM.
 * Startuje od heurystyk (`buildDefaultProfile`), pozwala projektantowi potwierdzić/poprawić:
 * dane projektu, numer kondygnacji, skalę, warstwy ścian + eksplozję bloków,
 * mapowanie warstw→systemy oraz narzuty kosztorysu. Zwraca gotowy `ImportProfile`.
 */

import { useMemo, useState } from 'react'
import type { DxfDocument } from '../../../domain/model/schema'
import { buildDefaultProfile, type ImportProfile } from '../../../domain/dxf/importProfile'
import type { SystemTypeMapping } from '../../../domain/dxf/systemMapping'

interface Target {
  key: string
  label: string
  value: SystemTypeMapping | null
}

// Cele mapowania warstwy (kolejność = lista rozwijana w formularzu).
const TARGETS: Target[] = [
  { key: 'unset', label: '— nie przypisano —', value: null },
  { key: 'ignore', label: '— pomiń (legenda/podkład/strefy) —', value: null },
  { key: 'lan.outlet.2x', label: 'LAN · gniazdo 2×RJ45', value: { system: 'lan', typeKey: 'lan.outlet.2x' } },
  { key: 'lan.ap', label: 'LAN · Access Point', value: { system: 'lan', typeKey: 'lan.ap' } },
  { key: 'cctv.dome.4mp', label: 'CCTV · kamera', value: { system: 'cctv', typeKey: 'cctv.dome.4mp' } },
  { key: 'kd.reader', label: 'KD · czytnik', value: { system: 'kd', typeKey: 'kd.reader' } },
  { key: 'kd.intercom', label: 'KD · intercom', value: { system: 'kd', typeKey: 'kd.intercom' } }
]

const inp = 'w-full rounded bg-black/30 px-2 py-1 text-xs outline-none focus:bg-black/40'

/** Bieżący klucz Target dla warstwy (mapping: undefined→unset, null→ignore, {…}→typeKey). */
function targetKeyFor(profile: ImportProfile, layer: string): string {
  if (!(layer in profile.systemMapping)) return 'unset'
  const m = profile.systemMapping[layer]
  if (m === null) return 'ignore'
  return m.typeKey
}

export interface ImportWizardProps {
  doc: DxfDocument
  fileName: string
  /** Wartości wstępne (np. z poprzedniego importu); domyślnie z heurystyk. */
  initial?: Partial<Pick<ImportProfile, 'projectName' | 'client'>>
  onConfirm: (profile: ImportProfile) => void
  onCancel: () => void
}

export function ImportWizard({ doc, fileName, initial, onConfirm, onCancel }: ImportWizardProps): JSX.Element {
  const [profile, setProfile] = useState<ImportProfile>(() =>
    buildDefaultProfile({
      layers: doc.layers,
      units: doc.units,
      fileName,
      projectName: initial?.projectName,
      client: initial?.client
    })
  )

  const set = <K extends keyof ImportProfile>(key: K, val: ImportProfile[K]): void =>
    setProfile((p) => ({ ...p, [key]: val }))

  // Warstwy istotne dla mapowania: te z heurystyki (urządzenia + świadomie pominięte).
  // Resztę (146 warstw rysunku) chowamy — projektant może dołożyć przez „pokaż wszystkie”.
  const [showAll, setShowAll] = useState(false)
  const layerRows = useMemo(() => {
    const names = doc.layers.map((l) => l.name)
    return showAll ? names : names.filter((n) => n in profile.systemMapping)
  }, [doc.layers, showAll, profile.systemMapping])

  const deviceLayerCount = useMemo(
    () => Object.values(profile.systemMapping).filter((m) => m !== null).length,
    [profile.systemMapping]
  )

  function setLayerTarget(layer: string, targetKey: string): void {
    setProfile((p) => {
      const next = { ...p.systemMapping }
      if (targetKey === 'unset') delete next[layer]
      else {
        const t = TARGETS.find((x) => x.key === targetKey)
        next[layer] = t ? t.value : null
      }
      return { ...p, systemMapping: next }
    })
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6 backdrop-blur">
      <div className="flex max-h-full w-[640px] flex-col overflow-hidden rounded-lg border border-white/10 bg-ink shadow-2xl">
        <header className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-semibold">Kreator importu — wartości początkowe</h2>
          <p className="text-xs text-slate-400">{fileName} · {doc.layers.length} warstw · {doc.entityCount} encji</p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {/* Projekt */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Nazwa projektu">
              <input className={inp} value={profile.projectName} onChange={(e) => set('projectName', e.target.value)} />
            </Field>
            <Field label="Klient / inwestor">
              <input className={inp} value={profile.client} onChange={(e) => set('client', e.target.value)} />
            </Field>
            <Field label="Nazwa rysunku">
              <input className={inp} value={profile.drawingName} onChange={(e) => set('drawingName', e.target.value)} />
            </Field>
            <Field label="Kondygnacja (nr)">
              <input type="number" className={inp} value={profile.level} onChange={(e) => set('level', Number(e.target.value))} />
            </Field>
          </section>

          {/* Skala / jednostki */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Jednostka modelu (wykryta)">
              <input className={`${inp} opacity-60`} value={profile.units} disabled />
            </Field>
            <Field label="Skala: mm na jednostkę">
              <input type="number" step="0.0001" className={inp} value={profile.unitMm} onChange={(e) => set('unitMm', Number(e.target.value))} />
            </Field>
          </section>

          {/* Geometria pomieszczeń */}
          <section className="space-y-2 rounded border border-white/10 p-3">
            <h3 className="font-semibold text-slate-300">Pomieszczenia</h3>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" checked={profile.roomSource === 'area'} onChange={() => set('roomSource', 'area')} />
                <span>Etykiety pól (A-AREA — numer/nazwa/metraż)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={profile.roomSource === 'walls'} onChange={() => set('roomSource', 'walls')} />
                <span>Ze ścian (polygonize)</span>
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={profile.explodeBlocks} onChange={(e) => set('explodeBlocks', e.target.checked)} />
              <span>Eksploduj bloki (podkład bywa jednym blokiem)</span>
            </label>
            {profile.roomSource === 'area' ? (
              <Field label="Warstwy etykiet pól (tokeny, po przecinku)">
                <input
                  className={inp}
                  value={profile.areaLayers.join(', ')}
                  onChange={(e) => set('areaLayers', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>
            ) : (
              <Field label="Warstwy ścian (tokeny, po przecinku — dopasowanie po podłańcuchu)">
                <input
                  className={inp}
                  value={profile.wallLayers.join(', ')}
                  onChange={(e) => set('wallLayers', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>
            )}
          </section>

          {/* Trasowanie */}
          <section className="space-y-2 rounded border border-white/10 p-3">
            <h3 className="font-semibold text-slate-300">Trasowanie kabli (A*)</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={profile.doRouting} onChange={(e) => set('doRouting', e.target.checked)} />
              <span>Trasuj kable urządzenie→szafa (cięższe, omija ściany)</span>
            </label>
            <Field label="Warstwy szaf/rozdzielni (cele tras)">
              <input
                className={inp}
                value={profile.targetLayers.join(', ')}
                onChange={(e) => set('targetLayers', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </Field>
          </section>

          {/* Mapowanie warstw → systemy */}
          <section className="space-y-2 rounded border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-300">
                Mapowanie warstw → systemy <span className="text-slate-500">({deviceLayerCount} warstw urządzeń)</span>
              </h3>
              <button className="text-[10px] text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'tylko rozpoznane' : 'pokaż wszystkie warstwy'}
              </button>
            </div>
            <ul className="space-y-1">
              {layerRows.map((name) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="flex-1 truncate" title={name}>{name}</span>
                  <select
                    className={`${inp} w-56 shrink-0`}
                    value={targetKeyFor(profile, name)}
                    onChange={(e) => setLayerTarget(name, e.target.value)}
                  >
                    {TARGETS.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </li>
              ))}
              {layerRows.length === 0 && <li className="text-slate-500">Brak rozpoznanych warstw — kliknij „pokaż wszystkie”.</li>}
            </ul>
          </section>

          {/* Kosztorys */}
          <section className="grid grid-cols-3 gap-3">
            <Field label="Zapas kabla [%]">
              <input type="number" className={inp} value={profile.cableSparePct} onChange={(e) => set('cableSparePct', Number(e.target.value))} />
            </Field>
            <Field label="Narzut Kp+Z [%]">
              <input type="number" className={inp} value={profile.overheadPct} onChange={(e) => set('overheadPct', Number(e.target.value))} />
            </Field>
            <Field label="VAT [%]">
              <input type="number" className={inp} value={profile.vatPct} onChange={(e) => set('vatPct', Number(e.target.value))} />
            </Field>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={onCancel} className="rounded bg-white/10 px-4 py-2 text-xs hover:bg-white/15">Anuluj</button>
          <button onClick={() => onConfirm(profile)} className="rounded bg-accent/20 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/30">
            Importuj instalacje
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}
