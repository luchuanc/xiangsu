import type { Element } from "../../content/contracts";
import { ANIMATION_DEFINITIONS, type AnimationPresetId } from "../../content/data/animations";

const animations = new Map(ANIMATION_DEFINITIONS.map((definition) => [definition.id, definition]));
export function skillAnimation(skillId: string | null) {
  return skillId === null ? undefined : animations.get(`anim_${skillId}`);
}

/** Every active preset resolves to existing atlas frames; passive skills intentionally have none. */
export function battleEffectFrames(preset: AnimationPresetId, element: Element, extended = true): string[] {
  if (preset === "passive") return [];
  if (!extended && preset === "projectile") return [`fx_projectile_${element}`];
  const [prefix, count] = preset === "heal" ? ["fx_heal", 6] as const
    : preset === "shield" ? ["fx_shield", 6] as const
    : preset === "status" ? ["fx_status", 4] as const
    : preset === "summon" ? ["fx_summon", 8] as const
    : preset === "melee" && (!extended || element === "physical") ? ["fx_slash", 6] as const
    : !extended ? ["fx_area", 8] as const
    : [`fx_element_${element}`, 8] as const;
  return Array.from({ length: count }, (_, index) => `${prefix}_${String(index).padStart(2, "0")}`);
}

export function skillIconUrl(skillId: string): string {
  const animation = skillAnimation(skillId);
  const preset = animation?.presetId ?? "passive";
  const element = animation?.element ?? "physical";
  const icon = ["heal", "shield", "status", "summon"].includes(preset) ? preset
    : preset === "passive" ? "status" : ["fire", "frost", "lightning"].includes(element) ? element
    : element === "holy" ? "heal" : ["dark", "poison"].includes(element) ? "status" : "melee";
  return `/assets/art/completion/v1/icons/skill-${icon}.png`;
}
