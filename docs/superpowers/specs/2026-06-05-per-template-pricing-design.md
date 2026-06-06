# Per-Template Pricing Design

## Problem Statement

LlamaDeck currently lets the user set a single app-wide token pricing (input, cache, output rates plus a currency) in `usage-cost-settings.json`, and the Cost tab inside Usage Stats derives costs from that one setting for every template. Different templates use different model families and price points (e.g., a 35B reasoning model vs. a small embedding model), so a single app-wide rate gives misleading per-template cost analysis.

The user wants per-template pricing while keeping the existing app-wide rates as the default for templates that don't override them.

## Goal

- Add optional per-template pricing to each template's existing JSON file.
- Add a new Pricing tab inside Usage Stats for managing app-wide rates and per-template overrides.
- Make the existing Cost tab read-only and resolve rates per row from a single resolver.
- Keep currency shared app-wide; per-template overrides only cover the three rate fields.
- Treat per-template pricing as a strict group: a template either owns all three rates, or falls back entirely to the app-wide rates.

## Non-Goals

- Per-request pricing, historical pricing snapshots, or invoice-grade billing.
- Cross-currency rollups or FX conversion.
- Removing the app-wide rates; they remain the default fallback.
- Adding pricing fields to the template create/edit modal (the user explicitly chose to keep that surface focused on launch config).
- Estimating tokens client-side; cost still derives only from server-returned usage data captured by the proxy.

## Actors

- A desktop user who runs multiple local templates with very different model sizes or workloads and wants distinct cost analysis per template.
- A desktop user who only has one model and is happy leaving the app-wide rates as-is; nothing changes for them.

## Use Cases

- A user sets app-wide rates once, then enables per-template pricing on a single high-cost template to reflect that model's actual rate card.
- A user disables per-template pricing on a template and confirms the Cost tab reverts that template's rows to the app-wide rates.
- A user deletes a template that had per-template pricing; historical cost rows for that template fall back to app-wide rates, matching today's behavior when settings change.
- A user exports a template, shares the JSON, and the recipient sees the same per-template pricing on import (because pricing lives inside the template file).

## Data Model

```
Template (extended)
├─ id: string
├─ name: string
├─ description?: string
├─ backendVersion?: string
├─ modelPath: string
├─ serverPort: number
├─ args: Record<string, string | number | boolean>
└─ pricing?: TemplatePricing        // optional; absent = use app-wide

TemplatePricing
├─ inputCostPerMillion: number      // >= 0
├─ cacheCostPerMillion: number      // >= 0
└─ outputCostPerMillion: number     // >= 0

UsageCostSettings (unchanged, app-wide)
├─ currency: string                 // shared across all templates
├─ inputCostPerMillion: number
├─ cacheCostPerMillion: number
└─ outputCostPerMillion: number

ResolvedPricing (computed at read time, never persisted)
├─ currency: string                 // always from app-wide
├─ inputCostPerMillion: number      // template.pricing.* if all three valid, else appSettings.*
├─ cacheCostPerMillion: number
└─ outputCostPerMillion: number
```

The `Template` type lives in `src/shared/types.ts` and is shared by main and renderer.

Pricing is stored in the same `templates/<id>.json` file as the rest of the template. When `pricing` is missing, malformed, or has any invalid field, the whole block is treated as absent and the resolver falls back to app-wide rates (strict group rule).

## Architecture

### Main process (`src/main/`)

- **Template save/load** (existing path in `src/main/index.ts` or wherever templates are persisted): extend to round-trip the optional `pricing` block. Add a small `normalizeTemplatePricing(input: unknown): TemplatePricing | undefined` helper next to the existing field normalization. It strips `pricing` entirely if any of the three fields is not a finite non-negative number.
- **`src/main/appSettings.ts`**: unchanged. App-wide rates stay where they are.
- **`src/main/ipc.ts`**: no new handlers. The existing `get-templates` and `save-template` IPCs already return/accept the full template object, so `pricing` flows through them automatically.
- No new main-process files are strictly required. The resolver lives in the renderer because cost is already derived at read time (the proxy-usage-stats spec explicitly accepted that cost may be derived from current token rollups rather than snapshotted historically).

### Renderer (`src/renderer/src/`)

- **New `components/PricingTab.tsx`**: the new management surface. Layout:
  1. App-wide rates card (top): currency input, three rate inputs (`/ 1M tokens`), Save button. Reuses the existing rate-editor UX from the current Cost tab.
  2. Per-template section: one row per template. Each row has the template name, an "Use template-specific pricing" toggle, and three rate inputs (disabled when toggle is off). Saving the row calls the existing `saveTemplate` IPC with the updated template.
- **New `utils/templatePricing.ts`**: exports `TemplatePricing`, `ResolvedPricing`, and a pure `resolveTemplatePricing(template, appSettings): ResolvedPricing` function. Strict group rule applies: if `template.pricing` is missing or any field is invalid, the resolver returns the app-wide rates (currency included from app-wide). Currency is never read from the template.
- **`components/UsageStatsView.tsx`**: split the current Cost tab into two tabs:
  - "Cost" tab becomes read-only. The existing rate editor is removed. The rollup/session/template/day/recent-request cost tables continue to render but pull rates from the resolver instead of directly from `usageCostSettings`.
  - "Pricing" tab is the new `PricingTab` component.
