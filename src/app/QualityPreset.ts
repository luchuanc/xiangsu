/** 移动端画质档只控制渲染帧预算，不改变 60Hz 固定步模拟。 */
export type QualityPresetName = "battery" | "standard" | "high";

export interface QualityPreset {
  readonly name: QualityPresetName;
  readonly maxFPS: 30 | 60;
}

export const QUALITY_PRESETS: Readonly<Record<QualityPresetName, QualityPreset>> = Object.freeze({
  battery: Object.freeze({ name: "battery", maxFPS: 30 as const }),
  standard: Object.freeze({ name: "standard", maxFPS: 60 as const }),
  high: Object.freeze({ name: "high", maxFPS: 60 as const }),
});

export function getQualityPreset(name: QualityPresetName = "standard"): QualityPreset {
  return QUALITY_PRESETS[name];
}

export function applyQualityPreset(
  ticker: { maxFPS: number },
  name: QualityPresetName = "standard",
): QualityPreset {
  const preset = getQualityPreset(name);
  ticker.maxFPS = preset.maxFPS;
  return preset;
}

