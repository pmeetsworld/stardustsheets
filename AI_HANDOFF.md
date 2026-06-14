# AI Handoff - AEGIS Stardust Sheets

This file is for another AI or developer continuing the project.

## Current State

Date of this handoff: 2026-06-13.

Recent feature commit before this documentation update:

```text
bf28243 Add public encounter viewer
```

Current build token:

```text
20260613n
```

Live GitHub Pages:

```text
https://pmeetsworld.github.io/stardustsheets/campaign.html?app=20260613n
```

Workspace paths:

```text
C:\Users\xyzas\Documents\Codex\2026-06-04\fetch-this-design-file-read-its\github-stardustsheets
C:\Users\xyzas\Documents\Codex\2026-06-04\fetch-this-design-file-read-its\outputs\character-sheet-header-spacing
```

The GitHub checkout is the deploy source. The output folder is a synced local design/reference copy.

## User Intent

The user is running a D&D 5.5e campaign and needs practical, session-ready tools. Favor shipping useful, stable, understandable changes over large rewrites.

Tone/design direction:

- AEGIS Solutions space-opera personnel dossier.
- Dark tactical UI with warm off-white writable fields.
- Usable at the table, not a marketing site.
- Mobile and desktop should both be supported.
- Public player views should avoid revealing exact monster or PC HP unless explicitly requested.

## Data Source Rules

Character sheets are the source of truth for PC data.

The DM Screen may display PC data, but should not edit PC-owned sheet state unless the user explicitly changes that rule.

PC conditions:

- Stored on player sheets as toggles under `sheet_data.toggles`.
- Keys are `p1.cond.<condition>`.
- DM Screen displays these read-only.
- Encounter Viewer displays these publicly.

PC death saves:

- Stored on player sheets as toggles.
- Success keys: `p1.death.ok1`, `p1.death.ok2`, `p1.death.ok3`
- Failure keys: `p1.death.f1`, `p1.death.f2`, `p1.death.f3`
- Encounter Viewer displays them when a PC is incapacitated/down.
- DM Screen should not own or mutate PC death-save pips.

Custom combatants:

- Stored in `dm_state.combatants` JSON.
- DM Screen owns custom combatant HP, AC, initiative, notes, conditions, defeated state.
- Encounter Viewer hides defeated custom combatants.

## Supabase Details

Project ref:

```text
ihhhfxzsuxdfndezlvvp
```

Public config lives in `cloud-config.js`.

Tables:

```text
characters
dm_sessions
dm_state
```

Expected `dm_state` shape:

```js
{
  id: 'main',
  combat_active: false,
  round: 1,
  combatants: [],
  encounter_notes: '',
  backup_state: null,
  updated_at: ''
}
```

Realtime:

- `cloud-save.js` subscribes to one character row.
- `dm.js` subscribes to `dm_state` and `characters`.
- `encounter.js` subscribes to `dm_state` and `characters`.

Initial page load still fetches through the Supabase Data API. Realtime only handles changes after load.

Security:

- The publishable key is public.
- The DM password gate is client-side only.
- RLS policies for `dm_state` and `dm_sessions` are currently permissive.
- Supabase advisor warnings about permissive DM policies are expected for now.
- Do not expose a service-role key in this static site.

## File Responsibilities

### `campaign.html`

Campaign home. Links to DM Screen, Encounter Viewer, and characters.

If adding a new player, update:

- `cloud-config.js`
- Supabase `characters` row
- Any roster copy if needed

### `sheet.html` and `Character Sheet.html`

These should stay identical except filename. If one changes, update the other.

The sheet uses `data-k` for text fields and `data-t` for toggles.

### `sheet.js`

Owns:

- localStorage fallback key `stellar-compendium-v1`
- field/toggle wiring
- mirrored fields
- dynamic feature pages
- dynamic cantrip/spell rows
- snapRuled line-height locking
- print/reset
- `window.AegisSheet` API

Dynamic spell rows:

- Extra cantrip rows tracked in `state.cantripRows`
- Extra spell rows tracked in `state.spellRows`

### `cloud-save.js`

Owns:

- loading/saving one character
- edit-key gated saves through `x-edit-key`
- local cached character fallback
- import/export JSON
- Supabase realtime for the open sheet