- **Tab list updated** to: `['overview', 'sessions', 'cost', 'pricing']`.
- **`store/useStore.ts`**: no new state needed. Templates and app-wide rates are already in the store. The resolver is pure, so the Cost tab can compute resolved rates on each render.

### Preload (`src/preload/`)

- No changes. `getTemplates`, `saveTemplate`, `getUsageCostSettings`, and `saveUsageCostSettings` already cover everything.

## Data Flow

### Save flow (user edits pricing in the Pricing tab)

1. User toggles "Use template-specific pricing" on for template `T`, enters rates, clicks Save.
2. Renderer calls `saveTemplate` IPC with the full updated template (pricing cleared or populated as a single object).
3. Main process normalizes `pricing` (non-negative numbers; bad values strip the field, falling back to app-wide at calc time) and writes `templates/<id>.json` atomically via the existing template-save path.
4. Renderer updates the local store with the saved template. The Cost tab immediately recomputes because its rollup render reads from the store.

### Read flow (Cost tab shows derived cost)

1. Renderer loads templates (existing IPC) and app-wide rates (existing IPC) into the Zustand store on mount.
2. Cost tab iterates over rollups, sessions, templates, days, and recent-request rows. For each row keyed by `templateId`, call `resolveTemplatePricing(template, appSettings)`.
3. Apply `(tokens / 1_000_000) * rate` per token class. Sum to total. Format with the shared currency.

### Recent requests

- The request row carries the live template id from the active session, so it uses the same resolver with no special-casing.

## Edge Cases & Failure Handling

- **Template with `pricing: { input: 0, cache: 0, output: 0 }`**: honored as an explicit override. Cost rows for that template show $0. Lets users hard-zero a template without disabling cost analysis.
- **Template deleted but history exists**: rollups compute against app-wide rates (no template row to resolve from). Matches current behavior when settings change.
- **Bad/missing fields in `pricing`** (negative, NaN, wrong type): normalized to absent on load. Toggle renders off in Pricing tab, Cost tab uses app-wide. Same shape as the current `appSettings` normalization.
- **Template rename**: `pricing` lives on the template, so it follows the rename. No join to break.
- **`saveTemplate` throws** (disk full, permission, invalid JSON write): existing template save already surfaces the error; Pricing tab shows the same error toast and keeps the user's draft.
- **App-wide rates never load** (corrupt file): existing fallback returns `DEFAULT_USAGE_COST_SETTINGS` (zeros). Cost tab shows $0 everywhere. Pricing tab app-wide editor shows zeros. No regression.
- **Two Pricing tabs/windows edit the same template simultaneously**: last-write-wins, matches existing template editor behavior. Not a new problem.
- **Strict group rule**: if a template has any invalid pricing field, the whole `pricing` block is dropped and the app-wide rates are used. Simpler than per-field fallback and matches the user's "all three rates together" choice.

## Testing

### Unit tests (Vitest, matching existing patterns)

- **`src/main/__tests__/templateSave.test.ts`** (extend existing or add a new file)
  - Round-trip: save a template with `pricing`, reload from disk, `pricing` survives intact.
  - Normalization: `pricing: { input: -1, cache: 'bad', output: NaN }` on load → field stripped, behaves as if `pricing` was never set.
  - Backward compat: an existing template JSON without a `pricing` key loads unchanged.
- **`src/renderer/src/utils/__tests__/templatePricing.test.ts`** (new)
  - `resolveTemplatePricing` with a template that has full valid pricing → returns template rates with app-wide currency.
  - Without pricing → returns app-wide rates verbatim.
  - With partial/invalid pricing → falls back to app-wide (strict group rule).
  - Currency is always pulled from app-wide, never from the template.
  - With app-wide currency `USD` and template rates `{ input: 0, cache: 0, output: 0 }` → resolver returns zeros (explicit override honored).

### Manual smoke test (add to `HANDOFF.md`)

- Open Pricing tab, save app-wide rates → confirm Cost tab recalculates.
- Toggle one template on, set non-zero rates → confirm Cost tab shows that template's rows with the new rates, other templates still on app-wide.
- Toggle off → confirm Cost tab reverts that template to app-wide rates.
- Reload app → confirm per-template settings persist, app-wide persists.
- Delete a template that had per-template pricing → confirm Cost tab's historical rows for that template fall back to app-wide.
- Export a template with pricing, re-import on a fresh install → confirm pricing survives the round-trip.

### Build verification

- `npm run build` after implementation, listed in `HANDOFF.md` verification block per the project's standard.

## Affected Files

- `src/shared/types.ts` — extend `Template` with optional `pricing` field; add `TemplatePricing` type.
- `src/main/index.ts` (or wherever templates are persisted) — round-trip and normalize the `pricing` field.
- `src/renderer/src/utils/templatePricing.ts` (new) — resolver and types.
- `src/renderer/src/utils/__tests__/templatePricing.test.ts` (new) — resolver tests.
- `src/renderer/src/components/PricingTab.tsx` (new) — new management tab.
- `src/renderer/src/components/UsageStatsView.tsx` — split into Cost (read-only) + Pricing tabs; pull rates from resolver.
- `docs/HANDOFF.md` — record completion and verification per project standard.

## Out of Scope / Future

- Historical pricing snapshots (current rollups always reprice from current rates).
- Per-field override (the strict group rule is the chosen design).
- Pricing field in the template create/edit modal (kept launch-config-only by user request).
- Cross-currency rollups or FX conversion.
- Per-request or per-endpoint pricing.
