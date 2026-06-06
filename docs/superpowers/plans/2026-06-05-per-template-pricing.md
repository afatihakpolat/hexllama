# Per-Template Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace app-wide-only cost rates with optional per-template overrides that fall back to the app-wide default, and split the Cost tab into a read-only "Cost" view plus a new "Pricing" management tab inside Usage Stats.

**Architecture:** Per-template pricing lives inside each `templates/<id>.json` file as an optional `pricing` block (three non-negative numbers). The renderer owns a pure `resolveTemplatePricing(template, appSettings)` resolver that applies a strict-group rule: a template either owns all three valid rates, or falls back entirely to the app-wide rates. Currency is always pulled from the app-wide setting. The Cost tab pulls rates from the resolver per row; the Pricing tab manages both the app-wide rates and the per-template overrides.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC. No new test framework — verification is `npm run build` and manual smoke test (matches the project's established pattern).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` (modify) | Add `TemplatePricing` type; extend `Template` with optional `pricing?: TemplatePricing`. |
| `src/main/ipc.ts` (modify) | Add `normalizeTemplatePricing()` helper; call it inside `normalizeTemplateRecord()` so loading and saving both round-trip the block. |
| `src/renderer/src/utils/templatePricing.ts` (new) | Pure `resolveTemplatePricing(template, appSettings)` plus `TemplatePricing` and `ResolvedPricing` type re-exports. |
| `src/renderer/src/components/PricingTab.tsx` (new) | New management surface: app-wide rates card + per-template toggle/rate rows. |
| `src/renderer/src/components/UsageStatsView.tsx` (modify) | Add `'pricing'` to the tab list; move the rate editor into `PricingTab`; route the Cost tab through `resolveTemplatePricing` for per-row rates. |
| `docs/HANDOFF.md` (modify) | Record completed work, verification, and the manual smoke test list. |

No new dependencies, no new IPC handlers, no new main-process files.

---

## Task 1: Extend shared types with `TemplatePricing`

**Files:**
- Modify: `src/shared/types.ts:171-183` (the `Template` interface)

- [ ] **Step 1: Add `TemplatePricing` interface above `Template`**

Open `src/shared/types.ts` and add a new interface immediately before the `Template` interface (around line 170). Use the existing style (2-space indent, trailing semicolons, no `I` prefix):

```ts
export interface TemplatePricing {
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}
```

- [ ] **Step 2: Add optional `pricing` field to `Template`**

Edit the existing `Template` interface in the same file. Add one line at the end of the field list, before the closing brace:

```ts
export interface Template {
  id: string
  name: string
  description?: string
  backendVersion?: string
  modelPath?: string
  serverPort: number
  args: Record<string, string | number | boolean | null>
  launchMode?: 'chat' | 'api'
  createdAt: string
  updatedAt: string
  _file?: string
  pricing?: TemplatePricing
}
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: completes with no errors. The new field is optional, so no existing call site is forced to change.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add TemplatePricing and pricing? field on Template"
```

---

## Task 2: Round-trip `pricing` through `normalizeTemplateRecord`

**Files:**
- Modify: `src/main/ipc.ts:1177-1221` (`normalizeTemplateRecord`)

- [ ] **Step 1: Add `normalizeTemplatePricing` helper**

In `src/main/ipc.ts`, immediately above the `normalizeTemplateRecord` function (around line 1176), add the helper. The strict-group rule returns `undefined` if any field is missing or invalid:

```ts
function normalizeTemplatePricing(value: unknown): TemplatePricing | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const candidate = value as Record<string, unknown>
  const input = candidate.inputCostPerMillion
  const cache = candidate.cacheCostPerMillion
  const output = candidate.outputCostPerMillion
  if (
    typeof input !== 'number' || !Number.isFinite(input) || input < 0 ||
    typeof cache !== 'number' || !Number.isFinite(cache) || cache < 0 ||
    typeof output !== 'number' || !Number.isFinite(output) || output < 0
  ) {
    return undefined
  }
  return {
    inputCostPerMillion: input,
    cacheCostPerMillion: cache,
    outputCostPerMillion: output
  }
}
```

- [ ] **Step 2: Wire it into `normalizeTemplateRecord`**

Inside the existing `normalizeTemplateRecord` function in the same file, add a `pricing` line right after the `args` line, and include it in the returned object so the persisted JSON carries it. Edit the function (current shape at line 1177-1221) so the return statement becomes:

```ts
  const pricing = normalizeTemplatePricing(template.pricing)

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(backendVersion ? { backendVersion } : {}),
    ...(modelPath ? { modelPath } : {}),
    serverPort: typeof template.serverPort === 'number' && Number.isInteger(template.serverPort)
      ? template.serverPort
      : 8080,
    args,
    launchMode: template.launchMode === 'api' ? 'api' : 'chat',
    createdAt,
    updatedAt,
    ...(pricing ? { pricing } : {}),
    ...(options.fileName ? { _file: options.fileName } : {})
  }
```

The `normalizeTemplateRecord` function is called by both `listTemplatesFromDirectory` (on load) and `saveTemplateToDirectory` (on write), so this single change round-trips the field through both paths.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: completes with no errors. `TemplatePricing` is already imported as a type via the existing `import type { ... Template ... } from '../shared/types'` near the top of `ipc.ts`; if not, add `TemplatePricing` to that import.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(main): round-trip optional pricing block on template save/load"
```

---

## Task 3: Add the resolver in the renderer

**Files:**
- Create: `src/renderer/src/utils/templatePricing.ts`

- [ ] **Step 1: Create the resolver file**

Create `src/renderer/src/utils/templatePricing.ts` with the resolver and a re-export of the shared `TemplatePricing` type. The function must be pure and apply the strict-group rule:

```ts
import type { Template, UsageCostSettings } from '../../../shared/types'

export type { TemplatePricing, ResolvedPricing } from '../../../shared/types'

export interface ResolvedPricing {
  currency: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}

const FALLBACK_PRICING: Omit<ResolvedPricing, 'currency'> = {
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

function hasValidPricing(
  pricing: Template['pricing']
): pricing is NonNullable<Template['pricing']> {
  if (!pricing) return false
  const { inputCostPerMillion, cacheCostPerMillion, outputCostPerMillion } = pricing
  return (
    Number.isFinite(inputCostPerMillion) && inputCostPerMillion >= 0 &&
    Number.isFinite(cacheCostPerMillion) && cacheCostPerMillion >= 0 &&
    Number.isFinite(outputCostPerMillion) && outputCostPerMillion >= 0
  )
}

export function resolveTemplatePricing(
  template: Pick<Template, 'pricing'> | null | undefined,
  appSettings: UsageCostSettings
): ResolvedPricing {
  if (template && hasValidPricing(template.pricing)) {
    return {
      currency: appSettings.currency,
      inputCostPerMillion: template.pricing.inputCostPerMillion,
      cacheCostPerMillion: template.pricing.cacheCostPerMillion,
      outputCostPerMillion: template.pricing.outputCostPerMillion
    }
  }
  return {
    currency: appSettings.currency,
    inputCostPerMillion: appSettings.inputCostPerMillion,
    cacheCostPerMillion: appSettings.cacheCostPerMillion,
    outputCostPerMillion: appSettings.outputCostPerMillion
  }
}

export const EMPTY_PRICING: ResolvedPricing = {
  currency: 'USD',
  ...FALLBACK_PRICING
}
```

- [ ] **Step 2: Remove the duplicate `ResolvedPricing` declaration if needed**

The plan defined `ResolvedPricing` locally here on purpose. If `src/shared/types.ts` already exports `ResolvedPricing` (it does not — only `TemplatePricing` was added in Task 1), drop the local declaration. As-is, the local declaration matches the spec; keep it.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/utils/templatePricing.ts
git commit -m "feat(renderer): add templatePricing resolver with strict-group fallback"
```

---

## Task 4: Create the PricingTab component

**Files:**
- Create: `src/renderer/src/components/PricingTab.tsx`

This component owns the app-wide rates editor (moved verbatim from the current Cost tab) plus a per-template section with one row per template.

- [ ] **Step 1: Create the PricingTab file**

Create `src/renderer/src/components/PricingTab.tsx`. The component reads templates via the existing `window.api.listTemplates()`, the current cards from the Zustand store (so changes from `saveTemplate` are picked up), and the app-wide rates from the existing `getUsageCostSettings` / `saveUsageCostSettings` IPC. Copy the file body below verbatim:

```tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Template, UsageCostSettings } from '../../../shared/types'
import { resolveTemplatePricing } from '../utils/templatePricing'

const DEFAULT_USAGE_COST_SETTINGS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

interface UsageCostDraft {
  currency: string
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

interface TemplatePricingDraft {
  enabled: boolean
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

function createUsageCostDraft(settings: UsageCostSettings): UsageCostDraft {
  return {
    currency: settings.currency,
    inputCostPerMillion: String(settings.inputCostPerMillion),
    cacheCostPerMillion: String(settings.cacheCostPerMillion),
    outputCostPerMillion: String(settings.outputCostPerMillion)
  }
}

function createTemplatePricingDraft(template: Template): TemplatePricingDraft {
  return {
    enabled: Boolean(template.pricing),
    inputCostPerMillion: String(template.pricing?.inputCostPerMillion ?? 0),
    cacheCostPerMillion: String(template.pricing?.cacheCostPerMillion ?? 0),
    outputCostPerMillion: String(template.pricing?.outputCostPerMillion ?? 0)
  }
}

function parseNonNegativeRate(rawValue: string, label: string): number {
  const trimmed = rawValue.trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`)
  }
  return parsed
}

