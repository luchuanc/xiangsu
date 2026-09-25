import type { PixiSceneRoot } from "../../app/PixiSceneRoot";
import type { ViewportResult } from "../../app/ViewportService";
import type { InputState } from "../../app/input/InputState";
import type { CameraPosition } from "../../domain/exploration/CameraSystem";
import type { InteractionTarget } from "./InteractionSystem";
import type { ActorView } from "./ActorView";
import type { ExplorationHudLayout } from "./ExplorationHud";
import type { TileMapView } from "./TileMapView";
import type { PixiRenderAssetSource } from "../../ui/rendering/PixiAssetResolver";

export interface FieldHudPartyMember {
  readonly characterId: string;
  readonly displayName: string;
  readonly currentHp: number;
  readonly maxHp: number;
}

export interface FieldHudPartySlot {
  readonly slot: 0 | 1 | 2 | 3;
  readonly member: Readonly<FieldHudPartyMember> | null;
}

export interface FieldHudStatus {
  readonly sceneKind: "town" | "exploration";
  readonly mapId: string;
  readonly mapDisplayName: string;
  readonly partySlots: readonly [
    Readonly<FieldHudPartySlot>,
    Readonly<FieldHudPartySlot>,
    Readonly<FieldHudPartySlot>,
    Readonly<FieldHudPartySlot>,
  ];
}

/** 字段 HUD 只能向共享输入源写入这些固定动作，避免场景层自行猜测 token。 */
export type FieldInputAction = "interact" | "map" | "inventory" | "party" | "settings" | "menu";

export interface FieldSceneFrame {
  readonly map: TileMapView;
  readonly actors: readonly ActorView[];
  readonly camera: CameraPosition;
  readonly hud: ExplorationHudLayout;
  readonly hudStatus: Readonly<FieldHudStatus>;
  readonly interactionTarget: InteractionTarget | null;
  readonly hiddenObjectIds: readonly string[];
  readonly animationStep: number;
}

export interface FieldSceneView {
  prepare(frame: FieldSceneFrame): void | Promise<void>;
  enter(frame: FieldSceneFrame): void;
  update(frame: FieldSceneFrame): void;
  setViewport(viewport: ViewportResult): void;
  pause(): void;
  resume(frame: FieldSceneFrame): void;
  destroy(): void;
}

export interface FieldSceneRendererOptions {
  readonly root: PixiSceneRoot;
  readonly assets: PixiRenderAssetSource;
  readonly objectAtlasId: string;
  readonly inputState: InputState;
  readonly viewport: ViewportResult;
}
