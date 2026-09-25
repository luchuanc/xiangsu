# ImageGen source masters

These PNG files are project-original visual references generated with the built-in ImageGen tool. They are source masters only: runtime code must not treat them as final tile sheets or animation sheets. Final assets are produced by a deterministic crop/quantize/pack step and stored under a versioned `public/assets/visual/` path.

## `town-style-anchor-v1.png`

- Purpose: lock the town mood, world scale, palette, and light direction.
- Generated size: 1672×941.
- Prompt summary: nighttime top-down three-quarter frontier town; warm campfire and lanterns; stone/timber buildings; small protagonist and functional NPC silhouettes; northern crimson abyss gate; authentic hand-crafted 16-bit pixel clusters; no text, logo, UI, gradients, antialiasing, or isometric camera.
- Frozen palette cues: midnight navy `#0D1429`, slate `#364052`, lantern gold `#F2B35D`, danger crimson `#A93D4C`, moss green `#557553`.

## `town-character-roster-v1.png`

- Purpose: lock exploration-character proportions and distinct silhouettes before producing individual turnarounds.
- Generated size: 1672×940.
- Reference: `town-style-anchor-v1.png`.
- Subjects in order: armored wanderer protagonist, tavern keeper, blacksmith, skill mentor, merchant, innkeeper, cartographer, abyss watcher.
- Prompt summary: one-row separated full-body lineup, equal baseline and scale, neutral three-quarter game pose, readable at an eventual 24×32 frame, matching the environment palette and hard pixel-cluster language; no labels, borders, UI, effects, or extra characters.

## `battle-style-anchor-v1.png`

- Purpose: lock battle-stage depth, left/right formation, impact readability, shield-break particles, and abyss-Boss scale.
- Generated size: 1672×941.
- References: `town-style-anchor-v1.png` and `town-character-roster-v1.png`.
- Prompt summary: four-person party left, enemy formation right, front row closer to center, acting hero stepped forward, compact hit/Combo effects, ruined abyss causeway, reserved top timeline and bottom command bands without drawing fake UI or text.
- Runtime rule: the final renderer still positions units from the frozen battle slots and consumes committed domain events in sequence; this image is not a source of combat rules, target legality, speed order, or damage values.

## `floor01-style-anchor-v1.png`

- Purpose: lock the first wilderness floor's moss-stone ruins, blocked-rock silhouettes, side-route treasure language, and upper-right Boss ritual clearing.
- Generated size: 1672×941.
- Reference: `town-style-anchor-v1.png` for palette, hard-pixel clusters, material scale, and lighting only; the town layout and actors were not reused.
- Prompt summary: top-down three-quarter ruined forest passage entering a shallow cavern, cold slate and moss-green paths, sparse warm torches, treasure alcoves, elite side branches, and restrained crimson at the Boss altar; no text, logo, UI, characters, enemies, gradients, antialiasing, bloom, fog, or watermark.
- Runtime rule: this is a style master only. The playable map must use an exact 256×256 tile sheet with 16×16 cells and deterministic visual layers while preserving the frozen collision layer and object coordinates.

## `title-background-master-v1.png`

- Purpose: lock the title screen's safe-town versus distant-abyss composition and leave a calm center for the separately rendered logo and actions.
- Generated size: 1672×941.
- Reference: `town-style-anchor-v1.png` for materials, palette, hard-pixel clustering, and lighting only.
- Prompt summary: a central expedition road framed by lantern-lit timber-and-stone town edges, leading to a restrained crimson gate under a midnight sky; no text, logo, characters, UI, fake buttons, HUD, gradients, antialiasing, bloom, fog, or watermark.
- Runtime rule: this is a source master only. The final `640×360` title image must be rebuilt and cleaned at its native pixel dimensions; it must not be produced by directly shrinking this master.

## `floor01-field-roster-v1.png`

- Purpose: lock the readable silhouettes and identity colors for the six recruitable field characters plus the five first-floor encounter markers.
- Generated size: 1536×1024.
- Subjects: wanderer, iron guard, ember mage, priest, ranger, frost seer, grass-slime marker, thorn-rat marker, goblin-and-wolf marker, stonehide-boar elite marker, and horned-king Boss marker.
- Prompt summary: original hard-edged 16-bit pixel clusters on a dark neutral ground, no labels or UI, with silhouettes designed to survive conversion to the frozen 24×32 field footprint.
- Runtime rule: this board supplies identity and silhouette direction only. It is not an animation sheet and must not be directly scaled or cropped into production assets.

## `battle-roster-concept-v1.png`

- Purpose: lock the first battle roster's side-facing silhouettes, role colors, equipment readability, and Boss scale before producing formal battle animation sheets.
- Generated size: 1774×887.
- Subjects: wanderer, iron guard, ember mage, priest, ranger, frost seer; cave slime, horned boar, skeletal raider, fire wisp, armored abyss knight, abyss tyrant.
- Prompt summary: original 16-bit-inspired pixel-art lineup on a flat midnight background, heroes facing right and enemies facing left, strong silhouettes intended to remain readable around a 32×48 logical battle footprint; no text, logo, UI, or animation grid.
- Runtime rule: this is a visual reference board only. It must not be registered as a runtime sprite sheet or used to claim that battle actor production art is complete.

## Runtime conversion rules

1. Do not resize these masters directly into a sheet and call it finished.
2. Produce one transparent, isolated turnaround master per entity from the same reference.
3. Quantize to the frozen palette, remove semi-transparent edge pixels, and align the foot anchor to `(12, 28)`.
4. Pack the frozen exploration sheet shape `240×128` (`24×32`, 10 columns × 4 rows) with deterministic frame names/clips.
5. Validate dimensions, alpha, frame bounds, nearest sampling, manifest IDs, and bundle ownership before switching runtime paths.