Important: it will not apply incoming realtime changes if the local sheet is dirty or saving.

### `image-slot.js`

Owns portrait/image upload state.

Images persist through the sheet state object under:

```text
sheet_data.images
```

### `dm.html` / `dm.js`

Owns the private/soft-gated DM experience:

- unlock password `AEGIS DM 712`
- Live Party cards
- PC HP/status eye toggle
- passive scores
- session notes
- saved sessions
- combat tracker
- Combat Live toggle
- custom combatant CRUD
- encounter notes autosave
- realtime updates

Combat autosave is debounced by `COMBAT_SAVE_MS = 10000`.

### `encounter.html` / `encounter.js`

Public read-only combat view.

Shows waiting screen unless:

```text
dm_state.combat_active = true
```

Public health language:

- `Healthy`: current HP > half max HP
- `Bloodied`: current HP is 1 through half max HP
- `Incapacitated`: current HP <= 0
- `Unknown`: no max HP

Never show exact HP on this page.

### `view-mode.js`

Shared display mode controller.

localStorage key:

```text
aegis-view-mode-v1
```

Adds body classes:

- `view-auto`
- `view-mobile`
- `view-desktop`
- `view-mobile-effective`

### `styles.css`

Large single stylesheet.

Major sections:

- design tokens
- toolbar
- page/sheet structure
- sheet panels and fields
- page-specific sheet layouts
- DM Screen
- Encounter Viewer
- forced/auto mobile layout
- print

Be careful with broad selectors because the same design classes are reused across sheet, DM, and Encounter pages.

### `sw.js`

Service worker for cache busting and route normalization.

If adding a new top-level page, include it in `currentUrlFor()`.

Always bump:

```js
const APP_BUILD = '<new-token>';
```

## Current Characters

From `cloud-config.js`:

| Slug | Character | Player |
|---|---|---|
| `jangles` | Jangles | Bridgette |
| `bubranatak` | Bubranatak | Cary |
| `e-jinx` | E-Jinx | Wyatt |
| `patch` | Patch | Jared |

Payton is the DM and does not need a sheet.

## Build/Deploy Checklist

Before pushing:

1. Inspect git status and avoid overwriting unrelated user changes.
2. Bump `20260613n` style build token in HTML/JS/CSS references and `sw.js`.
3. Keep `sheet.html` and `Character Sheet.html` synchronized.
4. Run JS syntax checks with bundled Node:

```powershell
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check dm.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check encounter.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check view-mode.js
```

5. Run:

```powershell
git diff --check
```

6. Test through local static server or GitHub Pages URL.
7. Commit and push `main`.
8. Confirm live page serves the new `app=` token.

## Recent QA Evidence

For build `20260613n`:

- Local campaign page loaded with 4 character cards, DM Screen link, Encounter Viewer link, and view toggle.
- DM Screen unlocked from cached session, rendered 4 party cards, condition strips, and Combat Live toggle.
- DM view toggle switched Mobile and Desktop classes/layout.
- Encounter Viewer loaded live, showed waiting screen with Combat Live off, no console errors.
- Sheet loaded Jangles from Supabase, showed read-only cloud status, and view toggle worked.
- Live GitHub Pages caught up and served `20260613n`.

Browser screenshot capture timed out in the Codex in-app browser, so verification relied on DOM snapshots, console logs, and computed styles.

## Known Issues / Do Not Surprise The User With

- This is not secure. It is table-ready and soft-gated.
- DM Screen currently can be accessed by anyone who knows or reads the client-side password.
- Public write access exists for DM state/session tables.
- Mobile support exists through forced mode and responsive CSS, but complex A4 sheets still require careful testing after layout edits.
- GitHub Pages/service worker caching can make old builds appear until the `app=` token and `sw.js` build are bumped.
- Do not remove `view-mode.js` from pages; the user explicitly asked for mobile/desktop toggles everywhere.

## Best Next Steps

1. Add real DM authentication or a minimal Supabase Edge Function write gate.
2. Improve custom conditions from comma text into tappable chips.
3. Add encounter presets or quick monster duplication helpers.
4. Add public combat-active banner on campaign home.
5. Build AcroForm PDF export from rendered fields.
6. Add a tiny admin doc for creating player edit links.
