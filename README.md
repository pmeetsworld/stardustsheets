# AEGIS Solutions - Stardust Sheets

D&D 5.5e campaign tools for a small table: public character sheets, a soft-gated DM Screen, and a public Encounter Viewer.

Current build: `20260614b`

## Live Links

- Campaign roster: https://pmeetsworld.github.io/stardustsheets/campaign.html?app=20260614b
- Encounter Viewer: https://pmeetsworld.github.io/stardustsheets/encounter.html?app=20260614b
- DM Screen: https://pmeetsworld.github.io/stardustsheets/dm.html?app=20260614b

## How To Use

### Players

1. Open the Campaign roster.
2. Select your character.
3. Sheets open read-only by default.
4. To edit, click `Edit` in the toolbar and enter:

```text
712
```

Edit unlock lasts 12 hours on that device. Fields autosave to Supabase and update in realtime for other viewers.

### DM

Open the DM Screen and enter:

```text
712
```

The DM Screen includes:

- Live Party cards
- Session Notes with explicit save
- Saved Sessions list
- Combat tracker
- Round counter
- Combat Live toggle
- Custom combatants
- Encounter Notes autosave
- Clear/Restore combat

### Public Encounter Viewer

The Encounter Viewer is public.

When Combat Live is off, it shows a waiting screen.

When Combat Live is on, it shows:

- Initiative order
- PCs and active custom combatants
- Health status only: Healthy, Bloodied, Incapacitated, Unknown
- Conditions
- Player-owned death-save pips when a PC is down

It never shows exact HP numbers.

## Character Links

Use the campaign roster for normal play:

```text
https://pmeetsworld.github.io/stardustsheets/campaign.html?app=20260614b
```

Direct sheet format:

```text
https://pmeetsworld.github.io/stardustsheets/sheet.html?app=20260614b&slug=<character-slug>
```

Current characters:

| Slug | Character | Player |
|---|---|---|
| `jangles` | Jangles | Bridgette |
| `bubranatak` | Bubaranatak | Cary |
| `e-jinx` | E-Jinx | Wyatt |
| `patch` | Patch | Jared |

Payton is the DM and does not need a character sheet.

## Project Files

| File | Purpose |
|---|---|
| `campaign.html` | Campaign home page with character, DM Screen, and Encounter Viewer links |
| `sheet.html` | Main player sheet entrypoint for GitHub Pages |
| `Character Sheet.html` | Mirror of `sheet.html`; keep synchronized |
| `styles.css` | All app, sheet, DM, Encounter Viewer, and responsive styling |
| `sheet.js` | Sheet field/toggle wiring, local state, dynamic pages, dynamic spell rows |
| `cloud-save.js` | Supabase sheet load/save, realtime sheet updates, edit unlock, import/export |
| `image-slot.js` | Portrait/image upload and persistence |
| `dm.html` | Soft-gated DM Screen |
| `dm.js` | Live party feed, session notes, combat tracker, realtime subscriptions |
| `encounter.html` | Public combat/initiative viewer |
| `encounter.js` | Public realtime combat rendering |
| `view-mode.js` | Shared Auto/Mobile/Desktop display toggle |
| `cloud-config.js` | Supabase URL, publishable key, character roster |
| `dm-screen-setup.sql` | Reference SQL for DM tables and policies |
| `sw.js` | Cache-busting/navigation service worker |

## Supabase

Project ref:

```text
ihhhfxzsuxdfndezlvvp
```

Tables used:

| Table | Purpose |
|---|---|
| `characters` | Character metadata, edit keys, sheet data JSON |
| `dm_sessions` | Saved DM session notes |
| `dm_state` | Combat state, round, combatants, encounter notes, Combat Live flag |

Realtime uses Supabase Postgres Changes:

- `characters` updates refresh sheets, DM party cards, and Encounter Viewer PC data.
- `dm_state` updates refresh DM combat state and Encounter Viewer state.

The current access model is intentionally permissive for table speed:

- Public read access is allowed.
- DM tables allow public insert/update through the publishable key.
- The DM password gate is client-side only.

This is table-ready, not secure enough for an adversarial public app. Do not expose a Supabase service-role key in this static site.

## Design System

AEGIS Solutions should feel like a space-opera corporate personnel dossier:

- Tactical
- Bureaucratic
- Futuristic but practical
- Dark chrome with warm writable fields
- Military-adjacent, not glossy sci-fi
- Usable at the table, not a marketing site

Avoid:

- Fantasy parchment
- Heavy neon cyberpunk
- Generic SaaS dashboard styling
- Tiny desktop tables squeezed onto mobile
- Decorative cards that do not improve play

### Tokens

Core CSS variables in `styles.css`:

