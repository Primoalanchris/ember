# Ember — Architecture

> **Read this before any new task. Update it after any major refactor.**
> Last updated: 2026-07-19 (Phase 1: storage abstraction)

## What Ember is

A habit-tracker PWA, deliberately built as a **single `index.html`** with no build
step, no framework, no package.json. Tailwind via CDN, all JS inline, fonts from
Google Fonts. Hosted on GitHub Pages (`main` branch → https://primoalanchris.github.io/ember).
Offline via `sw.js` (cache `ember-cache-v12`, network-first for HTML, non-GET
requests bypass the SW) + `manifest.json` (Play-Store-ready; publish is on hold).

**Hard constraints — do not violate:**
- No build step, no bundler, no multi-file JS splits (logical sections inside
  `index.html` instead). `ARCHITECTURE.md` and other docs are fine.
- The localStorage key is **`ember.v2` forever** — changing it wipes user data.
  Schema evolution happens via `SCHEMA_VERSION` + `migrateState()`, never via new keys.
- Always verify the orb/liquid animation after edits (see Verification below).
- Keep safe-area-inset padding (iPhone notch) and streak/history semantics intact.

## Files

| File | Role |
|---|---|
| `index.html` | The entire app: markup, CSS, JS (~2,400 lines, sectioned by banner comments) |
| `sw.js` | Service worker: precache shell, SWR for CDNs, network-first for HTML |
| `manifest.json` | PWA manifest, id `/ember/`, icons + store screenshots |
| `icon-192/512.png`, `icon-512-maskable.png` | App icons (maskable = padded orb) |
| `screenshot-home/stats.png` | 1080×1920 store screenshots, referenced by manifest |

## Module map (sections inside index.html, in order)

`<style>`: theme variables → glass panels → orb/liquid → particles → habit rows →
tab bar → banners/toast → heatmap → drag-reorder → onboarding.

`<script>`: STATE (schema, storage provider, load/save/migrate) → THEMES → ROLLOVER →
ACTIONS (toggle/add/remove) → RENDER (drag, liquid, sparks, rows, tint) → STATS →
personal best/milestones/confetti → HEATMAP → WEEKLY RECAP → LIBRARY → COACH
(local pool + Claude API) → NOTIFICATIONS → MOTION → VOICE → GEO → TABS → SOUND
(WebAudio synth) → PARTICLES → ONBOARDING → UTILS → ERROR VISIBILITY → INIT.

## State & persistence

### Storage provider (Phase 1 abstraction — the backend seam)

All persistence flows through the `storage` singleton (`LocalStorageProvider`),
defined next to `KEY`. **Nothing else touches localStorage.** Contract:

```
load()         → previously persisted plain state object, or null
persist(state) → write state synchronously; MUST throw when medium unavailable
```

- `S` (in-memory) is the single source of truth; the provider only syncs it.
- `save()` wraps `storage.persist(S)` in try/catch → storage-failure banner.
- `loadState()` calls `storage.load()`, then lazy-migrates + `migrateState()`.
- **Swapping to a backend** (Supabase/Postgres): implement the same two methods
  on a new provider (async internals, write-behind queue + retry, load awaited
  once in `init()`). Call sites beyond `init()` should not need changes.

### Schema (SCHEMA_VERSION = 3, key `ember.v2`)

```js
{
  day: 'YYYY-MM-DD',          // current active day
  habits: [{ id, label, emoji, cat, done, preset, addedAt,
             streakDays, lastDoneDay, accent }],
  streak, best,               // day-streak counters
  lastCredited: 'YYYY-MM-DD'|null,  // last day ALL habits were done
  totalCompleted,             // lifetime check-offs
  history: { 'YYYY-MM-DD': {done, total} },  // includes 0-done days (v3+)
  freezesAvailable,           // streak freezes, earned every 7 days, cap 3
  apiKey,                     // optional Anthropic key (coach)
  notifGranted, lastSuggestTime,
  sound: 'off'|'sfx'|'amb',
  theme: 'ember'|'ocean'|'forest'|'aurora'|'rose',   // added v3
  onboarded,
  coachCallTimestamps: [],    // rolling 24h window, API spend guard
  schemaVersion: 3,
}
```

Migration: `loadState()` does field-level lazy patching (Object.assign over
`freshState()` + explicit null checks), then `migrateState(state, fromVersion)`
runs the versioned upgrade ladder (v1→v2 no-op, v2→v3 theme default). Add a new
`if (v < N)` step + bump `SCHEMA_VERSION` whenever the persisted shape changes.

### Streak semantics (do not break)

- `lastCredited` is set by `creditIfComplete()` when every habit is done.
- Streak is "live" iff `lastCredited` is today or yesterday (`liveStreak()`).
- `rollover()` fires on day change (30s interval + visibilitychange): archives
  the previous day into `history` (even 0-done), updates per-habit streaks,
  clears `done` flags.
- **Freeze rule:** a freeze is consumed only when it bridges *exactly one*
  missed day (`lastCredited === daysAgoKey(2)`), crediting yesterday. Longer
  gaps never consume a freeze (it couldn't save the streak).

## Theme engine

- **CSS custom properties on `:root`** (defaults = Ember): `--c-primary[-rgb]`,
  `--c-primary-soft[-rgb]`, `--c-highlight[-rgb]`, `--c-liquid-mid`,
  `--c-accent[-rgb]`, `--c-accent-soft[-rgb]`. The `-rgb` triplets exist for
  `rgba(var(--c-primary-rgb), .3)` alpha composition.
- **Tailwind hook:** `tailwind.config` maps `ember/flame/gold/aurora/mist` to
  `rgb(var(--…-rgb) / <alpha-value>)`, so utility classes retheme live.
- **`THEMES` map** (JS) holds hex + rgb strings per theme; `T()` returns the
  active theme for canvas/JS consumers (confetti, particles, notification icon)
  that can't read CSS vars. Everything DOM-bound uses `var(--…)` instead.
- `applyTheme(name)` writes the vars + respawns particles; `setTheme(name)`
  persists, re-renders, and re-tints. Static colors that never retheme: void
  background, glass surfaces, `sage` (success), `ice`/freeze blue, dusk/bone text.
- SVG liquid gradient stops use `style="stop-color:var(--…)"` (presentation
  attributes can't resolve vars; inline style can).

## Coach (Claude API)

Browser-direct `fetch` to `api.anthropic.com/v1/messages` with the
`anthropic-dangerous-direct-browser-access` header; model in `COACH_MODEL`.
Guards: `coachRateCheck()` = 20s min interval + 30 calls/24h persisted in
`coachCallTimestamps`. Any failure falls back to the local `COACH_MSGS` pool.
Non-GET requests bypass the SW by design.

## Deploy & verification

- Deploy: `git add -A; git commit -m "…"; git push` (PowerShell `;` chaining).
  GitHub Pages rebuilds in ~30s. Bump `ember-cache-vN` in `sw.js` each release.
- Verify (headless, no repo deps): `npm i puppeteer-core` in a scratch dir +
  Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
  Seed `ember.v2` via `page.evaluateOnNewDocument`, load `file:///…/index.html`,
  assert in-page (`S.schemaVersion`, `setTheme('ocean')`, `rollover()` freeze
  cases), screenshot the orb. Always eyeball the liquid fill after orb edits.

## Roadmap

- **Phase 1 (done 2026-07-19):** storage abstraction (`LocalStorageProvider`),
  this document.
- **Phase 2:** social graph / shared habits (needs real backend provider:
  Supabase + auth; partner view is the first use case).
- **Phase 3:** predictive analytics & telemetry (privacy posture TBD —
  currently zero data leaves the device except opt-in coach calls).
- **Phase 4:** wearables/widgets (Apple Watch via Shortcuts + URL params;
  Android widgets need the TWA wrapper — Play packaging is prepped, on hold).
