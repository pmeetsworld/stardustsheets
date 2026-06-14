# AEGIS Solutions - Stardust Sheets

D&D 5.5e campaign tools for a small table: public character sheets, a soft-gated DM screen, and a public Encounter Viewer.

Live site:

- Campaign roster: https://pmeetsworld.github.io/stardustsheets/campaign.html?app=20260613n
- Encounter Viewer: https://pmeetsworld.github.io/stardustsheets/encounter.html?app=20260613n
- DM Screen: https://pmeetsworld.github.io/stardustsheets/dm.html?app=20260613n

Current app build: `20260613n`

## What This Is

This is a static GitHub Pages site backed by Supabase.

- GitHub Pages hosts the HTML, CSS, and JavaScript.
- Supabase stores character sheet data, portrait/image data, DM session notes, and combat state.
- Character sheets autosave to Supabase when opened with a secret edit link.
- Public sheet links are read-only.
- The DM Screen is protected by a soft password gate only. It is not real security.
- The Encounter Viewer is public and shows initiative, health status, conditions, and player-owned death-save pips.

## Main Files

| File | Purpose |
|---|---|
| `campaign.html` | Campaign home page with character links, DM Screen, and Encounter Viewer links |
| `sheet.html` | Main player sheet entrypoint used by GitHub Pages |
| `Character Sheet.html` | Mirror of `sheet.html`; keep in sync |
| `styles.css` | All app, sheet, DM, Encounter Viewer, and responsive styling |
| `sheet.js` | Sheet local state, field/toggle wiring, dynamic feature pages, dynamic spell rows |
| `cloud-save.js` | Supabase character load/save, realtime sheet updates, import/export |
| `image-slot.js` | Portrait/image upload component and image persistence |
| `dm.html` | Soft-gated DM Screen |
| `dm.js` | DM party feed, session notes, combat tracker, realtime subscriptions |
| `encounter.html` | Public combat/initiative viewer |
| `encounter.js` | Public realtime combat rendering |
| `view-mode.js` | Shared Auto/Mobile/Desktop display toggle |
| `cloud-config.js` | Supabase URL, publishable key, character roster |
| `dm-screen-setup.sql` | SQL setup/reference for DM tables and policies |
| `sw.js` | Cache-busting/navigation service worker |

## Current Pages

### Campaign Roster

`campaign.html` is the home page. It links to:

- DM Screen
- Encounter Viewer
- Jangles
- Bubranatak
- E-Jinx
- Patch

### Character Sheets

Each character sheet uses:

```text
sheet.html?app=20260613n&slug=<character-slug>
```

Edit links add:

```text
&edit=<secret-edit-key>
```

The sheet supports:

- Four-page AEGIS dossier layout
- Local fallback state
- Supabase cloud save
- Supabase realtime updates
- Dynamic feature pages
- Dynamic cantrip/spell rows
- Portrait/image persistence through `sheet_data.images`
- Auto/Mobile/Desktop view toggle

### DM Screen

`dm.html` uses the soft password:

```text
AEGIS DM 712
```

It includes:

- Live Party cards
- Session Notes with explicit Save button
- Saved sessions list
- Combat tracker
- Round counter
- Combat Live toggle
- Add Party
- Add Custom
- Custom combatant HP/AC/conditions/notes
- Damage/heal inputs for custom combatants
- Clear and Restore combat
- Encounter Notes autosave

DM Screen PC data is read from player sheets. PC conditions are not edited on the DM Screen.

### Encounter Viewer

`encounter.html` is public.

When Combat Live is off, it shows a waiting screen.

When Combat Live is on, it shows:

- Initiative order
- PCs and non-defeated custom combatants
- Health status only: Healthy, Bloodied, Incapacitated, Unknown
- PC conditions from player sheets
- Custom combatant conditions from DM Screen
- PC death-save pips from player sheets when a PC is down

It never shows exact HP numbers.

## Supabase

Project ref:

```text
ihhhfxzsuxdfndezlvvp
```

Tables currently used:

| Table | Purpose |
|---|---|
| `characters` | Character metadata, edit keys, sheet data JSON |
| `dm_sessions` | Saved DM session notes |
| `dm_state` | Combat state, round, combatants, encounter notes, Combat Live flag |

Important `dm_state` columns:

- `id`
- `combat_active`
- `round`
- `combatants`
- `encounter_notes`
- `backup_state`
- `updated_at`

Realtime uses Supabase Postgres Changes:

- `characters` updates refresh sheets, DM party cards, and Encounter Viewer PC data.
- `dm_state` updates refresh DM combat state and Encounter Viewer state.

The current access model is intentionally permissive for speed:

- Public read access is allowed.
- DM tables currently allow public insert/update through the publishable key.
- The DM password gate is client-side only.

This is acceptable for the current table, but it is not secure enough for a private or adversarial campaign.

## Responsive Mode

Every main page includes `view-mode.js`.

The toolbar has:

- `Auto`
- `Mobile`
- `Desktop`

The selected mode is stored in localStorage under:

```text
aegis-view-mode-v1
```

`Mobile` forces stacked app/sheet layouts even on desktop.

`Desktop` preserves the wide dossier/app layout even on small screens.

`Auto` follows CSS/media behavior.

## Deploy Workflow

This repo is the GitHub Pages source.

After edits:

1. Bump the app build token everywhere, currently `20260613n`.
2. Keep `sheet.html` and `Character Sheet.html` in sync.
3. Update `sw.js` `APP_BUILD`.
4. Run syntax checks on changed JS:

```powershell
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check dm.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check encounter.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check view-mode.js
```

5. Test locally through a static server, not raw `file://`, when cloud/realtime behavior matters.
6. Commit and push to `main`.
7. Check the live URL with the new `app=` token.

## Known Risks

- DM Screen is soft-gated, not secure.
- Public write policies on `dm_state` and `dm_sessions` are intentionally permissive.
- Supabase advisors warn about those public write policies.
- If the app appears stale on GitHub Pages, verify the `app=` token and service worker build in `sw.js`.
- Screenshot capture in the Codex in-app browser has timed out before; DOM and computed-style checks have been more reliable.

## Next Useful Work

- Add real authentication or stronger DM write protection.
- Add a public combat log if desired.
- Add condition chips/editing UX for custom combatants instead of comma-separated text.
- Add encounter presets or monster templates.
- Build AcroForm PDF export from rendered `[data-k]` and `[data-t]` element positions.
- Add a small admin page for managing player edit links and character rows.