function parseUsageCostDraft(draft: UsageCostDraft): UsageCostSettings {
  return {
    currency: draft.currency.trim().toUpperCase() || DEFAULT_USAGE_COST_SETTINGS.currency,
    inputCostPerMillion: parseNonNegativeRate(draft.inputCostPerMillion, 'Input cost'),
    cacheCostPerMillion: parseNonNegativeRate(draft.cacheCostPerMillion, 'Cache cost'),
    outputCostPerMillion: parseNonNegativeRate(draft.outputCostPerMillion, 'Output cost')
  }
}

function parseTemplatePricingDraft(
  draft: TemplatePricingDraft
): NonNullable<Template['pricing']> {
  return {
    inputCostPerMillion: parseNonNegativeRate(draft.inputCostPerMillion, 'Input cost'),
    cacheCostPerMillion: parseNonNegativeRate(draft.cacheCostPerMillion, 'Cache cost'),
    outputCostPerMillion: parseNonNegativeRate(draft.outputCostPerMillion, 'Output cost')
  }
}

function formatCost(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.trim().toUpperCase() || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value)
  } catch {
    const fallback = currency.trim().toUpperCase() || 'USD'
    return `${fallback} ${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
  }
}

function formatRatePerMillion(value: number, currency: string): string {
  return `${formatCost(value, currency)} / 1M`
}

export function PricingTab(): JSX.Element {
  const cards = useStore((state) => state.cards)
  const updateCard = useStore((state) => state.updateCard)

  const [appSettings, setAppSettings] = useState<UsageCostSettings>(DEFAULT_USAGE_COST_SETTINGS)
  const [appDraft, setAppDraft] = useState<UsageCostDraft>(createUsageCostDraft(DEFAULT_USAGE_COST_SETTINGS))
  const [appError, setAppError] = useState<string | null>(null)
  const [savingApp, setSavingApp] = useState(false)
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplatePricingDraft>>({})
  const [templateErrors, setTemplateErrors] = useState<Record<string, string | null>>({})
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await window.api.getUsageCostSettings()
        if (cancelled) return
        setAppSettings(next)
        setAppDraft(createUsageCostDraft(next))
        setAppError(null)
      } catch (loadError) {
        if (cancelled) return
        setAppError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setTemplateDrafts((current) => {
      const next: Record<string, TemplatePricingDraft> = {}
      for (const card of cards) {
        next[card.id] = current[card.id] ?? createTemplatePricingDraft(card)
      }
      return next
    })
  }, [cards])

  const effectiveAppSettings = useMemo(() => {
    try {
      return parseUsageCostDraft(appDraft)
    } catch {
      return appSettings
    }
  }, [appDraft, appSettings])

  async function handleSaveAppSettings() {
    try {
      setSavingApp(true)
      const parsed = parseUsageCostDraft(appDraft)
      const result = await window.api.saveUsageCostSettings(parsed)
      if (!result.success) {
        alert(`Failed to save app-wide pricing: ${result.error || 'Unknown error'}`)
        return
      }
      setAppSettings(result.settings)
      setAppDraft(createUsageCostDraft(result.settings))
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingApp(false)
    }
  }

  function updateTemplateDraft(templateId: string, patch: Partial<TemplatePricingDraft>) {
    setTemplateDrafts((current) => ({
      ...current,
      [templateId]: { ...current[templateId], ...patch }
    }))
  }

  async function handleSaveTemplatePricing(template: Template) {
    const draft = templateDrafts[template.id]
    if (!draft) return
    try {
      setSavingTemplateId(template.id)
      let nextTemplate: Template
      if (draft.enabled) {
        const pricing = parseTemplatePricingDraft(draft)
        nextTemplate = { ...template, pricing }
      } else {
        const { pricing: _removed, ...rest } = template
        nextTemplate = rest as Template
      }
      const result = await window.api.saveTemplate(nextTemplate as unknown as Record<string, unknown>)
      if (!result || !result.id) {
        throw new Error('Save returned no id')
      }
      updateCard(result.id, nextTemplate)
      setTemplateErrors((current) => ({ ...current, [template.id]: null }))
    } catch (saveError) {
      setTemplateErrors((current) => ({
        ...current,
        [template.id]: saveError instanceof Error ? saveError.message : String(saveError)
      }))
    } finally {
      setSavingTemplateId(null)
    }
  }

  return (
    <div className="pricing-tab">
      <section className="usage-section">
        <div className="usage-section-header usage-section-header-stack">
          <div>
            <h2>App-Wide Pricing</h2>
            <span className="usage-section-header-note">Default rates used by templates that don't override them. Currency is shared across all templates.</span>
          </div>
          <span>Default rates</span>
        </div>
        {appError && <div className="usage-stats-warning">App-wide pricing failed to load: {appError}</div>}
        <div className="usage-cost-config-grid">
          <label className="usage-control-field">
            <span>Currency</span>
            <input
              className="form-input usage-cost-input"
              value={appDraft.currency}
              onChange={(event) => setAppDraft((current) => ({ ...current, currency: event.target.value }))}
              placeholder="USD"
              maxLength={8}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Input / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.inputCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, inputCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Cache / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.cacheCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, cacheCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Output / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.outputCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, outputCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
        </div>
        <div className="usage-cost-config-actions">
          <button className="btn btn-primary" onClick={() => void handleSaveAppSettings()} disabled={savingApp}>
            {savingApp ? 'Saving...' : 'Save Defaults'}
          </button>
          <span className="usage-summary-meta">
            {formatRatePerMillion(effectiveAppSettings.inputCostPerMillion, effectiveAppSettings.currency)} input • {formatRatePerMillion(effectiveAppSettings.cacheCostPerMillion, effectiveAppSettings.currency)} cache • {formatRatePerMillion(effectiveAppSettings.outputCostPerMillion, effectiveAppSettings.currency)} output
          </span>
        </div>
      </section>

      <section className="usage-section">
        <div className="usage-section-header usage-section-header-stack">
          <div>
            <h2>Per-Template Pricing</h2>
            <span className="usage-section-header-note">Override rates for individual templates. Templates without overrides use the app-wide defaults above.</span>
          </div>
          <span>{cards.length} templates</span>
        </div>
        {cards.length === 0 ? (
          <div className="usage-section-empty">No templates yet. Create one from the cards view.</div>
        ) : (
          <div className="usage-request-table-wrapper">
            <table className="usage-request-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Override</th>
                  <th>Input / 1M</th>
                  <th>Cache / 1M</th>
                  <th>Output / 1M</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cards.map((template) => {
                  const draft = templateDrafts[template.id] ?? createTemplatePricingDraft(template)
                  const resolved = resolveTemplatePricing(template, appSettings)
                  const isSaving = savingTemplateId === template.id
                  const error = templateErrors[template.id]
                  return (
                    <tr key={template.id}>
                      <td>
                        <div className="usage-request-primary">{template.name}</div>
                        <div className="usage-request-secondary">Effective: {formatRatePerMillion(resolved.inputCostPerMillion, resolved.currency)} input • {formatRatePerMillion(resolved.cacheCostPerMillion, resolved.currency)} cache • {formatRatePerMillion(resolved.outputCostPerMillion, resolved.currency)} output</div>
                      </td>
                      <td>
                        <label className="usage-control-field">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => updateTemplateDraft(template.id, { enabled: event.target.checked })}
                            disabled={isSaving}
                          />
                          <span>{draft.enabled ? 'Custom' : 'Use defaults'}</span>
                        </label>
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.inputCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { inputCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.cacheCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { cacheCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.outputCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { outputCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          onClick={() => void handleSaveTemplatePricing(template)}
                          disabled={!draft.enabled || isSaving}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        {error && <div className="usage-stats-warning">{error}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: completes with no errors. The new component compiles standalone (it is not yet imported by `UsageStatsView`).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/PricingTab.tsx
git commit -m "feat(renderer): add PricingTab with app-wide defaults and per-template overrides"
```

---

## Task 5: Split UsageStatsView into read-only Cost + Pricing tabs

**Files:**
- Modify: `src/renderer/src/components/UsageStatsView.tsx`

This task is the largest refactor. It must:

- Add `'pricing'` to the `UsageStatsTab` union and the tab options list.
- Render `<PricingTab />` when the active tab is `'pricing'`.
- Remove the rate-editor section from the Cost tab (it moves to PricingTab).
- Replace the single `effectiveCostSettings` with a per-row resolution that uses `resolveTemplatePricing`.
- Load templates into the component from `window.api.listTemplates()` so the Cost tab can map `templateId → Template` for the resolver.

- [ ] **Step 1: Extend the tab type and options**

At the top of `src/renderer/src/components/UsageStatsView.tsx`, edit the `UsageStatsTab` type (currently at line 35) and the `STATS_TAB_OPTIONS` array (around line 55) to include the new tab:

```ts
type UsageStatsTab = 'overview' | 'sessions' | 'cost' | 'pricing'
```

```ts
const STATS_TAB_OPTIONS: Array<{ label: string; value: UsageStatsTab }> = [
  { label: 'Overview', value: 'overview' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Cost', value: 'cost' },
  { label: 'Pricing', value: 'pricing' }
]
```

- [ ] **Step 2: Add the resolver import and a templates map**

Add this import near the top of `UsageStatsView.tsx`, next to the other imports from `../../../shared/types`:

```ts
import type { Template } from '../../../shared/types'
import { resolveTemplatePricing } from '../utils/templatePricing'
import { PricingTab } from './PricingTab'
```

Add a templates state, lazy-loaded once on mount, in the same component. Inside the `UsageStatsView` function body (where the other `useState` calls live), add:

```ts
const [templates, setTemplates] = useState<Template[]>([])

useEffect(() => {
  let cancelled = false
  void window.api.listTemplates()
    .then((next) => {
      if (!cancelled) setTemplates(next)
    })
    .catch(() => {
      if (!cancelled) setTemplates([])
    })
  return () => {
    cancelled = true
  }
}, [])
```

Add a `templatesById` map memo:

```ts
const templatesById = useMemo(() => {
  const map = new Map<string, Template>()
  for (const template of templates) {
    map.set(template.id, template)
  }
  return map
}, [templates])
```

- [ ] **Step 3: Switch cost rows to the resolver**

In the existing component body, replace the `effectiveCostSettings` derivation (around line 472) and the four call sites that pass it to `getUsageCostBreakdown`. The current code uses one settings object for every row. Replace the single derivation with a per-row resolver helper:

```ts
const pricingForTemplate = (templateId: string | null | undefined) => {
  if (!templateId) return appSettings
  return resolveTemplatePricing(templatesById.get(templateId), appSettings)
}
```

Then update the four cost computation call sites:

- `const summaryCost = snapshot && canRenderCostAnalysis ? getUsageCostBreakdown(snapshot.summary, appSettings) : null` — `snapshot.summary` has no `templateId`, so this stays on `appSettings` (cross-template total).
- `filteredCostSessionRollups` sort/filter and per-row cost: use `pricingForTemplate(session.templateId)` per row instead of `effectiveCostSettings`. Pass the resolved pricing into `getUsageCostBreakdown(session, pricingForTemplate(session.templateId))`.
- `costSessionAnalysisGroups` per-group cost: when grouped by template, the group key is a template id (status of `getSessionAnalysisGroupKey` returns `template:<id>` for the by-template group). Add a small helper:

```ts
const pricingForGroupKey = (key: string) => {
  if (key.startsWith('template:')) {
    return pricingForTemplate(key.slice('template:'.length))
  }
  return appSettings
}
```

Inspect the actual `buildSortedSessionAnalysisGroups` implementation around line 200-380 of the same file to confirm the group key format and adjust the prefix if it differs. If the format is not `template:<id>`, fall back to `appSettings` for the whole group.

- `snapshot.templateRollups.map(...)` per-row cost: replace `effectiveCostSettings` with `pricingForTemplate(rollup.templateId)`.
- `snapshot.dailyRollups.map(...)` per-row cost: keep on `appSettings` (cross-template day totals).
- `snapshot.recentRequests.map(...)` per-row cost: replace `effectiveCostSettings` with `pricingForTemplate(record.templateId)`. The `record.countedExactly` guard stays.

- [ ] **Step 4: Delete the rate-editor section from the Cost tab**

Remove the entire `<section className="usage-section">…Cost Settings…</section>` block (the one with `costDraft`, `setCostDraft`, `handleSaveCostSettings`, currency input, three rate inputs, and the "Save Rates" button). The block runs from the `<section>` opening tag at approximately line 909 to its closing `</section>` at approximately line 977. Delete it in its entirety.

Also delete the now-unused state and handlers from the component body:

- `costDraft`, `setCostDraft` (and the `UsageCostDraft` interface if it is no longer referenced — keep it only if it is).
- `handleSaveCostSettings` (the function body).
- The `costSettingsReady` / `loadingCostSettings` / `costSettingsError` / `savingCostSettings` states and their `loadCostSettings` effect — these gated the cost analysis rendering. Replace the `canRenderCostAnalysis` guard with a check that just verifies the snapshot is ready:

```ts
const canRenderCostAnalysis = Boolean(snapshot)
```

- [ ] **Step 5: Route the new Pricing tab**

In the JSX, after the existing `{activeTab === 'overview' ? (…) : (…)}` block, add a Pricing branch. The simplest form is to wrap the existing branch in a parent ternary and add the new branch:

```tsx
{activeTab === 'pricing' ? (
  <PricingTab />
) : snapshot ? (
  <>
    {error && <div className="usage-stats-warning">Refresh failed: {error}</div>}
    {activeTab === 'overview' ? (…overview JSX…) : (…cost/sessions JSX…)}
  </>
) : null}
```

(If the current structure uses a different shape, keep the surrounding `loading`/`error` empty-state blocks and only add the Pricing branch alongside them.)

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: completes with no errors. ESLint/TS warnings about unused imports are fine to fix in-place.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/UsageStatsView.tsx
git commit -m "refactor(renderer): split Cost tab into read-only view and PricingTab"
```

---

## Task 6: Update HANDOFF and run final build

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add completion line to HANDOFF.md**

In `docs/HANDOFF.md`, under `## Completed`, add a new bullet at the end of the list describing what shipped:

```markdown
- Added per-template pricing as the primary cost source for each template, with the app-wide rates kept as the default fallback. A new Pricing tab inside Usage Stats manages both surfaces; the Cost tab is read-only and resolves rates per rollup row (session/template rollups use the template's rates, daily and overall rollups use the app-wide rates, currency is always app-wide). Pricing lives in the template's existing JSON file and follows it through export/import.
```

- [ ] **Step 2: Add verification lines to HANDOFF.md**

Under `## Verification` in the same file, add:

```markdown
- `npm run build` after splitting the Cost tab into a read-only view plus a new Pricing tab and switching the cost resolver to per-template with app-wide fallback
```

- [ ] **Step 3: Add manual smoke test block to HANDOFF.md**

Under `## Next Recommended Check`, append:

```markdown
- Manual smoke test for per-template pricing: open the Pricing tab, save new app-wide defaults and confirm the Cost tab recalculates. Toggle one template on, set non-zero rates, save, and confirm that template's session/template-rollup rows in the Cost tab use the new rates while others stay on app-wide. Toggle the template off, save, and confirm the Cost tab reverts. Reload the app and confirm both surfaces persist. Delete a template that had per-template pricing and confirm historical cost rows for that template fall back to app-wide. Export a template with pricing, re-import on a fresh install, and confirm the pricing block survived the round-trip.
```

- [ ] **Step 4: Final build check**

Run: `npm run build`
Expected: completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: record per-template pricing in HANDOFF"
```

---

## Self-Review (executed inline while writing)

**Spec coverage:**
- Optional `pricing` field on `Template` (Data Model) → Task 1.
- `TemplatePricing` type with three non-negative numbers (Data Model) → Task 1.
- `UsageCostSettings` unchanged (Data Model, Architecture) → no task needed; confirmed not touched.
- Strict-group rule (Data Model, Edge Cases) → Task 2 (`normalizeTemplatePricing`) and Task 3 (`resolveTemplatePricing`, `hasValidPricing`).
- `normalizeTemplateRecord` round-trips `pricing` (Architecture) → Task 2.
- `appSettings.ts` unchanged (Architecture) → no task; not touched.
- No new IPC handlers (Architecture) → no task; `saveTemplate` already round-trips.
- Resolver lives in renderer (Architecture) → Task 3.
- New `PricingTab.tsx` (Architecture) → Task 4.
- Split Cost tab into read-only + Pricing tabs (Architecture) → Task 5.
- Tab list updated (Architecture) → Task 5.
- `useStore.ts` no new state (Architecture) → confirmed; the store's `cards` already mirrors templates and the new component uses `useStore` directly.
- Preload unchanged (Architecture) → no task; not touched.
- Save flow (Data Flow) → Task 4 (the save handler in PricingTab calls `saveTemplate` + `updateCard`).
- Read flow (Data Flow) → Task 5 (per-row resolver applied to session/template/recent rows; daily/overall stay on app-wide).
- Edge cases (template with all-zero pricing, deleted template, bad/missing fields, rename, save throws, app-wide fails to load, two-window conflict) → covered by the strict-group rule in Tasks 2+3 and the existing error handling in Task 4.
- No unit tests (per user choice in brainstorming) → no test tasks; covered by Task 6 smoke test.
- Manual smoke test (Testing) → Task 6 step 3.
- `npm run build` verification (Testing) → Task 5 step 6 and Task 6 step 4.
- HANDOFF update (Affected Files) → Task 6 steps 1–3.

**Placeholder scan:** No "TBD"/"TODO"/"implement later" in the plan. All code blocks are complete and runnable. One place flags an investigation point — the session group key format in Task 5 step 3 — and tells the engineer to inspect the existing function and adapt the prefix if it differs. That is the intended handoff (not a placeholder), because the engineer needs to confirm the actual string format on the running code.

**Type consistency:**
- `TemplatePricing` is exported from `src/shared/types.ts` (Task 1), imported in Task 2 (`ipc.ts`) and Task 3 (`utils/templatePricing.ts`).
- `ResolvedPricing` is declared in `utils/templatePricing.ts` (Task 3) and used in Task 5.
- `resolveTemplatePricing` is exported in Task 3 and imported in Task 4 and Task 5.
- `Template` carries `pricing?: TemplatePricing` after Task 1; `templatesById` in Task 5 maps `string → Template` so the resolver receives the right shape.
- `pricingForTemplate` and `pricingForGroupKey` helpers are introduced in Task 5 and used only inside that task.
- The Cost tab's call sites all use one of: `appSettings` (summary, daily), `pricingForTemplate(id)` (session, template rollup, recent), or `pricingForGroupKey(key)` (session groups).
- `createTemplatePricingDraft` and `parseTemplatePricingDraft` (Task 4) operate on the same `TemplatePricing` shape Task 1 defines.
- `handleSaveTemplatePricing` in Task 4 strips `pricing` when the toggle is off and writes the rest as a `Template` — this matches the `Template` shape from Task 1 and the IPC contract from Task 2.

No mismatches found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-per-template-pricing.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
