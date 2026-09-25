import type { AbyssEchoDefinition, WorldProgressV1 } from "../../content/contracts";

export interface AbyssEchoEntry { readonly echo: Readonly<AbyssEchoDefinition>; readonly locked: boolean; readonly lockReasonKey: string | null }
export type AbyssEchoPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "locked"; readonly reasonKey: string }
  | { readonly kind: "empty"; readonly reasonKey: string }
  | { readonly kind: "error"; readonly errorKey: string }
  | { readonly kind: "success"; readonly entries: readonly AbyssEchoEntry[] };

/** 主线未完成时保留锁定说明，不渲染空白开始页。 */
export function buildAbyssEchoState(world: Readonly<WorldProgressV1>, echoes: readonly AbyssEchoDefinition[]): AbyssEchoPanelState {
  if (!world.storyCompleted) return Object.freeze({ kind: "locked", reasonKey: "lock.abyss.story_incomplete" });
  if (echoes.length === 0) return Object.freeze({ kind: "empty", reasonKey: "abyss.echo.empty" });
  return Object.freeze({ kind: "success", entries: Object.freeze(echoes.map((echo) => Object.freeze({ echo, locked: world.echoCharges <= 0, lockReasonKey: world.echoCharges <= 0 ? "lock.abyss.no_charge" : null }))) });
}

export class AbyssEchoPanel {
  private stateValue: AbyssEchoPanelState = Object.freeze({ kind: "locked", reasonKey: "lock.abyss.story_incomplete" });
  public get state(): AbyssEchoPanelState { return this.stateValue; }
  public showLoading(): void { this.stateValue = Object.freeze({ kind: "loading" }); }
  public setState(state: AbyssEchoPanelState): void { this.stateValue = state; }
}
