# AEGIS Character Sheet Template

Use this guide when filling or converting a character. The goal is that every player sheet reads the same way during live play and feeds the DM/Encounter pages from the same dependable fields.

Important: do not rename existing `data-k` keys in the HTML. Saved character data in Supabase and localStorage depends on those keys. Use `field-map.js` as the canonical code registry for shared reads.

## Live-Play Fields

These fields drive the DM Screen, Encounter Viewer, and at-table scanning.

| Sheet Field | Key | Format |
|---|---|---|
| Name | `p1.name` | Character name only |
| Class(es) & Subclass | `p1.classlevel` | `Class 4 (Subclass)` or `Class 3 / Class 1` |
| Level | `p1.level` | Total level number only |
| Species / Ancestry | `p1.species` | Short species text |
| Background | `p1.background` | Background name only |
| Armor Class | `p1.ac` | Number only |
| Initiative | `p1.init` | Signed value, like `+3` or `+0` |
| Speed | `p1.speed` | `30 ft.` style |
| Max HP | `p1.maxhp` | Number only |
| Current HP | `p1.curhp` | Number only |
| Temp HP | `p1.temphp` | Number only, blank if none |
| Hit Dice | `p1.hitdice` | `4d8` or `3d8 | 1d6` |
| Passive Perception | `p1.passive` | Number only |
| Proficiency Bonus | `p1.prof` | Signed value, like `+2` |
| Senses | `p1.senses` | Two short lines max |

Suggested senses format:

```text
Darkvision 60 ft.
Passive Perception 14 / Insight 12 / Investigation 11
```

Conditions are the source of truth for live status. Players should mark conditions on their own sheet; the DM and Encounter views display those toggles.

## Page 1 - Combat & Skills

Keep combat entries short and table-friendly.

Weapons:
- Name: max about 20 characters.
- Atk/DC: `+5`, `DC 13`, or similar.
- Damage + Type: `1d8+3 B`, `2d6 fire`, etc.
- Mastery: short keyword if relevant.
- Put range, ammo, special rules, and longer notes in the Properties/Notes field.

Skills:
- Skill modifier boxes should be numbers with signs.
- Use the skill rows consistently so passive Insight and Investigation can be derived from the same places.

Combat actions:
- Use short trigger text first.
- Put the actual at-table action before flavor text.

## Page 2 - Features & Traits

Use one feature per readable chunk. The best pattern is:

```text
Feature Name - trigger or action. Mechanical effect in one or two sentences.
```

Avoid pasting whole rulebook paragraphs when a live-play summary is enough. Put rare edge cases after the main effect.

## Page 3 - Spells & Stores

Spellcasting:
- Class, ability, Save DC, and Atk Bonus should stay in the Spellcasting & Slots panel.
- Empty higher-level spell slots can remain blank; mobile collapses empty levels.

Cantrips and prepared spells:
- Name: max about 20 characters.
- Range: keep to about 5 characters when possible, like `30ft`, `Self`, `Touch`.
- Save/Hit: keep short, like `Dex`, `Wis`, `+6`, or `--`.
- Damage / Effect gets the most space. Put the live-play result here.
- Prepared spells use Prep and Conc toggles instead of long text.

Stores:
- Gear means weapons, armor, tools, and things used in live play.
- Inventory means carried pack items, quest items, treasure, and oddities.
- Notes and Debt should be numeric or very short because they live in the Inventory header.

## Page 4 - Profile & Backstory

Mobile profile sections can collapse, so lead with the useful roleplay summary.

Recommended order:
- P.O.D. designation
- Portrait
- Identity details
- Appearance
- Personality
- Ideals & Values
- Bonds
- Flaws
- Goals
- Allies & Organizations
- Backstory

For roleplay paragraphs, keep each field focused. A good field is usually 2-5 short lines, with the longest writing reserved for Backstory.

## DM/Encounter Dependencies

The live pages depend on these values being clean:

- HP: `p1.maxhp`, `p1.curhp`, `p1.temphp`
- Defense: `p1.ac`
- Movement: `p1.speed`
- Awareness: `p1.passive`, `p1.sk.perc.m`, `p1.sk.insi.m`, `p1.sk.inve.m`
- Conditions: `p1.cond.*`
- Death saves: `p1.death.ok1` through `p1.death.ok3`, `p1.death.f1` through `p1.death.f3`

## Character Consistency Checklist

Before handing a sheet to a player:

- Name, class, level, species, and background are filled.
- AC, HP, temp HP, speed, initiative, and passive perception use short numeric formats.
- Skill modifiers include signs.
- Conditions click on both desktop and mobile.
- Spells use short names and put rules in Damage / Effect.
- Features are summarized for live play.
- Gear and Inventory are separated.
- Profile fields use short roleplay paragraphs.
- Portrait is uploaded and persists after refresh.
