import type { BattlePhase, GameSaveV1 } from "../../content/contracts";
import type { Scene, SceneRootLike } from "../../app/Scene";
import type { ViewportResult } from "../../app/ViewportService";
import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";

export type ContinueDestination =
  | { readonly kind: "town" }
  | { readonly kind: "exploration"; readonly mode: "exploration" | "shortFarm"; readonly mapId: string }
  | { readonly kind: "battle"; readonly mode: "bossRetry" | "abyssEcho" | "active" }
  | { readonly kind: "reward" };

export interface TitleSceneOptions {
  readonly root: SceneRootLike;
  readonly audio?: { setMusic?(id: "bgm_title", sceneGainBps: number): void };
  readonly createNewGame: () => Promise<DomainResult<GameSaveV1>>;
  readonly cleanupComplete?: (save: Readonly<GameSaveV1>) => Promise<DomainResult<GameSaveV1>>;
  readonly onDestination?: (destination: ContinueDestination, save: Readonly<GameSaveV1>) => void | Promise<void>;
  readonly view?: TitleSceneView;
  readonly getViewState?: () => TitleSceneViewState;
}

export interface TitleSceneViewState {
  readonly canContinue: boolean;
  readonly busy: boolean;
  readonly errorText: string | null;
}

export interface TitleSceneView {
  prepare(): void | Promise<void>;
  enter(state: TitleSceneViewState): void;
  update(state: TitleSceneViewState): void;
  pause(): void;
  resume(state: TitleSceneViewState): void;
  destroy(): void;
  setViewport?(viewport: ViewportResult): void;
}

const DEFAULT_VIEW_STATE: TitleSceneViewState = { canContinue: false, busy: false, errorText: null };

function isBattleTerminal(phase: BattlePhase): boolean { return phase === "COMPLETE"; }

/** 标题页只解析权威存档的恢复目的地；新游戏覆盖须由调用方在 UI 层二次确认后调用。 */
export class TitleScene implements Scene<unknown> {
  public readonly root: SceneRootLike;
  private readonly options: TitleSceneOptions;
  private prepared = false;
  private entered = false;
  private destroyed = false;
  private confirmation = false;

  public constructor(options: TitleSceneOptions) { this.root = options.root; this.options = options; }
  public async prepare(): Promise<void> {
    if (this.destroyed) throw new Error("TITLE_SCENE_DESTROYED");
    await this.options.view?.prepare();
    this.prepared = true;
  }
  public enter(): void {
    if (this.destroyed) return;
    if (!this.prepared) throw new Error("TITLE_SCENE_NOT_PREPARED");
    this.entered = true;
    this.options.audio?.setMusic?.("bgm_title", 10_000);
    this.options.view?.enter(this.getViewState());
  }
  public update(): void {
    if (!this.destroyed) this.options.view?.update(this.getViewState());
  }
  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.options.view?.setViewport?.(viewport);
  }
  public pause(): void {
    if (this.destroyed) return;
    this.entered = false;
    this.options.view?.pause();
  }
  public resume(): void {
    if (!this.destroyed) {
      this.entered = true;
      this.options.audio?.setMusic?.("bgm_title", 10_000);
      this.options.view?.resume(this.getViewState());
    }
  }
  public async exit(): Promise<void> { this.pause(); }
  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    if (this.entered) this.pause();
    this.destroyed = true;
    this.options.view?.destroy();
  }
  public get isConfirmingNewGame(): boolean { return this.confirmation; }
  public requestNewGame(): void { if (!this.entered || this.destroyed) return; this.confirmation = true; }
  public cancelNewGame(): void { this.confirmation = false; }

  private getViewState(): TitleSceneViewState {
    return this.options.getViewState?.() ?? DEFAULT_VIEW_STATE;
  }

  public async confirmNewGame(): Promise<DomainResult<GameSaveV1>> {
    if (!this.confirmation) return failure(createDomainError("SAVE_FAILED", { operation: "create" }));
    const result = await this.options.createNewGame();
    if (!result.ok) return result;
    this.confirmation = false;
    await this.options.onDestination?.({ kind: "town" }, result.value);
    return success(result.value);
  }

  public async continue(save: Readonly<GameSaveV1>): Promise<DomainResult<ContinueDestination>> {
    if (!this.entered || this.destroyed) return failure(createDomainError("SAVE_FAILED", { operation: "load" }));
    let destination: ContinueDestination;
    if (save.battle !== null) {
      if (isBattleTerminal(save.battle.phase)) {
        if (!this.options.cleanupComplete) return failure(createDomainError("SAVE_FAILED", { operation: "load" }));
        const cleaned = await this.options.cleanupComplete(save);
        if (!cleaned.ok) return failure(cleaned.error);
        destination = { kind: "town" };
      } else if (save.battle.phase === "REWARD_PENDING") {
        destination = { kind: "reward" };
      } else if (save.expedition?.mode === "bossRetry" || save.expedition?.mode === "abyssEcho") {
        destination = { kind: "battle", mode: save.expedition.mode };
      } else {
        destination = { kind: "battle", mode: "active" };
      }
    } else if (save.expedition !== null) {
      if (save.expedition.mode === "bossRetry" || save.expedition.mode === "abyssEcho") destination = { kind: "battle", mode: save.expedition.mode };
      else destination = { kind: "exploration", mode: save.expedition.mode, mapId: save.expedition.mapId };
    } else {
      destination = { kind: "town" };
    }
    await this.options.onDestination?.(destination, save);
    return success(destination);
  }
}