```css
:root {
  --bg: #1b1d20;
  --bg-2: #232629;
  --bg-3: #2b2f33;
  --frame: #3d4248;
  --frame-soft: #30353a;

  --field: #f1ede4;
  --field-2: #e7e2d6;
  --field-ink: #1d1f22;
  --rule: #ccc6b8;

  --label: #dadde2;
  --label-dim: #8b9199;

  --red: #ff5a3c;
  --red-2: #e0492c;
  --red-soft: rgba(255, 90, 60, .30);

  --steel: #8a929c;
  --steel-2: #aeb5be;

  --ice: #7f99bd;
  --ice-2: #9fb6d6;
  --ice-soft: rgba(127, 153, 189, .28);

  --r: 7px;
}
```

Color language:

- `panel.active` / red: combat, live-play, touched often.
- `panel.ref` / ice: reference, identity, slower-changing information.
- Writable fields use warm off-white, not pure white.

Typography:

- `Space Grotesk`: body, fields, readable UI.
- `Space Mono`: brand, dossier codes, technical labels, slot levels, conditions.

## Responsive Mode

Every main page includes `view-mode.js`.

Toolbar options:

- `Auto`
- `Mobile`
- `Desktop`

The selected mode is stored in localStorage:

```text
aegis-view-mode-v1
```

Important body classes:

- `view-auto`
- `view-mobile`
- `view-desktop`
- `view-mobile-effective`

Do not remove the view toggle. The user specifically wants mobile and desktop access across the whole project.

## Mobile Redesign Brief

The desktop experience is solid. The mobile experience works, but it needs a better design pass.

Mobile goal:

- Make mobile feel like a real tactical field dossier, not a squeezed A4 PDF.
- Preserve all fields, toggles, save keys, and realtime behavior.
- Keep the AEGIS visual identity.
- Prefer CSS-first changes.
- Avoid horizontal scrolling except where it is truly better than stacking.
- Keep touch targets humane, generally 32px or taller.

Required mobile surfaces:

1. Campaign roster
2. Character Sheet Page 1 - Operative Record / Combat & Skills
3. Character Sheet Page 2 - Features & Traits
4. Character Sheet Page 3 - Spells & Stores
5. Character Sheet Page 4 - Profile & Backstory
6. DM Screen
7. Encounter Viewer

Mobile priorities:

- Page 1 should prioritize combat state, conditions, weapons, and skills.
- Page 2 should make long feature text comfortable to read/write.
- Page 3 should convert spell rows into readable mobile rows/cards instead of cramped tables.
- Page 4 should place identity and portrait first, then roleplay paragraphs.
- DM Screen should be usable during a live session on a phone.
- Encounter Viewer should be dramatic, simple, and readable for players.

Claude/design prompt seed:

```text
Redesign the mobile experience for AEGIS Solutions - Stardust Sheets.
Preserve the existing desktop visual system and all data behavior.
Focus on mobile layout, touch targets, field hierarchy, spell rows, combat rows, and responsive clarity.
Return a concrete implementation handoff for HTML/CSS, not a vague moodboard.
Use the README design system and file map as constraints.
```

## Implementation Rules

Do not break:

- Supabase realtime.
- `data-k` field names.
- `data-t` toggle keys.
- `sheet.html` / `Character Sheet.html` mirror requirement.
- `view-mode.js`.
- Service worker build-busting pattern.

Prefer:

- CSS-first responsive improvements.
- Existing class names.
- Small structural HTML changes only when CSS cannot produce a good mobile result.

Avoid:

- Framework migration.
- Replacing contenteditable fields.
- Changing save keys.
- Moving to real authentication unless that is the explicit task.

## Deploy Workflow

Before pushing changes:

1. Inspect git status and avoid overwriting unrelated changes.
2. Bump the build token everywhere, currently `20260614b`.
3. Keep `sheet.html` and `Character Sheet.html` synchronized.
4. Update `sw.js` `APP_BUILD`.
5. Run relevant JS syntax checks:

```powershell
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check cloud-save.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check dm.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check encounter.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check sheet.js
& 'C:\Users\xyzas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check view-mode.js
```

6. Run:

```powershell
git diff --check
```

7. Test through a local static server or the live GitHub Pages URL.
8. Commit and push to `main`.
9. Confirm the live URL with the new `app=` token.

## Mobile QA Checklist

Test at:

- 360px
- 390px
- 430px
- 540px

Check every page for:

- No horizontal page overflow.
- Toolbar does not hide critical controls.
- Auto/Mobile/Desktop toggle works.
- Text labels do not clip.
- Buttons are tappable.
- Fields are readable and editable when unlocked.
- Read-only mode still looks intentional.
- No overlapping panels, headers, or fields.
- Long names like `Gerald "Patch" Augustine` and `Bubaranatak` fit.
- Spell rows work with 9 cantrips and 12 spells.
- Conditions do not overflow or clip.
- Portrait upload area remains visible.
- DM combat rows do not run under Encounter Notes.
- Encounter Viewer does not show exact HP numbers.
