import { assetUrl } from "./assetUrl";
import type { AssetLease } from "./AssetService";
import type { AssetServiceLike } from "./GameApp";
import type { SaveCandidateKind } from "./GameStore";
import { GameStore, SaveCoordinator } from "./GameStore";
import type { Scene, SceneRootLike } from "./Scene";
import type { SceneTransitionOptions } from "./SceneRouter";
import type { ViewportResult } from "./ViewportService";
import { ViewportService } from "./ViewportService";
import { InputLayer, type InputLifecycleTargetLike } from "./input/InputLayer";
import type {
  BattleCommandV1,
  BattleSnapshotV1,
  ContentRootV1,
  CharacterDefinition,
  EncounterDefinition,
  MapDefinition,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentInstance,
  EquipmentSlot,
  SkillDefinition,
  GameSaveV1,
  MapObjectDefinition,
  RewardTransactionV1,
  StatBlock,
  Vector2,
} from "../content/contracts";
import { ContentCatalog, type DeepReadonly } from "../content/Catalog";
import { zhCN } from "../content/locales/zh-CN";
import { abyssEchoContentRoot } from "../content/data/abyssEchoes";
import { floors06To10AssetManifest } from "../content/data/assets.manifest";
import {
  createDomainError,
  failure,
  success,
  type DomainErrorV1,
  type DomainResult,
} from "../domain/common/DomainResult";
import {
  createProductionDomainContext,
  type DomainContext,
} from "../domain/common/DomainContext";
import { createNewGameSave } from "../domain/save/GameSave";
import {
  IndexedDbSaveRepository,
  type IndexedDbSaveRepositoryOptions,
} from "../domain/save/IndexedDbSaveRepository";
import { ExpeditionModeService } from "../domain/exploration/ExpeditionModeService";
import type { ExpeditionStartMode } from "../domain/exploration/ExpeditionModeService";
import { CollisionGrid, TILE_SIZE } from "../domain/exploration/CollisionGrid";
import { PLAYER_SPEED_PER_STEP } from "../domain/exploration/MovementSystem";
import { EncounterTransitionService, type EncounterTransitionBattleInput, type EncounterTransitionContent, type EncounterTransitionStore } from "./EncounterTransitionService";
import { BattleCommandGateway, type BattleCommandGatewayResult } from "./BattleCommandGateway";
import { BossRetryCoordinator } from "./BossRetryCoordinator";
import { AbyssEchoCoordinator } from "./AbyssEchoCoordinator";
import { AbyssEchoService } from "../domain/town/AbyssEchoService";
import { BattleFactory } from "../domain/battle/BattleFactory";
import { BattleReducer, reduceBattle } from "../domain/battle/BattleReducer";
import { decideEnemyAction, type EnemyAiContentSource } from "../domain/battle/EnemyAi";
import type { BattleContentSource, BattleFactoryInput } from "../domain/battle/BattleTypes";
import type { ExpeditionModeContent } from "../domain/exploration/ExpeditionModeService";
import { SeededRng } from "../domain/common/SeededRng";
import { generateLoot, type LootContentSource } from "../domain/reward/LootGenerator";
import { claimReward } from "../domain/reward/RewardService";
import { ProgressionService } from "../domain/character/ProgressionService";
import { EquipmentService, calculateEquipmentStatModifiers, calculateStaticMaxHp, type EquipmentServiceContent } from "../domain/inventory/EquipmentService";
import { FieldItemService, type FieldItemUseResult } from "../domain/inventory/FieldItemService";
import { ReforgeService } from "../domain/inventory/ReforgeService";
import { PartyService } from "../domain/party/PartyService";
import { RecruitmentService } from "../domain/party/RecruitmentService";
import { QuestService } from "../domain/party/QuestService";
import { SkillService } from "../domain/skill/SkillService";
import { SkillStoneGenerator } from "../domain/skill/SkillStoneGenerator";
import { ComboMatcher, type ComboMatchResult } from "../domain/combo/ComboMatcher";
import { InnService } from "../domain/town/InnService";
import { ShopService } from "../domain/town/ShopService";
import { buildFloorEntries } from "../ui/components/FloorSelectPanel";
import { buildAbyssEchoState } from "../ui/components/AbyssEchoPanel";
import { InventoryScreen } from "../ui/screens/InventoryScreen";
import { PartyScreen } from "../ui/screens/PartyScreen";
import { SkillScreen } from "../ui/screens/SkillScreen";
import { ComboScreen } from "../ui/screens/ComboScreen";
import { TitleScene } from "../scenes/title/TitleScene";
import { TownScene } from "../scenes/town/TownScene";
import { ExplorationScene } from "../scenes/exploration/ExplorationScene";
import { createExplorationState } from "../domain/exploration/ExplorationState";
import { BattleScene } from "../scenes/battle/BattleScene";
import { BattleHud, type BattleHudActionId } from "../scenes/battle/BattleHud";
import { BattleSceneView } from "../scenes/battle/BattleSceneView";
import { loadBattleArtResources } from "../ui/rendering/BattleArtResources";
import { artIconUrl } from "../content/data/completion-art";
import { skillIconUrl } from "../ui/rendering/BattleEffectArt";
import type { BattleUnitViewModel } from "../scenes/battle/BattleView";
import type { InteractionTarget } from "../scenes/exploration/InteractionSystem";
import type { FieldHudStatus, FieldInputAction } from "../scenes/exploration/FieldSceneView";
import { PixiAssetResolver } from "../ui/rendering/PixiAssetResolver";
import { FieldSceneRenderer } from "../ui/rendering/FieldSceneRenderer";
import { getTownModalPageSize, TownModalRenderer, type TownModalCommand, type TownModalFloorEntry } from "../ui/rendering/TownModalRenderer";
import { isPixiSceneRoot } from "./PixiSceneRoot";
import {
  layoutTitleButtons,
  TitleSceneRenderer,
} from "../ui/rendering/TitleSceneRenderer";

export type GameFlowState = "boot" | "title" | "town" | "exploration" | "battle" | "reward" | "error";

export interface GameFlowRouterLike {
  transition<Params>(scene: Scene<Params>, params: Params, options?: SceneTransitionOptions<Params>): Promise<void>;
  /** 销毁中的路由与 transition 共用同一队列；普通控制器 destroy 不等待它。 */
  destroy?(): Promise<void> | void;
}

export interface GameFlowAssetServiceLike extends AssetServiceLike {
  acquire(bundleId: string): Promise<DomainResult<AssetLease>>;
  getReferenceCount(bundleId: string): number;
  getLoadedBundleIds(): readonly string[];
}

export interface GameFlowRepository {
  get(): Promise<DomainResult<GameSaveV1 | null>>;
  save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>>;
  replaceAfterConfirmation(nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>>;
}

export interface GameFlowRuntimeLike {
  readonly sceneRouter?: GameFlowRouterLike | null;
  readonly assetService?: GameFlowAssetServiceLike | null;
  readonly lastViewport?: ViewportResult | null;
  readonly isInputEnabled?: boolean;
  subscribeViewport?(listener: (viewport: ViewportResult) => void): () => void;
  setFixedUpdateHandler?(handler: ((deltaMs: number) => void) | null): void;
}

export interface GameFlowSceneContext {
  readonly root: SceneRootLike;
  readonly save: Readonly<GameSaveV1>;
  readonly viewport: ViewportResult;
}

interface GameFlowSceneBuildResult {
  readonly scene: Scene<unknown>;
  readonly townLease: AssetLease | null;
  /** 战斗表现额外持有当前楼层资源，避免探索转场卸载敌人贴图。 */
  readonly battleFloorLease?: AssetLease | null;
}

export interface GameFlowSceneFactories {
  readonly title: (context: GameFlowSceneContext) => Scene<unknown>;
  readonly town: (context: GameFlowSceneContext) => Scene<unknown>;
  readonly exploration: (context: GameFlowSceneContext) => Scene<unknown>;
  readonly battle: (context: GameFlowSceneContext) => Scene<unknown>;
}

export interface GameFlowBattleStartValue {
  readonly battle: BattleSnapshotV1;
  readonly save: GameSaveV1;
  readonly candidateId?: string;
  readonly lease?: AssetLease;
}

export interface GameFlowBattleCommandValue {
  readonly snapshot: BattleSnapshotV1;
  readonly save: GameSaveV1;
  readonly events: readonly import("../content/contracts").BattleDomainEventV1[];
  readonly candidateId?: string;
}

export interface GameFlowControllerOptions {
  readonly titleBackgroundTexture?: import("pixi.js").Texture;
  readonly runtime?: GameFlowRuntimeLike;
  readonly router?: GameFlowRouterLike;
  readonly content?: ContentCatalog;
  readonly repository?: GameFlowRepository;
  readonly repositoryOptions?: IndexedDbSaveRepositoryOptions;
  readonly domainContext?: DomainContext;
  readonly rootFactory?: () => SceneRootLike | Promise<SceneRootLike>;
  readonly sceneFactories?: GameFlowSceneFactories;
  readonly gameRoot?: HTMLElement;
  readonly document?: Document;
  readonly viewport?: ViewportResult;
  readonly createNewGame?: () => Promise<DomainResult<GameSaveV1>>;
  readonly departFloor?: (floorId: string, save: Readonly<GameSaveV1>, mode?: ExpeditionStartMode) => Promise<DomainResult<GameSaveV1>>;
  readonly transitionEncounter?: (save: Readonly<GameSaveV1>) => Promise<DomainResult<GameFlowBattleStartValue>>;
  readonly submitBasicAttack?: (save: Readonly<GameSaveV1>) => Promise<DomainResult<GameFlowBattleCommandValue>>;
  readonly settleReward?: (save: Readonly<GameSaveV1>) => Promise<DomainResult<GameSaveV1>>;
  /** 管理页由后续 screen adapter 接管；主流程先提供稳定的显式入口。 */
  readonly onManagementRoute?: (route: "inventory" | "party" | "skill" | "combo" | "settings") => void | Promise<void>;
  readonly onStateChange?: (state: GameFlowState) => void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultRootFactory(): Promise<SceneRootLike> {
  return import("./PixiSceneRoot").then(({ createPixiSceneRoot }) => createPixiSceneRoot());
}

function defaultViewport(): ViewportResult {
  return new ViewportService().calculate({ width: 640, height: 360 });
}

function flowLifecycleTargets(): readonly InputLifecycleTargetLike[] {
  const candidates: unknown[] = [];
  if (typeof window !== "undefined") candidates.push(window);
  if (typeof document !== "undefined") candidates.push(document);
  const valid = candidates.filter((candidate): candidate is InputLifecycleTargetLike => (
    typeof candidate === "object" && candidate !== null
      && typeof (candidate as { addEventListener?: unknown }).addEventListener === "function"
      && typeof (candidate as { removeEventListener?: unknown }).removeEventListener === "function"
  ));
  // Node fake 只提供 querySelector 时不能让 InputLayer 误绑生命周期；空适配器
  // 保持统一销毁语义，生产浏览器仍绑定 window + document。
  return valid.length > 0 ? valid : [{ addEventListener: () => undefined, removeEventListener: () => undefined }];
}

function domainFailure(operation: "create" | "load" | "save" | "replace"): DomainResult<never> {
  return failure(createDomainError("SAVE_FAILED", { operation }));
}

function battleGatewayFailure(result: Extract<BattleCommandGatewayResult, { ok: false }>): DomainResult<never> {
  return failure(result.error);
}

function autoPathKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 计算从当前位置依次经过完整 waypoint 折线所需的最少固定步数。 */
function autoRouteRequiredSteps(start: Vector2, path: readonly Vector2[]): number {
  let distance = 0;
  let previous = start;
  for (const waypoint of path) {
    distance += Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y);
    previous = waypoint;
  }
  return Math.ceil(distance / PLAYER_SPEED_PER_STEP);
}

function autoRouteStepBudget(requiredSteps: number): number {
  return Math.min(HARD_MAX_AUTO_STEPS, Math.max(MIN_AUTO_STEPS, requiredSteps + AUTO_ROUTE_MARGIN_STEPS));
}

/** 生产地图与 tileset 的冻结映射；禁止从 bundle 名称拼接资源 ID。 */
const MAP_TILESET_ASSET_IDS: Readonly<Record<string, string>> = Object.freeze({
  map_town: "tileset_map_town",
  map_floor_01: "tileset_map_floor_01",
  map_floor_02: "tileset_map_floor_02",
  map_floor_03: "tileset_map_floor_03",
  map_floor_04: "tileset_map_floor_04",
  map_floor_05: "tileset_map_floor_05",
  map_floor_06: "tileset_map_floor_06",
  map_floor_07: "tileset_map_floor_07",
  map_floor_08: "tileset_map_floor_08",
  map_floor_09: "tileset_map_floor_09",
  map_floor_10: "tileset_map_floor_10",
});

/** 自动寻怪的浮点到点阈值；必须小于一个固定步，避免拐角前提前切换路径。 */
const AUTO_WAYPOINT_EPSILON = 1e-7;
/** 自动寻怪使用有界路径预算，既允许长路线完成，也禁止无限追踪。 */
const MIN_AUTO_STEPS = 1_200;
const AUTO_ROUTE_MARGIN_STEPS = 600;
const HARD_MAX_AUTO_STEPS = 3_300;
const AUTO_STALL_STEPS = 180;

interface ChestRewardCandidate {
  readonly objectId: string;
  readonly transactionId: string;
  readonly expectedRevision: number;
  readonly nextSave: GameSaveV1;
  readonly reward: RewardTransactionV1;
  readonly candidateId?: string;
}

const MANAGEMENT_EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];
const MANAGEMENT_STAT_KEYS: readonly (keyof StatBlock)[] = ["maxHp", "attack", "defense", "speed", "critRateBps", "critDamageBps", "effectHitBps", "effectResistBps"];
const MANAGEMENT_STAT_LABELS: Readonly<Record<keyof StatBlock, string>> = Object.freeze({
  maxHp: "最大生命",
  attack: "攻击",
  defense: "防御",
  speed: "速度",
  critRateBps: "暴击率",
  critDamageBps: "暴击伤害",
  effectHitBps: "效果命中",
  effectResistBps: "效果抵抗",
});
const MANAGEMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = Object.freeze({
  weapon: "武器",
  helmet: "头盔",
  armor: "护甲",
  gloves: "手套",
  boots: "靴子",
  accessory: "饰品",
});
const MANAGEMENT_QUALITY_LABELS: Readonly<Record<EquipmentInstance["quality"], string>> = Object.freeze({
  common: "普通",
  magic: "魔法",
  rare: "稀有",
  epic: "史诗",
  abyss: "深渊",
});

function managementLocale(key: string, fallback: string): string {
  return zhCN[key] ?? fallback;
}

function managementEquipmentName(base: EquipmentBaseDefinition): string {
  return managementLocale(base.nameKey, base.id);
}

function managementAffixName(affix: DeepReadonly<EquipmentAffixDefinition>): string {
  return managementLocale(affix.nameKey, affix.id);
}

function managementBaseValue(base: EquipmentBaseDefinition, instance: EquipmentInstance): number {
  return base.baseValueAtMinLevel + base.growthPerItemLevel * (instance.itemLevel - base.minItemLevel);
}

function managementEquipmentInSave(save: Readonly<GameSaveV1>, instanceId: string): EquipmentInstance | undefined {
  return save.inventory.equipment.find((instance) => instance.instanceId === instanceId)
    ?? save.inventory.overflowEquipment.find((instance) => instance.instanceId === instanceId);
}

function managementIsEquipped(save: Readonly<GameSaveV1>, instanceId: string): boolean {
  return Object.values(save.characters).some((progress) => Object.values(progress.equipmentBySlot).includes(instanceId));
}

function managementCharacterName(content: ContentCatalog, characterId: string): string {
  const result = content.getCharacter(characterId);
  return result.ok ? managementLocale(result.value.nameKey, characterId) : characterId;
}

function managementModifierSummary(modifier: EquipmentAffixDefinition["modifiers"][number]): string {
  switch (modifier.kind) {
    case "flatStat": return `固定${MANAGEMENT_STAT_LABELS[modifier.stat]}·倍率${modifier.rollScaleBps}bp`;
    case "percentStat": return `百分比${MANAGEMENT_STAT_LABELS[modifier.stat]}·倍率${modifier.rollScaleBps}bp`;
    case "damageBonus": return `伤害加成·${modifier.element}`;
    case "healingBonus": return "治疗加成";
    case "shieldBonus": return "护盾加成";
    case "finalDamageMultiplier": return "最终伤害倍率";
    case "conditionalDamageBonus": return `条件增伤·${modifier.condition.kind}·${modifier.element}`;
    case "conditionalPercentStat": return `条件属性·${MANAGEMENT_STAT_LABELS[modifier.stat]}·${modifier.condition.kind}`;
    case "trigger": return `触发·${modifier.triggerId}`;
    case "skillPower": return `技能增幅·${modifier.skillId}`;
    case "replaceBasicSkill": return `替换普攻·${modifier.skillId}`;
    case "replaceDamageElement": return `元素转换·${modifier.from}→${modifier.to}`;
  }
}

interface AutoEncounterSession {
  readonly targetObjectId: string;
  readonly map: AutoPathMap;
  readonly resolve: (result: DomainResult<BattleSnapshotV1>) => void;
  steps: number;
  maxSteps: number;
  nextReplanStep: number;
  lastTargetPosition: Vector2 | null;
  commandedMove: Vector2;
  playerBeforeFixed: Vector2 | null;
  playerAfterFixed: Vector2 | null;
  stalledSteps: number;
}

interface AutoEncounterFailureDiagnostics {
  readonly targetObjectId: string;
  readonly steps: number;
  readonly maxSteps: number;
  readonly playerPosition: Vector2 | null;
  readonly actorPosition: Vector2 | null;
  readonly waypoint: Vector2 | null;
  readonly pathRemaining: number;
  readonly lastTargetPosition: Vector2 | null;
  readonly phase: ExplorationScene["state"]["phase"] | null;
  readonly inputEnabled: boolean;
  readonly commandedMove: Vector2;
  readonly playerBeforeFixed: Vector2 | null;
  readonly playerAfterFixed: Vector2 | null;
  readonly stalledSteps: number;
}

function formatAutoEncounterPoint(point: Vector2 | null): string {
  return point === null ? "null" : `(${point.x},${point.y})`;
}

/** 现场诊断只进入当前错误投影，不写入存档、合同或全局状态。 */
function formatAutoEncounterError(
  error: DomainErrorV1,
  diagnostics: AutoEncounterFailureDiagnostics | null,
): string {
  // INVALID_CONTENT 的路径和问题键是稳定契约字段；其它错误不猜测 details 结构。
  const code = error.code === "INVALID_CONTENT"
    ? `${error.code} path=${error.details.path} issueKey=${error.details.issueKey}`
    : error.code;
  if (diagnostics === null) return code;
  return `${code} target=${diagnostics.targetObjectId} steps=${diagnostics.steps}`
    + ` maxSteps=${diagnostics.maxSteps}`
    + ` player=${formatAutoEncounterPoint(diagnostics.playerPosition)}`
    + ` actor=${formatAutoEncounterPoint(diagnostics.actorPosition)}`
    + ` waypoint=${formatAutoEncounterPoint(diagnostics.waypoint)}`
    + ` pathRemaining=${diagnostics.pathRemaining}`
    + ` lastTarget=${formatAutoEncounterPoint(diagnostics.lastTargetPosition)}`
    + ` phase=${diagnostics.phase ?? "null"}`
    + ` inputEnabled=${diagnostics.inputEnabled}`
    + ` commandedMove=${formatAutoEncounterPoint(diagnostics.commandedMove)}`
    + ` playerBeforeFixed=${formatAutoEncounterPoint(diagnostics.playerBeforeFixed)}`
    + ` playerAfterFixed=${formatAutoEncounterPoint(diagnostics.playerAfterFixed)}`
    + ` stalledSteps=${diagnostics.stalledSteps}`;
}

type AutoEncounterObject = Extract<DeepReadonly<MapObjectDefinition>, { kind: "encounter" }>;
type AutoEncounterKindResolver = (encounterId: string) => DomainResult<DeepReadonly<EncounterDefinition>>;

/** 自动寻怪按 encounter kind 分层选择，类型来源必须来自内容目录而非对象命名。 */
export function selectAutoEncounterTarget(
  objects: readonly DeepReadonly<MapObjectDefinition>[],
  defeatedObjectIds: readonly string[],
  resolveEncounter: AutoEncounterKindResolver,
): DomainResult<AutoEncounterObject | null> {
  const defeated = new Set(defeatedObjectIds);
  const firstByKind: Partial<Record<EncounterDefinition["kind"], AutoEncounterObject>> = {};
  for (const [objectIndex, object] of objects.entries()) {
    if (object.kind !== "encounter" || defeated.has(object.objectId)) continue;
    const encounterResult = resolveEncounter(object.encounterId);
    if (!encounterResult.ok) return failure(encounterResult.error);
    if (encounterResult.value.id !== object.encounterId) {
      return failure(createDomainError("INVALID_CONTENT", {
        path: `maps.objects[${objectIndex}].encounterId`,
        issueKey: "encounter_id_mismatch",
      }));
    }
    if (firstByKind[encounterResult.value.kind] === undefined) {
      firstByKind[encounterResult.value.kind] = object;
    }
  }
  // 同一 kind 只记录第一个对象，依赖 objects 原数组顺序；跨 kind 再按玩法优先级取值。
  for (const kind of ["normal", "elite", "boss"] as const) {
    const target = firstByKind[kind];
    if (target !== undefined) return success(target);
  }
  return success(null);
}

/**
 * 自动寻怪只为首层按钮提供一条可达演示路径；每个节点仍通过
 * ExplorationScene.fixedUpdate 消费，接触和战斗切换不绕过领域碰撞。
 */
type AutoPathMap = {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: 16;
  readonly collisionLayer: readonly (0 | 1)[];
};

function appendExactAutoTarget(
  path: readonly Vector2[],
  target: Vector2,
  grid: CollisionGrid,
): readonly Vector2[] {
  const last = path.at(-1);
  if (!last || Math.hypot(last.x - target.x, last.y - target.y) <= 2 || !grid.isWalkable(target)) return path;
  // 网格节点用于绕开障碍，最后仍要走到 ActorView 的精确脚底坐标，
  // 避免整数格终点与遭遇 AABB 只相切而永远不触发接触。
  return [...path, { ...target }];
}

function nearbyAutoGridCandidates(point: Vector2): readonly Vector2[] {
  const centerX = Math.round(point.x / TILE_SIZE);
  const centerY = Math.round(point.y / TILE_SIZE);
  const candidates: Array<{ point: Vector2; distance: number }> = [];
  // round 点周围的 8 个邻格同时覆盖 floor/ceil；按距离和坐标排序，
  // 确保同一坐标在不同设备和运行次序下都选到同一个吸附格。
  for (let tileY = centerY - 1; tileY <= centerY + 1; tileY += 1) {
    for (let tileX = centerX - 1; tileX <= centerX + 1; tileX += 1) {
      const candidate = { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE };
      const dx = candidate.x - point.x;
      const dy = candidate.y - point.y;
      candidates.push({ point: candidate, distance: dx * dx + dy * dy });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.point.y - right.point.y || left.point.x - right.point.x);
  return candidates.map(({ point }) => point);
}

function nearestWalkableAutoGridNode(point: Vector2, grid: CollisionGrid): Vector2 | null {
  // 只在目标所在格及八邻格内吸附；局部没有合法格就明确不可达，
  // 不跨越整张地图寻找断开区域，也不把阻挡格写入路径。
  return nearbyAutoGridCandidates(point).find((candidate) => grid.isWalkable(candidate)) ?? null;
}

function findAutoPath(map: AutoPathMap, start: Vector2, target: Vector2): readonly Vector2[] | null {
  const grid = new CollisionGrid(map);
  const startNode = nearestWalkableAutoGridNode(start, grid);
  const targetNode = nearestWalkableAutoGridNode(target, grid);
  // 吸附格不可走时不能把它作为 waypoint；附近没有合法格就让上层返回
  // INVALID_TARGET，避免自动移动穿墙或永远追逐一个不可达点。
  if (!startNode || !targetNode) return null;

  const queue: Vector2[] = [startNode];
  const previous = new Map<string, string>();
  const visited = new Set<string>([autoPathKey(startNode.x, startNode.y)]);
  const directions: readonly Vector2[] = [
    { x: TILE_SIZE, y: 0 },
    { x: -TILE_SIZE, y: 0 },
    { x: 0, y: TILE_SIZE },
    { x: 0, y: -TILE_SIZE },
  ];
  const maxX = map.widthTiles * TILE_SIZE;
  const maxY = map.heightTiles * TILE_SIZE;
  const targetKey = autoPathKey(targetNode.x, targetNode.y);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentKey = autoPathKey(current.x, current.y);
    if (currentKey === targetKey) {
      const path: Vector2[] = [];
      let key = currentKey;
      while (key !== autoPathKey(startNode.x, startNode.y)) {
        const [x, y] = key.split(",").map(Number);
        path.push({ x, y });
        const parent = previous.get(key);
        if (!parent) break;
        key = parent;
      }
      path.reverse();
      const route = path.length > 0 ? path : [targetNode];
      // startNode 只用于建立 BFS 图；重规划时不能把玩家强行拉回吸附格，
      // 否则当前点与网格中心之间的碰撞会让自动移动原地打转。
      return appendExactAutoTarget(route, target, grid);
    }
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const nextKey = autoPathKey(next.x, next.y);
      if (next.x < 0 || next.y < 0 || next.x >= maxX || next.y >= maxY || visited.has(nextKey) || !grid.isWalkable(next)) continue;
      visited.add(nextKey);
      previous.set(nextKey, currentKey);
      queue.push(next);
    }
  }
  return null;
}

/**
 * 应用层最小可玩闭环：只负责把已有领域服务、场景路由和移动 H5 控件接起来。
 * 战斗数值、目标合法性和存档 CAS 仍分别由 Gateway、Reducer、SaveCoordinator 管理。
 */
export class GameFlowController {
  private readonly options: GameFlowControllerOptions;
  private readonly domain: DomainContext;
  private readonly content: ContentCatalog | null;
  private readonly router: GameFlowRouterLike | null;
  private readonly repository: GameFlowRepository | null;
  private readonly rootFactory: () => SceneRootLike | Promise<SceneRootLike>;
  private readonly input = new InputLayer({ enabled: false, lifecycleTargets: flowLifecycleTargets() });
  private viewportValue: ViewportResult;
  private viewportUnsubscribe: (() => void) | null = null;
  private readonly runtime: GameFlowRuntimeLike | null;
  private readonly assetService: GameFlowAssetServiceLike | null;
  private readonly reducer = new BattleReducer();
  private store: GameStore | null = null;
  private coordinator: SaveCoordinator | null = null;
  private gateway: BattleCommandGateway | null = null;
  private saveValue: GameSaveV1 | null = null;
  private stateValue: GameFlowState = "boot";
  /** 战斗推进失败的运行时诊断；只投影到当前 UI，不进入存档。 */
  private flowErrorDetail: string | null = null;
  private started = false;
  private destroyed = false;
  private storedSaveAvailable = false;
  private currentScene: Scene<unknown> | null = null;
  private explorationScene: ExplorationScene | null = null;
  private battleScene: BattleScene | null = null;
  private townScene: TownScene | null = null;
  /** 城镇 bundle 由 GameFlow 在 TownScene 构造前取得，场景成功切换后才成为 active lease。 */
  private townLease: AssetLease | null = null;
  private readonly townLeaseCleanup = new Set<AssetLease>();
  private townLeaseDiagnostic: string | null = null;
  /** route 统一串行，避免两个异步 scene 构造共享同一个候选 lease 槽位。 */
  private routeQueue: Promise<void> = Promise.resolve();
  /** destroy 递增代数；任何跨 await 的 route 回来都必须重新确认仍然有效。 */
  private lifecycleGeneration = 0;
  private fieldHudCache: {
    readonly revision: number;
    readonly sceneKind: "town" | "exploration";
    readonly mapId: string;
    readonly status: Readonly<FieldHudStatus>;
  } | null = null;
  private battleLease: AssetLease | null = null;
  private battleFloorLease: AssetLease | null = null;
  private pendingContact: import("../domain/exploration/EncounterAi").EncounterContact | null = null;
  private encounterInFlight: Promise<void> | null = null;
  private battleCommandInFlight: Promise<DomainResult<BattleSnapshotV1>> | null = null;
  private fieldItemInFlight: Promise<DomainResult<FieldItemUseResult>> | null = null;
  private fieldItemService: FieldItemService | null = null;
  private fieldItemError: string | null = null;
  private autoEncounterInFlight: Promise<DomainResult<BattleSnapshotV1>> | null = null;
  /** 正式探索自动寻怪的完成器；唯一由 fixed ticker 驱动，不在点击栈跑循环。 */
  private autoEncounterSession: AutoEncounterSession | null = null;
  private autoEncounterError: string | null = null;
  private autoEncounterFailureDiagnostics: AutoEncounterFailureDiagnostics | null = null;
  private autoMoving = false;
  private autoTarget: { x: number; y: number } | null = null;
  private autoPath: Vector2[] = [];
  private readonly heldMovePointers = new Map<number, Vector2>();
  /** 宝箱请求按对象去重；候选失败后保留，重试不重新 roll。 */
  private readonly chestOpenInFlight = new Map<string, Promise<DomainResult<GameSaveV1>>>();
  private readonly chestCandidates = new Map<string, ChestRewardCandidate>();
  private explorationPositionHud: HTMLElement | null = null;
  private flowUi: HTMLElement | null = null;
  private explorationMessage: string | null = null;
  private readonly uiUnbinds: Array<() => void> = [];
  private managementPage: "menu" | "inventory" | "party" | "skill" | "combo" | "settings" | null = null;
  private npcRouteMessage: string | null = null;
  private inventoryScreen: InventoryScreen | null = null;
  private partyScreen: PartyScreen | null = null;
  private skillScreen: SkillScreen | null = null;
  private comboScreen: ComboScreen | null = null;
  private comboBeforeMatch: ComboMatchResult | null = null;
  private merchantPanelOpen = false;
  private merchantPanelToken = 0;
  private merchantBuyInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private merchantBuyOfferId: string | null = null;
  private merchantError: string | null = null;
  private townModalRenderer: TownModalRenderer | null = null;
  private townModalResolution: import("../domain/town/NpcService").NpcResolution | null = null;
  private townModalPageIndex = 0;
  private townModalSelectedFloorId: string | null = null;
  private townModalToken = 0;
  private townRestInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private townFloorDepartureInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private townModalError: string | null = null;
  private townModalSemanticRefreshInFlight = false;
  private pendingFieldAction: Exclude<FieldInputAction, "interact" | "inventory" | "party" | "settings"> | null = null;
  private npcResolutionApplied = false;
  private managementRouteDiagnostic: string | null = null;
  private shopService: ShopService | null = null;
  private rewardClaimInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private rewardError: string | null = null;
  /** COMPLETE 哨兵的清理候选；保存失败时保留 candidate，重试不重做结算。 */
  private terminalCleanupCandidateId: string | null = null;
  private terminalCleanupInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private terminalCleanupError: string | null = null;

  public constructor(options: GameFlowControllerOptions = {}) {
    this.options = options;
    this.domain = options.domainContext ?? createProductionDomainContext();
    this.content = options.content ?? this.createDefaultContent();
    this.runtime = options.runtime ?? null;
    this.router = options.router ?? options.runtime?.sceneRouter ?? null;
    this.repository = options.repository ?? this.createDefaultRepository();
    this.rootFactory = options.rootFactory ?? defaultRootFactory;
    this.viewportValue = options.viewport ?? options.runtime?.lastViewport ?? defaultViewport();
    this.assetService = options.runtime?.assetService ?? null;
    if (this.runtime?.subscribeViewport) {
      this.viewportUnsubscribe = this.runtime.subscribeViewport((viewport) => this.handleViewport(viewport));
    }
  }

  public get state(): GameFlowState {
    return this.stateValue;
  }

  public get save(): Readonly<GameSaveV1> | null {
    return this.saveValue;
  }

  public get hasStoredSave(): boolean {
    return this.storedSaveAvailable;
  }

  public async start(): Promise<void> {
    if (this.destroyed) throw new Error("GameFlowController 已销毁");
    const generation = this.lifecycleGeneration;
    if (this.started) return;
    // 启动重新进入时先确保加载文案可见；只有完整标题路由成功后才隐藏它。
    this.setStartupPlaceholderHidden(false);
    if (!this.router || !this.repository || !this.content) {
      this.setFlowError("startup_dependencies_missing");
      throw new Error("游戏主流程依赖未注入");
    }
    const loaded = await this.repository.get();
    this.assertRouteActive(generation);
    if (!loaded.ok) {
      this.setFlowError(`save_load:${loaded.error.code}`);
      throw new Error("存档读取失败");
    }
    this.storedSaveAvailable = loaded.value !== null;
    if (loaded.value !== null) this.setSave(loaded.value);
    this.mountUi();
    await this.route("title");
    this.assertRouteActive(generation);
    this.started = true;
    this.setState("title");
    this.setStartupPlaceholderHidden(true);
  }

  public async newGame(): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady()) return domainFailure("create");
    const generation = this.lifecycleGeneration;
    const result = this.options.createNewGame
      ? await this.options.createNewGame()
      : this.createInitialSave();
    this.assertRouteActive(generation);
    if (!result.ok) return result;
    const persisted = await this.repository!.replaceAfterConfirmation(result.value);
    this.assertRouteActive(generation);
    if (!persisted.ok) return persisted;
    this.storedSaveAvailable = true;
    this.setSave(persisted.value);
    await this.route("town");
    this.assertRouteActive(generation);
    this.setState("town");
    return success(persisted.value);
  }

  public async continueGame(): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue) return domainFailure("load");
    const save = this.saveValue;
    // COMPLETE 是已经结算的快照，先做独立幂等清理；失败只保留哨兵并回城，
    // 让城镇重试入口接管，不得再次执行 HP、奖励或进度结算。
    if (save.battle?.phase === "COMPLETE") {
      const cleaned = await this.cleanupRetainedExpeditionBattle(save);
      if (!cleaned.ok) {
        this.terminalCleanupError = cleaned.error.code;
        await this.route("town");
        await this.releaseBattleLease();
        this.setState("town");
        return cleaned;
      }
      const nextSave = cleaned.value;
      this.terminalCleanupError = null;
      await this.resumeAfterBattleCleanup(nextSave);
      return success(this.saveValue ?? nextSave);
    }
    if (save.battle) {
      await this.route("battle");
      if (save.battle.phase === "REWARD_PENDING") {
        this.setState("reward");
        return success(this.saveValue ?? save);
      }
      await this.advanceBattleToAwait();
      if (!this.saveValue?.battle && (this.stateValue === "town" || this.stateValue === "exploration")) {
        return success(this.saveValue ?? save);
      }
      if (this.flowErrorDetail !== null) {
        this.setState("error");
        return success(this.saveValue ?? save);
      }
      this.setState(this.saveValue?.battle?.phase === "REWARD_PENDING" ? "reward" : "battle");
      return success(this.saveValue ?? save);
    }
    if (save.expedition) {
      await this.route("exploration");
      this.setState("exploration");
      return success(save);
    }
    await this.route("town");
    this.setState("town");
    return success(save);
  }

  /**
   * 奖励后保留远征快照，玩家明确点击返回城镇时才清除远征。
   * 该提交只改 expedition，避免把奖励、世界进度或背包重复写入。
   */
  public async returnToTown(): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue) return domainFailure("save");
    const current = this.saveValue;
    if (current.battle !== null || current.expedition === null) {
      return failure(createDomainError("NOT_IN_TOWN", null));
    }
    const next = clone(current) as GameSaveV1;
    next.expedition = null;
    const committed = await this.commitSave("transaction", next);
    if (!committed.ok) return committed;
    this.managementPage = null;
    this.managementRouteDiagnostic = null;
    this.npcRouteMessage = null;
    await this.route("town");
    this.setState("town");
    return committed;
  }

  /**
   * 宝箱奖励只在应用层构造完整候选；场景回调拿到 true 前不会修改本地
   * opened 集合。奖励事务、背包和地图开启进度必须由同一次 CAS 一并提交。
   */
  public openChest(objectId: string): Promise<DomainResult<GameSaveV1>> {
    const inFlight = this.chestOpenInFlight.get(objectId);
    if (inFlight) return inFlight;
    const request = this.executeOpenChest(objectId)
      .catch(() => failure(createDomainError("SAVE_FAILED", { operation: "save" })))
      .finally(() => {
        if (this.chestOpenInFlight.get(objectId) === request) this.chestOpenInFlight.delete(objectId);
        this.renderUi();
      });
    this.chestOpenInFlight.set(objectId, request);
    return request;
  }

  private setExplorationMessage(message: string): void {
    this.explorationMessage = message;
    this.renderUi();
  }

  private chestMessage(objectId: string, reward: Readonly<RewardTransactionV1>): string {
    const rewards: string[] = [];
    if (reward.gold > 0) rewards.push(`金币 +${reward.gold}`);
    for (const [itemId, quantity] of Object.entries(reward.stackables)) {
      if (quantity > 0) rewards.push(`${itemId} ×${quantity}`);
    }
    for (const equipment of reward.equipment) rewards.push(`装备 ${equipment.instanceId}`);
    for (const skillStone of reward.skillStones) rewards.push(`铭石 ${skillStone.instanceId}`);
    if (rewards.length === 0) rewards.push("暂无额外物品");
    return `宝箱 ${objectId} 已打开，获得：${rewards.join("、")}`;
  }

  private async executeOpenChest(objectId: string): Promise<DomainResult<GameSaveV1>> {
    const current = this.saveValue;
    if (!this.ensureReady() || !current || this.stateValue !== "exploration" || current.battle !== null || !current.expedition || !this.content) {
      const result = failure(createDomainError("NOT_IN_TOWN", null));
      this.setExplorationMessage(result.error.code);
      return result;
    }
    const expedition = current.expedition;
    const mapResult = this.content.getMap(expedition.mapId);
    if (!mapResult.ok) {
      this.setExplorationMessage(mapResult.error.code);
      return mapResult;
    }
    const chest = mapResult.value.objects.find((object): object is Extract<typeof mapResult.value.objects[number], { kind: "chest" }> => object.kind === "chest" && object.objectId === objectId);
    if (!chest) {
      const result = failure(createDomainError("INVALID_CONTENT", { path: `maps.${expedition.mapId}.objects`, issueKey: "unknown_chest_object" }));
      this.setExplorationMessage(result.error.code);
      return result;
    }
    const transactionId = `reward_${expedition.expeditionId}_${objectId}`;
    if (expedition.openedChestObjectIds.includes(objectId) || current.claimedRewardTransactionIds.includes(transactionId)) {
      const result = failure(createDomainError("REWARD_ALREADY_CLAIMED", { transactionId }));
      this.setExplorationMessage(result.error.code);
      return result;
    }
    const tableResult = this.content.getDropTable(chest.dropTableId);
    if (!tableResult.ok) {
      this.setExplorationMessage(tableResult.error.code);
      return tableResult;
    }
    if (tableResult.value.id !== chest.dropTableId) {
      const result = failure(createDomainError("INVALID_CONTENT", { path: `dropTables.${chest.dropTableId}`, issueKey: "id_mismatch" }));
      this.setExplorationMessage(result.error.code);
      return result;
    }

    let candidate = this.chestCandidates.get(objectId);
    if (candidate && candidate.expectedRevision !== current.revision) {
      const result = failure(createDomainError("STALE_REVISION", { expectedRevision: candidate.expectedRevision, actualRevision: current.revision }));
      this.setExplorationMessage(result.error.code);
      return result;
    }
    if (!candidate) {
      const lootContent = this.createLootContent(current);
      if (!lootContent.ok) {
        this.setExplorationMessage(lootContent.error.code);
        return lootContent as DomainResult<GameSaveV1>;
      }
      const generated = generateLoot({
        transactionId,
        source: { kind: "chest", mapId: expedition.mapId, objectId, dropTableId: chest.dropTableId },
        table: tableResult.value as unknown as Parameters<typeof generateLoot>[0]["table"],
        inventory: current.inventory,
        content: lootContent.value,
        rng: SeededRng.fromSeed(expedition.expeditionSeed).derive(`chest:${objectId}:loot`),
        gold: 0,
        xp: 0,
        acquiredAt: expedition.startedAt,
        nextInstanceId: (index) => `reward_${expedition.expeditionId}_${objectId}_instance_${index}`,
      });
      if (!generated.ok) {
        this.setExplorationMessage(generated.error.code);
        return generated as DomainResult<GameSaveV1>;
      }
      const claimed = claimReward({
        inventory: current.inventory,
        reward: generated.value,
        claimedRewardTransactionIds: current.claimedRewardTransactionIds,
        content: lootContent.value,
      });
      if (!claimed.ok) {
        this.setExplorationMessage(claimed.error.code);
        return claimed as DomainResult<GameSaveV1>;
      }
      const next = clone(current) as GameSaveV1;
      next.inventory = claimed.value.inventory;
      next.claimedRewardTransactionIds = [...claimed.value.claimedRewardTransactionIds];
      next.gold += claimed.value.reward.gold;
      const chestOrder = new Map(
        mapResult.value.objects
          .filter((object) => object.kind === "chest")
          .map((object, index) => [object.objectId, index] as const),
      );
      if (!chestOrder.has(objectId)) {
        const result = failure(createDomainError("INVALID_CONTENT", { path: "maps.objects", issueKey: "unknown_chest_object" }));
        this.setExplorationMessage(result.error.code);
        return result;
      }
      next.expedition!.openedChestObjectIds = [...next.expedition!.openedChestObjectIds, objectId]
        .sort((left, right) => chestOrder.get(left)! - chestOrder.get(right)!);
      candidate = { objectId, transactionId, expectedRevision: current.revision, nextSave: next, reward: claimed.value.reward };
      this.chestCandidates.set(objectId, candidate);
    }

    const committed = await this.commitChestCandidate(candidate);
    if (!committed.ok) {
      this.setExplorationMessage(committed.error.code);
      return committed;
    }
    this.chestCandidates.delete(objectId);
    this.setExplorationMessage(this.chestMessage(objectId, candidate.reward));
    return committed;
  }

  private async commitChestCandidate(candidate: ChestRewardCandidate): Promise<DomainResult<GameSaveV1>> {
    if (!this.store || !this.coordinator) return domainFailure("save");
    let result;
    const pendingId = candidate.candidateId;
    const pending = pendingId ? this.coordinator.pendingCandidates.find((item) => item.candidateId === pendingId) : undefined;
    if (pending) {
      result = await this.coordinator.retry(pending.candidateId);
    } else {
      const current = this.store.getSnapshot();
      const next = clone(candidate.nextSave) as GameSaveV1;
      next.revision = current.revision + 1;
      next.updatedAt = this.domain.now();
      const created = this.coordinator.createCandidate("transaction", next, { expectedRevision: candidate.expectedRevision });
      result = await this.coordinator.submit(created);
      if (!result.ok && result.candidateId) {
        this.chestCandidates.set(candidate.objectId, { ...candidate, candidateId: result.candidateId });
      }
    }
    if (!result.ok) return failure(result.error);
    this.saveValue = clone(result.save) as GameSaveV1;
    return success(result.save);
  }

  private async handleExplorationInteraction(target: InteractionTarget): Promise<void> {
    if (target.action === "returnTown") {
      const returned = await this.returnToTown();
      if (!returned.ok) this.setExplorationMessage(returned.error.code);
      return;
    }
    if (target.action === "openFloorSelect") {
      this.setExplorationMessage("INVALID_CONTENT");
    }
  }

  /**
   * 所有 COMPLETE 都只做 battle=null 的独立事务；失败保留 pending candidate，
   * 后续点击复用同一候选，避免再次生成奖励、经验、HP 或远征进度。
   */
  private cleanupRetainedExpeditionBattle(save: Readonly<GameSaveV1>): Promise<DomainResult<GameSaveV1>> {
    if (save.battle === null) {
      this.terminalCleanupCandidateId = null;
      this.terminalCleanupError = null;
      return Promise.resolve(success(save as GameSaveV1));
    }
    if (save.battle.phase !== "COMPLETE") {
      return Promise.resolve(failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["COMPLETE"], actual: save.battle.phase })));
    }
    if (this.terminalCleanupInFlight) return this.terminalCleanupInFlight;
    const request = this.submitTerminalCleanup(save)
      .then((result) => {
        this.terminalCleanupError = result.ok ? null : result.error.code;
        return result;
      })
      .finally(() => {
        if (this.terminalCleanupInFlight === request) this.terminalCleanupInFlight = null;
      });
    this.terminalCleanupInFlight = request;
    return request;
  }

  /** 独立清理只消费既有 SaveCoordinator candidate；不会把终局重新送回 Gateway。 */
  private async submitTerminalCleanup(save: Readonly<GameSaveV1>): Promise<DomainResult<GameSaveV1>> {
    if (!this.store || !this.coordinator) return domainFailure("save");
    const pending = this.terminalCleanupCandidateId
      ? this.coordinator.pendingCandidates.find((candidate) => candidate.candidateId === this.terminalCleanupCandidateId)
      : undefined;
    let result;
    if (pending) {
      result = await this.coordinator.retry(pending.candidateId);
    } else {
      const current = this.store.getSnapshot();
      const next = clone(save) as GameSaveV1;
      next.battle = null;
      next.revision = current.revision + 1;
      next.updatedAt = this.domain.now();
      const candidate = this.coordinator.createCandidate("transaction", next, { expectedRevision: current.revision });
      result = await this.coordinator.submit(candidate);
      // 只有确实留在 pending 中的失败候选才记录；阻塞错误不污染后续重试。
      if (!result.ok && this.coordinator.pendingCandidates.some((item) => item.candidateId === candidate.candidateId)) {
        this.terminalCleanupCandidateId = candidate.candidateId;
      }
    }
    if (!result.ok) {
      if (result.candidateId && this.coordinator.pendingCandidates.some((item) => item.candidateId === result.candidateId)) {
        this.terminalCleanupCandidateId = result.candidateId;
      }
      return failure(result.error);
    }
    this.saveValue = clone(result.save) as GameSaveV1;
    this.terminalCleanupCandidateId = null;
    return success(result.save);
  }

  /**
   * 将战斗中的 party 单位严格映射回角色存档。战斗单位是唯一的战后 HP
   * 来源；未上场角色只在 defeat 分支通过 ProgressionService 计算静态上限。
   */
  private syncBattlePartyHealth(
    next: GameSaveV1,
    battle: Readonly<BattleSnapshotV1>,
    outcome: "victory" | "retreat" | "defeat",
  ): DomainResult<true> {
    const partyUnits = battle.units.filter((unit) => unit.faction === "party");
    const mapped = new Map<string, (typeof partyUnits)[number]>();
    for (const unit of partyUnits) {
      if (mapped.has(unit.definitionId)) {
        return failure(createDomainError("INVALID_CONTENT", {
          path: `battle.units.${unit.unitId}.definitionId`,
          issueKey: "duplicate_party_definition",
        }));
      }
      if (!next.characters[unit.definitionId]) {
        return failure(createDomainError("INVALID_CONTENT", {
          path: `battle.units.${unit.unitId}.definitionId`,
          issueKey: "unknown_party_definition",
        }));
      }
      mapped.set(unit.definitionId, unit);
    }

    const maxHpFor = (characterId: string, unit: (typeof partyUnits)[number] | undefined): DomainResult<number> => {
      if (unit) {
        if (!Number.isSafeInteger(unit.stats.maxHp) || unit.stats.maxHp < 1) {
          return failure(createDomainError("INVALID_CONTENT", {
            path: `battle.units.${unit.unitId}.stats.maxHp`,
            issueKey: "max_hp_range",
          }));
        }
        return success(unit.stats.maxHp);
      }
      const progress = next.characters[characterId];
      if (!progress) {
        return failure(createDomainError("INVALID_CONTENT", {
          path: `characters.${characterId}`,
          issueKey: "unknown_party_definition",
        }));
      }
      // 备战角色没有战斗单位快照，使用现有成长服务的静态内容计算，
      // 不从装备实例或字段别名推测隐藏的生命修正。
      const root = this.content?.getRoot();
      if (!root) return domainFailure("save");
      // Catalog 只读快照与 EquipmentService 的只读消费接口在嵌套数组上
      // 存在 readonly 方向差异；此处只传递内容，不让服务反向修改它。
      const equipmentContent = {
        equipmentBases: root.equipmentBases,
        equipmentAffixes: root.equipmentAffixes,
        economy: root.economy,
        characters: root.characters,
      } as unknown as Parameters<typeof calculateStaticMaxHp>[0];
      return calculateStaticMaxHp(equipmentContent, next, characterId);
    };

    if (outcome === "defeat") {
      for (const [characterId, progress] of Object.entries(next.characters)) {
        if (!progress.recruited) continue;
        const maxHp = maxHpFor(characterId, mapped.get(characterId));
        if (!maxHp.ok) return maxHp;
        progress.currentHp = Math.max(1, Math.floor(maxHp.value * 5000 / 10000));
      }
      return success(true);
    }

    for (const [characterId, unit] of mapped) {
      const progress = next.characters[characterId];
      if (!progress) return failure(createDomainError("INVALID_CONTENT", { path: `characters.${characterId}`, issueKey: "unknown_party_definition" }));
      progress.currentHp = outcome === "victory" ? Math.max(1, unit.currentHp) : unit.currentHp;
    }
    return success(true);
  }

  /** 战斗返回安全点只作用于仍可继续的远征；bossRetry/回响在终局清理远征。 */
  private applyBattleReturnPoint(next: GameSaveV1, battle: Readonly<BattleSnapshotV1>): void {
    if (!next.expedition) return;
    const safe = clone(battle.returnSafePosition);
    next.expedition.playerPosition = safe;
    next.expedition.safePosition = clone(safe);
    next.expedition.encounterProtectionStepsRemaining = 180;
  }

  /**
   * 城镇楼层入口的统一分流。普通远征由 ExpeditionModeService 物化；
   * Boss 重试和深渊回响使用 detached coordinator，保存成功后才挂载战斗。
   */
  public async enterFloorWithMode(
    floorId = "floor_01",
    mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho" = "exploration",
    echoId?: string,
    currentSave: Readonly<GameSaveV1> | null = null,
  ): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue) return domainFailure("save");
    this.pendingContact = null;
    this.encounterInFlight = null;
    const save = currentSave ?? this.saveValue;

    if (mode === "bossRetry") {
      return this.startBossRetry(floorId, save.revision);
    }
    if (mode === "abyssEcho") {
      if (!echoId) return failure(createDomainError("INVALID_CONTENT", { path: "departure.echoId", issueKey: "required" }));
      return this.startAbyssEcho(echoId, save.revision);
    }

    let result: DomainResult<GameSaveV1>;
    if (this.options.departFloor) {
      result = await this.options.departFloor(floorId, save, mode);
    } else {
      result = await this.departWithDomain(floorId, save, mode);
    }
    if (!result.ok) return result;
    this.setSave(result.value);
    await this.route("exploration");
    this.setState("exploration");
    return success(this.saveValue ?? result.value);
  }

  /** 保留原有公开签名，TownScene/外部按钮统一调用带 mode 的实现。 */
  public async enterFloor(
    floorId = "floor_01",
    mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho" = "exploration",
    echoId?: string,
  ): Promise<DomainResult<GameSaveV1>> {
    return this.enterFloorWithMode(floorId, mode, echoId);
  }

  /** 自动移动仍消费 ExplorationScene.fixedUpdate；点击只登记会话，不占满主线程。 */
  public triggerEncounter(): Promise<DomainResult<BattleSnapshotV1>> {
    if (this.autoEncounterInFlight) return this.autoEncounterInFlight;
    this.autoEncounterError = null;
    this.autoEncounterFailureDiagnostics = null;
    const request = this.executeTriggerEncounter();
    this.autoEncounterInFlight = request;
    this.renderUi();
    // request 正常返回 DomainResult；即便适配器意外 reject，也要清理自己的占用并重绘，
    // 不能让下一次真实点击永远被卡在旧的 in-flight Promise 上。
    void request.then(
      (result) => this.finishAutoEncounterRequest(request, result),
      () => this.finishAutoEncounterRequest(request, null),
    );
    return request;
  }

  private finishAutoEncounterRequest(
    request: Promise<DomainResult<BattleSnapshotV1>>,
    result: DomainResult<BattleSnapshotV1> | null,
  ): void {
    if (this.autoEncounterInFlight !== request) return;
    this.autoEncounterInFlight = null;
    this.autoEncounterError = result && !result.ok
      ? formatAutoEncounterError(result.error, this.autoEncounterFailureDiagnostics)
      : null;
    if (result === null || result.ok) this.autoEncounterFailureDiagnostics = null;
    this.renderUi();
  }

  private async executeTriggerEncounter(): Promise<DomainResult<BattleSnapshotV1>> {
    // 药水可能已经构造了候选但尚未完成 CAS；先等待它结束，再重新读取 saveValue，
    // 禁止使用等待前捕获的旧 revision 启动遭遇。
    const fieldItemRequest = this.fieldItemInFlight;
    if (fieldItemRequest) await fieldItemRequest.catch(() => undefined);
    if (!this.ensureReady() || !this.saveValue) return domainFailure("save");
    if (this.options.transitionEncounter) {
      const result = await this.options.transitionEncounter(this.saveValue);
      if (!result.ok) return result as DomainResult<BattleSnapshotV1>;
      await this.finishEncounterStart(result.value);
      return success(result.value.battle);
    }
    if (!this.explorationScene || !this.saveValue.expedition) return domainFailure("save");
    const mapResult = this.content!.getMap(this.saveValue.expedition.mapId);
    if (!mapResult.ok) return mapResult as DomainResult<BattleSnapshotV1>;
    // 自动寻怪按内容目录中的 normal→elite→boss 优先级选择，不根据行为模式或对象后缀猜测。
    const targetResult = selectAutoEncounterTarget(
      mapResult.value.objects,
      this.saveValue.expedition.defeatedEncounterObjectIds,
      (encounterId) => this.content!.getEncounter(encounterId),
    );
    if (!targetResult.ok) return targetResult;
    const target = targetResult.value;
    if (!target) return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: null }));

    const actor = this.explorationScene.actorViews.find((candidate) => candidate.objectId === target.objectId);
    if (!actor) return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: target.objectId }));
    const path = findAutoPath(mapResult.value, this.explorationScene.state.playerPosition, actor.position);
    if (!path) return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: target.objectId }));

    // 仅建立首条路径并挂起 resolver；后续移动完全由已有 fixed ticker 推进。
    this.autoPath = [...path];
    this.autoTarget = this.autoPath.shift() ?? { ...actor.position };
    this.autoMoving = true;
    const maxSteps = autoRouteStepBudget(autoRouteRequiredSteps(this.explorationScene.state.playerPosition, path));
    return new Promise<DomainResult<BattleSnapshotV1>>((resolve) => {
      this.autoEncounterSession = {
        targetObjectId: target.objectId,
        map: mapResult.value,
        resolve,
        steps: 0,
        maxSteps,
        nextReplanStep: 32,
        lastTargetPosition: { ...actor.position },
        commandedMove: { x: 0, y: 0 },
        playerBeforeFixed: null,
        playerAfterFixed: null,
        stalledSteps: 0,
      };
    });
  }

  /** 按队伍槽位顺序解析第一个可治疗角色，最大生命值统一走装备服务公式。 */
  private resolveFieldPotionTarget(
    save: GameSaveV1,
    equipmentContent: EquipmentServiceContent,
  ): DomainResult<{ readonly characterId: string; readonly maxHp: number }> {
    if (save.expedition === null) {
      return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: "item_minor_potion", reason: "NOT_IN_EXPEDITION" }));
    }
    if (save.battle !== null) {
      return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: "item_minor_potion", reason: "BATTLE_ACTIVE" }));
    }
    const owned = save.inventory.stackables.item_minor_potion ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 1) {
      return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: "item_minor_potion" }));
    }

    let fullTargetId: string | null = null;
    let deadTargetId: string | null = null;
    for (const characterId of save.party.slots) {
      if (characterId === null) continue;
      const progress = save.characters[characterId];
      if (!progress || progress.characterId !== characterId || progress.recruited !== true) continue;
      if (!Number.isSafeInteger(progress.currentHp) || progress.currentHp < 0) {
        return failure(createDomainError("INVALID_CONTENT", {
          path: `characters.${characterId}.currentHp`,
          issueKey: "current_hp_range",
        }));
      }
      if (progress.currentHp === 0) {
        deadTargetId ??= characterId;
        continue;
      }
      const maxHp = calculateStaticMaxHp(equipmentContent, save, characterId);
      if (!maxHp.ok) return maxHp;
      if (progress.currentHp < maxHp.value) return success({ characterId, maxHp: maxHp.value });
      fullTargetId ??= characterId;
    }

    return failure(createDomainError("INVALID_TARGET", {
      reason: fullTargetId !== null ? "FULL_HP" : "DEAD",
      targetUnitId: fullTargetId ?? deadTargetId,
    }));
  }

  /** 野外药水沿 FieldItemService + CAS 提交；同一帧连点复用同一个 Promise。 */
  public useFieldPotion(): Promise<DomainResult<FieldItemUseResult>> {
    if (this.fieldItemInFlight) return this.fieldItemInFlight;
    const request = this.executeFieldPotion().finally(() => {
      if (this.fieldItemInFlight === request) {
        this.fieldItemInFlight = null;
        this.renderUi();
      }
    });
    this.fieldItemInFlight = request;
    this.renderUi();
    return request;
  }

  private async executeFieldPotion(): Promise<DomainResult<FieldItemUseResult>> {
    const current = this.saveValue;
    const equipmentContent = this.managementEquipmentContent();
    const service = this.ensureFieldItemService();
    let result: DomainResult<FieldItemUseResult>;
    if (!this.ensureReady() || !current || !equipmentContent || !service) {
      result = domainFailure("save");
    } else {
      const target = this.resolveFieldPotionTarget(current, equipmentContent);
      if (!target.ok) {
        result = target;
      } else {
        try {
          result = await service.use(current, {
            expectedRevision: current.revision,
            itemId: "item_minor_potion",
            targetCharacterId: target.value.characterId,
          }, {
            save: (expectedRevision, nextSave) => this.persistManagement(expectedRevision, nextSave),
            staticMaxHp: (candidate, characterId) => calculateStaticMaxHp(equipmentContent, candidate, characterId),
          });
        } catch {
          result = failure(createDomainError("SAVE_FAILED", { operation: "save" }));
        }
      }
    }

    this.fieldItemError = result.ok ? null : result.error.code;
    this.renderUi();
    return result;
  }

  public useBasicAttack(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.runBattleCommand(() => this.executeBasicAttack());
  }

  /** 防御和撤退均复用 Gateway 的 revision/CAS 与终局处理，不在 UI 层改快照。 */
  public useDefend(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.runBattleCommand(() => this.executeSimpleBattleCommand("DEFEND"));
  }

  public useRetreat(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.runBattleCommand(() => this.executeSimpleBattleCommand("RETREAT"));
  }

  /** 战斗 Pixi HUD 的动作回调；每个动作仍回到既有 Gateway/CAS 入口。 */
  private handleBattleViewAction(action: BattleHudActionId): void | Promise<void> {
    switch (action) {
      case "basic": return this.useBasicAttack().then(() => undefined);
      case "skill": this.battleScene?.toggleSkillDrawer(); return;
      case "defend": return this.useDefend().then(() => undefined);
      case "item": return this.useMinorPotion().then(() => undefined);
      case "more": this.battleScene?.toggleMoreDrawer(); return;
      case "active_1": return this.useEquippedSkill().then(() => undefined);
      case "active_2": return;
      case "ultimate": return this.useUltimateSkill().then(() => undefined);
      case "retreat": return this.useRetreat().then(() => undefined);
      case "log": return;
    }
  }

  /** 名称只从当前 ContentCatalog 的 nameKey 显式解析，不让渲染层猜字段。 */
  private battleUnitName(unit: BattleUnitViewModel): string {
    const definitionId = unit.unit.definitionId;
    const result = unit.unit.faction === "party"
      ? this.content?.getCharacter(definitionId)
      : this.content?.getEnemy(definitionId);
    return result?.ok ? managementLocale(result.value.nameKey, definitionId) : definitionId;
  }

  /** 技能表现文案严格来自当前 ContentCatalog；内容或 locale 缺失时只显示原始 ID。 */
  private battleSkillLabel(skillId: string): string {
    const result = this.content?.getSkill(skillId);
    return result?.ok ? managementLocale(result.value.nameKey, skillId) : skillId;
  }

  /** Combo 表现文案严格来自当前 ContentCatalog；不根据 ownerKey 或 ID 猜名称。 */
  private battleComboLabel(comboId: string): string {
    const result = this.content?.getCombo(comboId);
    return result?.ok ? managementLocale(result.value.nameKey, comboId) : comboId;
  }

  /** 玩家与敌方 AI 的 Gateway 提交统一经过当前 BattleScene，确保 CAS 成功事件只播放一次。 */
  private async executeBattleGateway(command: BattleCommandV1): Promise<BattleCommandGatewayResult> {
    if (!this.gateway) return { ok: false, error: createDomainError("SAVE_FAILED", { operation: "save" }), events: [] };
    if (this.battleScene) return this.battleScene.submitGatewayCommand(command);
    return this.gateway.execute(command);
  }

  private syncBattleHudAction(id: BattleHudActionId, enabled: boolean, reason: string | null = null): void {
    // renderUi 可能在一次状态变更中连续更新多个按钮；先只改 HUD 状态，调用方最后统一刷新表现帧。
    this.battleScene?.hud.setActionAvailability(id, enabled, reason);
  }

  private async executeSimpleBattleCommand(type: "DEFEND" | "RETREAT"): Promise<DomainResult<BattleSnapshotV1>> {
    if (!this.ensureReady() || !this.saveValue || !this.gateway || !this.saveValue.battle) return domainFailure("save");
    const battle = this.saveValue.battle;
    if (battle.phase !== "AWAIT_COMMAND" || !battle.currentUnitId) {
      return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND"], actual: battle.phase }));
    }
    const actor = battle.units.find((unit) => unit.unitId === battle.currentUnitId);
    if (!actor || actor.faction !== "party") {
      return failure(createDomainError("NOT_CURRENT_ACTOR", { actorUnitId: actor?.unitId ?? battle.currentUnitId, currentUnitId: battle.currentUnitId }));
    }
    const command: BattleCommandV1 = {
      type,
      expectedBattleRevision: battle.battleRevision,
      actorUnitId: actor.unitId,
    };
    const result = await this.executeBattleGateway(command);
    if (!result.ok) return battleGatewayFailure(result) as DomainResult<BattleSnapshotV1>;
    await this.afterBattleCommand(result);
    return success(result.value.snapshot);
  }

  private async executeBasicAttack(): Promise<DomainResult<BattleSnapshotV1>> {
    if (!this.ensureReady() || !this.saveValue) return domainFailure("save");
    if (this.options.submitBasicAttack) {
      const result = await this.options.submitBasicAttack(this.saveValue);
      if (!result.ok) return result as DomainResult<BattleSnapshotV1>;
      this.setSave(result.value.save);
      if (result.value.snapshot.phase === "COMPLETE" && !result.value.save.expedition) {
        await this.route("town");
        await this.releaseBattleLease();
        this.setState("town");
      } else if (result.value.snapshot.phase === "VICTORY") this.setState("reward");
      else this.setState("battle");
      return success(result.value.snapshot);
    }
    if (!this.gateway || !this.saveValue.battle) return domainFailure("save");
    const battle = this.saveValue.battle;
    if (battle.phase !== "AWAIT_COMMAND" || !battle.currentUnitId) return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND"], actual: battle.phase }));
    const actor = battle.units.find((unit) => unit.unitId === battle.currentUnitId);
    if (!actor || actor.faction !== "party") return failure(createDomainError("NOT_CURRENT_ACTOR", { actorUnitId: actor?.unitId ?? battle.currentUnitId, currentUnitId: battle.currentUnitId }));
    const target = battle.units.find((unit) => unit.faction === "enemy" && unit.currentHp > 0);
    if (!target) return domainFailure("save");
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: battle.battleRevision, actorUnitId: actor.unitId, targetUnitIds: [target.unitId] };
    const result = await this.executeBattleGateway(command);
    if (!result.ok) return battleGatewayFailure(result) as DomainResult<BattleSnapshotV1>;
    await this.afterBattleCommand(result);
    return success(result.value.snapshot);
  }

  /** 让首层纵切片可以使用初始背包中的战斗药水，仍走同一条 Gateway 原子扣除链。 */
  public useMinorPotion(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.runBattleCommand(() => this.executeMinorPotion());
  }

  private async executeMinorPotion(): Promise<DomainResult<BattleSnapshotV1>> {
    if (!this.ensureReady() || !this.saveValue || !this.gateway || !this.saveValue.battle) return domainFailure("save");
    const battle = this.saveValue.battle;
    if (battle.phase !== "AWAIT_COMMAND" || !battle.currentUnitId) {
      return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND"], actual: battle.phase }));
    }
    const actor = battle.units.find((unit) => unit.unitId === battle.currentUnitId);
    if (!actor || actor.faction !== "party") {
      return failure(createDomainError("NOT_CURRENT_ACTOR", { actorUnitId: actor?.unitId ?? battle.currentUnitId, currentUnitId: battle.currentUnitId }));
    }
    const owned = this.saveValue.inventory.stackables.item_minor_potion ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 1) {
      return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: "item_minor_potion" }));
    }
    const command: BattleCommandV1 = {
      type: "USE_ITEM",
      expectedBattleRevision: battle.battleRevision,
      actorUnitId: actor.unitId,
      itemId: "item_minor_potion",
      targetUnitIds: [actor.unitId],
    };
    const result = await this.executeBattleGateway(command);
    if (!result.ok) return battleGatewayFailure(result) as DomainResult<BattleSnapshotV1>;
    await this.afterBattleCommand(result);
    return success(result.value.snapshot);
  }

  /** 提交当前角色已装备的主动技能；目标仍按冻结技能 targetRule 生成。 */
  public async useEquippedSkill(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.usePlayerSkill("active");
  }

  /** 能量满时提交角色终极技能，保留 Gateway 的资源与目标校验。 */
  public async useUltimateSkill(): Promise<DomainResult<BattleSnapshotV1>> {
    return this.usePlayerSkill("ultimate");
  }

  private async usePlayerSkill(kind: "active" | "ultimate"): Promise<DomainResult<BattleSnapshotV1>> {
    return this.runBattleCommand(() => this.executePlayerSkill(kind));
  }

  private async executePlayerSkill(kind: "active" | "ultimate"): Promise<DomainResult<BattleSnapshotV1>> {
    if (!this.ensureReady() || !this.saveValue || !this.gateway || !this.saveValue.battle || !this.content) return domainFailure("save");
    const battle = this.saveValue.battle;
    if (battle.phase !== "AWAIT_COMMAND" || !battle.currentUnitId) {
      return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND"], actual: battle.phase }));
    }
    const actor = battle.units.find((unit) => unit.unitId === battle.currentUnitId);
    if (!actor || actor.faction !== "party") {
      return failure(createDomainError("NOT_CURRENT_ACTOR", { actorUnitId: actor?.unitId ?? battle.currentUnitId, currentUnitId: battle.currentUnitId }));
    }
    const progress = this.saveValue.characters[actor.definitionId];
    const character = this.content.getCharacter(actor.definitionId);
    if (!character.ok || !progress) return domainFailure("save");
    const skillId = kind === "ultimate" ? character.value.ultimateSkillId : progress.equippedActiveSkillIds.find((id): id is string => id !== null);
    if (!skillId) return failure(createDomainError("SKILL_LOCKED", { skillId: "" }));
    const skill = this.content.getSkill(skillId);
    if (!skill.ok) return skill as DomainResult<BattleSnapshotV1>;
    const level = progress.skillLevels[skillId] ?? 1;
    const energyCost = kind === "ultimate" ? 100 : skill.value.energyCostByLevel[Math.max(0, Math.min(4, level - 1))];
    if ((battle.units.find((unit) => unit.unitId === actor.unitId)?.energy ?? 0) < energyCost) {
      return failure(createDomainError("INSUFFICIENT_ENERGY", { required: energyCost, owned: actor.energy }));
    }
    if (kind === "active" && (actor.cooldowns[skillId] ?? 0) > 0) {
      return failure(createDomainError("SKILL_ON_COOLDOWN", { skillId, remainingTurns: actor.cooldowns[skillId] }));
    }
    const firstEnemy = battle.units.find((unit) => unit.faction === "enemy" && unit.currentHp > 0);
    if (!firstEnemy && !["allEnemies", "randomEnemy"].includes(skill.value.targetRule)) return domainFailure("save");
    const targetUnitIds = ["allEnemies", "randomEnemy", "allAllies", "self"].includes(skill.value.targetRule)
      ? []
      : [skill.value.targetRule === "singleAlly" ? actor.unitId : firstEnemy?.unitId ?? actor.unitId];
    const command: BattleCommandV1 = {
      type: kind === "ultimate" ? "USE_ULTIMATE" : "USE_SKILL",
      expectedBattleRevision: battle.battleRevision,
      actorUnitId: actor.unitId,
      skillId,
      targetUnitIds,
    };
    const result = await this.executeBattleGateway(command);
    if (!result.ok) return battleGatewayFailure(result) as DomainResult<BattleSnapshotV1>;
    await this.afterBattleCommand(result);
    return success(result.value.snapshot);
  }

  private runBattleCommand(
    operation: () => Promise<DomainResult<BattleSnapshotV1>>,
  ): Promise<DomainResult<BattleSnapshotV1>> {
    if (this.battleCommandInFlight) return this.battleCommandInFlight;
    // 同一帧的重复点击复用正在提交的 Promise，避免两个 candidate 争抢同一 revision。
    const request = operation().finally(() => {
      if (this.battleCommandInFlight === request) {
        this.battleCommandInFlight = null;
        this.renderUi();
      }
    });
    this.battleCommandInFlight = request;
    this.renderUi();
    return request;
  }

  /** 保留公开方法名；领取完成后依据已提交的远征状态继续楼层或返回城镇。 */
  public async claimRewardAndReturnTown(): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue) return domainFailure("save");
    if (this.options.settleReward) {
      const result = await this.options.settleReward(this.saveValue);
      if (!result.ok) return result;
      this.setSave(result.value);
      const cleaned = await this.cleanupRetainedExpeditionBattle(result.value);
      if (!cleaned.ok) {
        this.terminalCleanupError = cleaned.error.code;
        await this.route("town");
        await this.releaseBattleLease();
        this.setState("town");
        return cleaned;
      }
      await this.resumeAfterBattleCleanup(cleaned.value);
      return cleaned;
    }
    const save = this.saveValue;
    const battle = save.battle;
    const reward = battle?.reward;
    if (!battle || battle.phase !== "REWARD_PENDING" || reward === null || reward === undefined || !save.expedition) return domainFailure("save");
    const lootContent = this.createLootContent(save);
    if (!lootContent.ok) return lootContent as DomainResult<GameSaveV1>;
    const claimed = claimReward({ inventory: save.inventory, reward, claimedRewardTransactionIds: save.claimedRewardTransactionIds, content: lootContent.value });
    if (!claimed.ok) return claimed;
    const next = clone(save) as GameSaveV1;
    next.inventory = claimed.value.inventory;
    next.claimedRewardTransactionIds = [...claimed.value.claimedRewardTransactionIds];
    next.gold += claimed.value.reward.gold;
    next.battle = clone(battle);
    next.battle.reward = claimed.value.reward;
    next.battle.phase = "COMPLETE";
    const expedition = next.expedition;
    if (!expedition) return domainFailure("save");
    const health = this.syncBattlePartyHealth(next, next.battle, "victory");
    if (!health.ok) return health;
    const defeated = expedition.defeatedEncounterObjectIds;
    if (!defeated.includes(next.battle.encounterObjectId)) defeated.push(next.battle.encounterObjectId);
    const mapResult = this.content?.getMap(expedition.mapId);
    if (!mapResult?.ok) return mapResult ?? domainFailure("save");
    const encounterOrder = new Map(
      mapResult.value.objects
        .filter((object) => object.kind === "encounter")
        .map((object, index) => [object.objectId, index] as const),
    );
    // 地图对象数组是远征进度的唯一顺序来源；先确认所有 ID 属于遭遇节点，
    // 再对候选副本排序，避免把未知对象静默塞进可持久化的进度数组。
    for (const objectId of defeated) {
      if (!encounterOrder.has(objectId)) {
        return failure(createDomainError("INVALID_CONTENT", {
          path: "expedition.defeatedEncounterObjectIds",
          issueKey: "unknown_encounter_object",
        }));
      }
    }
    defeated.sort((left, right) => encounterOrder.get(left)! - encounterOrder.get(right)!);
    const encounterResult = this.content?.getEncounter(next.battle.encounterId);
    if (!encounterResult?.ok) return encounterResult ?? domainFailure("save");
    const progression = this.applyEncounterProgress(next, encounterResult.value as unknown as EncounterDefinition, claimed.value.reward.xp);
    if (!progression.ok) return progression;

    // 普通探索/短程领取后回到楼层安全点继续原远征；Boss 重试的
    // 首通奖励则结束 detached expedition，再返回城镇。
    const keepExpedition = expedition.mode === "exploration" || expedition.mode === "shortFarm";
    if (keepExpedition) this.applyBattleReturnPoint(next, next.battle);
    next.expedition = keepExpedition ? expedition : null;
    const committed = await this.commitSave("battle", next);
    if (!committed.ok) return committed;
    const cleaned = await this.cleanupRetainedExpeditionBattle(committed.value);
    if (!cleaned.ok) {
      this.terminalCleanupError = cleaned.error.code;
      await this.route("town");
      await this.releaseBattleLease();
      this.setState("town");
      return cleaned;
    }
    await this.resumeAfterBattleCleanup(cleaned.value);
    return cleaned;
  }

  /** 场景必须与清理成功后的权威存档一致，避免身在城镇却被未结束的远征锁住。 */
  private async resumeAfterBattleCleanup(save: Readonly<GameSaveV1>): Promise<void> {
    const destination = save.expedition ? "exploration" : "town";
    await this.route(destination);
    await this.releaseBattleLease();
    this.setState(destination);
  }

  /** 奖励页按钮复用同一 Promise；失败只显示可重试错误，不把奖励候选丢掉。 */
  private claimRewardFromUi(): Promise<DomainResult<GameSaveV1>> {
    if (this.rewardClaimInFlight) return this.rewardClaimInFlight;
    const request = this.claimRewardAndReturnTown()
      .then((result) => {
        this.rewardError = result.ok ? null : result.error.code;
        this.renderUi();
        return result;
      })
      .catch(() => {
        const result: DomainResult<GameSaveV1> = failure(createDomainError("SAVE_FAILED", { operation: "save" }));
        this.rewardError = result.error.code;
        this.renderUi();
        return result;
      })
      .finally(() => {
        if (this.rewardClaimInFlight === request) {
          this.rewardClaimInFlight = null;
          this.renderUi();
        }
      });
    this.rewardClaimInFlight = request;
    this.rewardError = null;
    this.renderUi();
    return request;
  }

  /**
   * 奖励领取候选内同时写入经验和 Boss 世界进度；保存失败时这些修改不会
   * 进入 Store。非首通 Boss 不重复发放楼层推进或深渊次数。
   */
  private applyEncounterProgress(
    next: GameSaveV1,
    encounter: Readonly<EncounterDefinition>,
    xp: number,
  ): DomainResult<true> {
    const content = this.boundContent();
    const progression = new ProgressionService({
      getCharacter: content.getCharacter as unknown as (id: string) => DomainResult<Readonly<CharacterDefinition>>,
      getSkill: content.getSkill as unknown as (id: string) => DomainResult<Readonly<SkillDefinition>>,
    });
    const partyIds = new Set(next.party.slots.filter((id): id is string => id !== null));
    for (const [characterId, progress] of Object.entries(next.characters)) {
      const awarded = progression.awardExperience(progress, xp, partyIds.has(characterId));
      if (!awarded.ok) return awarded;
      next.characters[characterId] = awarded.value;
    }

    // 任务只读取显式 encounterCleared 条件；不从 objectId、文案或其它
    // 未声明字段猜测任务归属，完成结果与奖励仍在同一个候选存档内。
    const questContent = this.boundContent();
    const questService = new QuestService({ getQuest: questContent.getQuest });
    for (const quest of this.content?.getRoot().quests ?? []) {
      const condition = quest.completionCondition;
      if (condition.kind !== "encounterCleared" || condition.encounterId !== encounter.id) continue;
      const completed = questService.complete(quest.id, next.world, { kind: "encounterCleared", encounterId: encounter.id });
      if (!completed.ok) return completed;
      next.world = completed.value;
    }

    if (encounter.kind !== "boss" || !next.expedition) return success(true);
    const floorResult = content.getFloor(next.expedition.floorId);
    if (!floorResult.ok) return floorResult;
    const floor = floorResult.value;
    if (floor.bossEncounterId !== encounter.id) {
      return failure(createDomainError("INVALID_CONTENT", {
        path: `floors.${floor.id}.bossEncounterId`,
        issueKey: "boss_encounter_mismatch",
      }));
    }
    if (next.world.clearedBossEncounterIds.includes(encounter.id)) return success(true);

    next.world.clearedBossEncounterIds.push(encounter.id);
    next.world.highestUnlockedFloor = Math.min(10, Math.max(next.world.highestUnlockedFloor, floor.floorNumber + 1));
    if (floor.floorNumber === 10) next.world.storyCompleted = true;
    if (floor.isAbyss) next.world.echoCharges = Math.min(5, next.world.echoCharges + 1);
    return success(true);
  }

  /** 旅店恢复也走同一 SaveCoordinator；没有变化时不制造无意义 revision。 */
  public async restAtInn(): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue || !this.content) return domainFailure("save");
    const rested = new InnService({
      getCharacter: this.content.getCharacter.bind(this.content) as unknown as (id: string) => DomainResult<Readonly<CharacterDefinition>>,
    }).rest(this.saveValue);
    if (!rested.ok) return rested;
    if (!rested.value.changed) return success(this.saveValue);
    return this.commitSave("transaction", rested.value.save);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.lifecycleGeneration += 1;
    // 销毁不能留下等待 fixed ticker 的自动寻怪 Promise。
    this.failAutoEncounterSession();
    this.destroyed = true;
    // 销毁后允许 main 重新启动新控制器，加载期间必须重新显示占位文案。
    this.setStartupPlaceholderHidden(false);
    this.resetHeldMoveInput();
    this.runtime?.setFixedUpdateHandler?.(null);
    this.viewportUnsubscribe?.();
    this.viewportUnsubscribe = null;
    this.input.destroy();
    this.pendingContact = null;
    this.encounterInFlight = null;
    this.townModalRenderer?.destroy();
    this.townModalRenderer = null;
    this.townRestInFlight = null;
    this.townFloorDepartureInFlight = null;
    this.merchantBuyOfferId = null;
    this.townScene = null;
    this.clearUi();
    void this.releaseBattleLease();
  }

  private createDefaultContent(): ContentCatalog | null {
    const result = ContentCatalog.create(abyssEchoContentRoot, "final");
    return result.ok ? result.value : null;
  }

  private createDefaultRepository(): GameFlowRepository | null {
    if (typeof indexedDB === "undefined") return null;
    return new IndexedDbSaveRepository({ ...this.options.repositoryOptions, content: abyssEchoContentRoot });
  }

  private ensureReady(): boolean {
    return !this.destroyed && this.started && this.content !== null && this.router !== null && this.repository !== null;
  }

  private createInitialSave(): DomainResult<GameSaveV1> {
    if (!this.content) return domainFailure("create");
    try {
      const save = createNewGameSave(this.content.getRoot() as unknown as ContentRootV1, this.domain.now(), { newGameSeed: this.domain.nextSeed(), idFactory: this.domain.idFactory });
      const root = this.content.getRoot();
      // 纵切片提供两个固定的教程伙伴，完整招募池仍由城镇招募服务管理。
      const starterPartyIds = [root.protagonistCharacterId, "char_iron_guard", "char_ember_mage"];
      for (const characterId of starterPartyIds) {
        const progress = save.characters[characterId];
        const definition: ReturnType<ContentCatalog["getCharacter"]> = this.content.getCharacter(characterId);
        if (progress && definition.ok) {
          progress.recruited = true;
          // createNewGameSave 已按固定被动初始化 currentHp；这里仅扩充教程队伍，
          // 不再用裸 baseStats 覆盖同一份存档基线。
          // 三名首发角色都给一格可立即使用的主动技能，避免首层只有主角
          // 能使用技能，导致教程战斗只能依赖普攻拖长受伤回合数。
          const starterSkillId = definition.value.activeSkillIds[0] ?? null;
          if (starterSkillId !== null && progress.equippedActiveSkillIds.every((id) => id === null)) {
            progress.equippedActiveSkillIds = [starterSkillId, null];
            progress.skillLevels[starterSkillId] = 1;
          }
        }
      }
      save.party.slots = [starterPartyIds[0], starterPartyIds[1], starterPartyIds[2], null];
      return success(save);
    } catch {
      return domainFailure("create");
    }
  }

  private setSave(save: GameSaveV1): void {
    this.saveValue = clone(save) as GameSaveV1;
    // 更换存档时不能复用旧快照中的草稿；同一存档内的页面切换仍保留
    // screen 实例和选择态，由 onStoreReplaced 只更新权威投影。
    this.inventoryScreen = null;
    this.partyScreen = null;
    this.skillScreen = null;
    this.comboScreen = null;
    this.fieldItemService = null;
    this.fieldItemError = null;
    this.comboBeforeMatch = null;
    this.shopService = null;
    this.merchantPanelOpen = false;
    this.merchantPanelToken += 1;
    this.merchantBuyInFlight = null;
    this.merchantBuyOfferId = null;
    this.merchantError = null;
    this.rewardClaimInFlight = null;
    this.rewardError = null;
    this.fieldHudCache = null;
    this.flowErrorDetail = null;
    this.terminalCleanupCandidateId = null;
    this.terminalCleanupInFlight = null;
    this.terminalCleanupError = null;
    this.chestCandidates.clear();
    this.explorationMessage = null;
    this.store = new GameStore(this.saveValue);
    this.coordinator = new SaveCoordinator({ store: this.store, repository: this.repository! as SaveCoordinatorRepository, idFactory: this.domain.idFactory });
    // Catalog 的 getter 返回 DeepReadonly；领域服务只读这些定义，适配器在此处
    // 明确收窄到既有 BattleCommandGateway 合同，不增加字段别名或兼容结构。
    type GatewayContent = ConstructorParameters<typeof BattleCommandGateway>[0]["content"];
    this.gateway = new BattleCommandGateway({ store: this.store, coordinator: this.coordinator, content: this.boundContent() as unknown as GatewayContent });
  }

  /** ContentCatalog 方法含有 this；跨领域适配器传递前统一绑定，避免 getter 被拆出后失去上下文。 */
  private boundContent(): Pick<ContentCatalog, "getRoot" | "getCharacter" | "getSkill" | "getEnemy" | "getEncounter" | "getMap" | "getStatus" | "getSkillAffix" | "getItem" | "getDropTable" | "getAbyssEcho" | "getFloor" | "getEquipmentBase" | "getEquipmentAffix" | "getCombo" | "getRecruitment" | "getQuest"> {
    const catalog = this.content!;
    return {
      getRoot: catalog.getRoot.bind(catalog),
      getCharacter: catalog.getCharacter.bind(catalog),
      getSkill: catalog.getSkill.bind(catalog),
      getEquipmentBase: catalog.getEquipmentBase.bind(catalog),
      getEquipmentAffix: catalog.getEquipmentAffix.bind(catalog),
      getCombo: catalog.getCombo.bind(catalog),
      getEnemy: catalog.getEnemy.bind(catalog),
      getEncounter: catalog.getEncounter.bind(catalog),
      getMap: catalog.getMap.bind(catalog),
      getStatus: catalog.getStatus.bind(catalog),
      getSkillAffix: catalog.getSkillAffix.bind(catalog),
      getItem: catalog.getItem.bind(catalog),
      getDropTable: catalog.getDropTable.bind(catalog),
      getAbyssEcho: catalog.getAbyssEcho.bind(catalog),
      getFloor: catalog.getFloor.bind(catalog),
      getRecruitment: catalog.getRecruitment.bind(catalog),
      getQuest: catalog.getQuest.bind(catalog),
    };
  }

  private async commitSave(kind: SaveCandidateKind, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    if (!this.store || !this.coordinator) return domainFailure("save");
    const current = this.store.getSnapshot();
    nextSave.revision = current.revision + 1;
    nextSave.updatedAt = this.domain.now();
    const result = await this.coordinator.commit(kind, nextSave, { expectedRevision: current.revision });
    if (!result.ok) return result;
    this.saveValue = clone(result.save) as GameSaveV1;
    return success(result.save);
  }

  private async departWithDomain(
    floorId: string,
    save: Readonly<GameSaveV1>,
    mode: ExpeditionStartMode = "exploration",
  ): Promise<DomainResult<GameSaveV1>> {
    const service = new ExpeditionModeService({
      content: this.content! as unknown as ExpeditionModeContent,
      idFactory: this.domain.idFactory,
      seedFactory: this.domain.seedFactory,
      now: () => this.domain.now(),
    });
    const started = mode === "shortFarm"
      ? service.startShortFarm({ save, floorId })
      : service.startExploration({ save, floorId });
    if (!started.ok) return started;
    const committed = await this.commitSave("modeStart", started.value.save);
    return committed;
  }

  private async startBossRetry(floorId: string, expectedRevision: number): Promise<DomainResult<GameSaveV1>> {
    if (!this.assetService || !this.store || !this.coordinator || !this.content) {
      return failure(createDomainError("ASSET_LOAD_FAILED", { bundleId: "battle_common", attempts: 3 }));
    }
    const boundContent = this.boundContent();
    const coordinator = new BossRetryCoordinator({
      assetService: this.assetService,
      store: this.store as unknown as ConstructorParameters<typeof BossRetryCoordinator>[0]["store"],
      saveCoordinator: this.coordinator,
      content: boundContent as unknown as ConstructorParameters<typeof BossRetryCoordinator>[0]["content"],
      battleFactory: { create: (input) => this.createBattle(input) },
      idFactory: this.domain.idFactory,
      seedFactory: this.domain.seedFactory,
      now: () => this.domain.now(),
      battleBundleId: "battle_common",
    });
    const started = await coordinator.start({ floorId, expectedRevision });
    if (!started.ok) return started;
    this.setSave(started.value.save);
    this.battleLease = started.value.lease;
    await this.advanceBattleToAwait();
    if (this.flowErrorDetail !== null) {
      this.setState("error");
      return success(this.saveValue ?? started.value.save);
    }
    await this.route("battle");
    this.setState("battle");
    return success(this.saveValue ?? started.value.save);
  }

  private async startAbyssEcho(echoId: string, expectedRevision: number): Promise<DomainResult<GameSaveV1>> {
    if (!this.assetService || !this.store || !this.coordinator || !this.content) {
      return failure(createDomainError("ASSET_LOAD_FAILED", { bundleId: "battle_common", attempts: 3 }));
    }
    const boundContent = this.boundContent();
    const service = new AbyssEchoService({
      content: boundContent as unknown as ConstructorParameters<typeof AbyssEchoService>[0]["content"],
      idFactory: this.domain.idFactory,
      seedFactory: this.domain.seedFactory,
      now: () => this.domain.now(),
    });
    const factory = new BattleFactory(boundContent as unknown as BattleContentSource, {
      getAbyssEcho: boundContent.getAbyssEcho,
    });
    const coordinator = new AbyssEchoCoordinator({
      assetService: this.assetService,
      store: this.store as unknown as ConstructorParameters<typeof AbyssEchoCoordinator>[0]["store"],
      saveCoordinator: this.coordinator,
      service,
      battleFactory: { create: (input) => factory.create(input as Parameters<typeof factory.create>[0]) },
      battleBundleId: "battle_common",
    });
    const started = await coordinator.start({ echoId, expectedRevision });
    if (!started.ok) return started;
    this.setSave(started.value.save);
    this.battleLease = started.value.lease;
    await this.advanceBattleToAwait();
    if (this.flowErrorDetail !== null) {
      this.setState("error");
      return success(this.saveValue ?? started.value.save);
    }
    await this.route("battle");
    this.setState("battle");
    return success(this.saveValue ?? started.value.save);
  }

  private async finishEncounterStart(started: GameFlowBattleStartValue): Promise<void> {
    this.setSave(started.save);
    this.battleLease = started.lease ?? null;
    await this.advanceBattleToAwait();
    if (this.flowErrorDetail !== null) {
      this.setState("error");
      return;
    }
    await this.route("battle");
    this.setState("battle");
  }

  private async handleEncounterContact(contact: import("../domain/exploration/EncounterAi").EncounterContact): Promise<DomainResult<BattleSnapshotV1> | null> {
    if (this.stateValue !== "exploration" || !this.saveValue || !this.saveValue.expedition || this.pendingContact !== null) return null;
    this.pendingContact = contact;
    try {
      if (this.options.transitionEncounter) {
        const started = await this.options.transitionEncounter(this.saveValue);
        if (!started.ok) return started as DomainResult<BattleSnapshotV1>;
        await this.finishEncounterStart(started.value);
        return success(started.value.battle);
      }
      if (!this.assetService || !this.content || !this.store || !this.coordinator) return domainFailure("save");
      const service = new EncounterTransitionService({
        assetService: this.assetService,
        store: this.store as unknown as EncounterTransitionStore,
        saveCoordinator: this.coordinator,
        content: this.boundContent() as unknown as EncounterTransitionContent,
        battleFactory: { create: (input) => this.createBattle(input) },
        idFactory: { next: () => this.domain.nextId("battle") },
        battleBundleId: "battle_common",
      });
      const started = await service.transition({ contact, expectedRevision: this.saveValue.revision, playerPosition: this.explorationScene?.state.playerPosition ?? this.saveValue.expedition.playerPosition, safePosition: this.explorationScene?.state.safePosition ?? this.saveValue.expedition.safePosition });
      if (!started.ok) return started as DomainResult<BattleSnapshotV1>;
      this.saveValue = clone(started.value.save) as GameSaveV1;
      this.battleLease = started.value.lease;
      await this.advanceBattleToAwait();
      if (this.flowErrorDetail !== null) {
        this.setState("error");
        return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
      }
      await this.route("battle");
      this.setState("battle");
      return success(started.value.battle);
    } catch {
      return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    } finally {
      this.pendingContact = null;
    }
  }

  private createBattle(input: EncounterTransitionBattleInput): DomainResult<BattleSnapshotV1> {
    if (!this.content) return domainFailure("save");
    const root = this.content.getRoot();
    const rngState = SeededRng.fromSeed(input.expedition.expeditionSeed)
      .derive(`battle:${input.battleId}`)
      .getState();
    const boundContent = this.boundContent();
    const equipmentContent = {
      equipmentBases: root.equipmentBases,
      equipmentAffixes: root.equipmentAffixes,
      economy: root.economy,
      characters: root.characters,
      skills: root.skills,
      getCharacter: boundContent.getCharacter,
      getSkill: boundContent.getSkill,
    } as unknown as EquipmentServiceContent;
    const progression = new ProgressionService({
      getCharacter: boundContent.getCharacter as unknown as (id: string) => DomainResult<Readonly<CharacterDefinition>>,
      getSkill: boundContent.getSkill as unknown as (id: string) => DomainResult<Readonly<SkillDefinition>>,
    });
    // 战斗创建必须读取本次候选存档的装备快照；固定被动由 ProgressionService
    // 合并，装备只通过明确的基础属性 modifier 进入三段式战斗基线。
    const calculateCharacterBaseline: NonNullable<BattleFactoryInput["calculateCharacterBaseline"]> = (character, progress) => {
      const equipmentModifiers = calculateEquipmentStatModifiers(equipmentContent, input.save, character.id);
      if (!equipmentModifiers.ok) return equipmentModifiers;
      const calculated = progression.calculateStats(character.id, progress.level, equipmentModifiers.value);
      if (!calculated.ok) return calculated;
      return success({
        prePercentStats: calculated.value.prePercentStats,
        staticPercentByStatBps: calculated.value.staticPercentByStatBps,
        stats: calculated.value.stats,
      });
    };
    const factory = new BattleFactory(boundContent as unknown as BattleContentSource, {
      getAbyssEcho: boundContent.getAbyssEcho,
    });
    const factoryInput: BattleFactoryInput = {
      battleId: input.battleId,
      expedition: input.expedition,
      map: input.map,
      encounter: input.encounter,
      encounterObject: input.encounterObject,
      party: input.save.party,
      characters: input.save.characters,
      returnMapId: input.map.id,
      returnSafePosition: input.expedition.safePosition,
      comboIds: root.combos.map((combo) => combo.id),
      rngState,
      calculateCharacterBaseline,
    };
    return factory.create(factoryInput);
  }

  private async afterBattleCommand(result: Extract<BattleCommandGatewayResult, { ok: true }>): Promise<void> {
    this.saveValue = clone(result.save) as GameSaveV1;
    // 回响终局由 Gateway 在同一候选内完成评价、奖励和回城；此处只在
    // 保存成功后切回城镇，避免再次领取已经 claimed 的奖励。
    if (result.value.snapshot.phase === "COMPLETE" && !this.saveValue.expedition) {
      await this.route("town");
      await this.releaseBattleLease();
      this.setState("town");
      return;
    }
    if (result.value.snapshot.phase === "VICTORY") {
      const prepared = await this.prepareRewardPending();
      if (!prepared.ok) {
        this.setFlowError(`reward_prepare:${prepared.error.code} phase=VICTORY step=direct`);
        return;
      }
      this.setState("reward");
      return;
    }
    if (result.value.snapshot.phase === "DEFEAT" || result.value.snapshot.phase === "RETREAT") {
      await this.finishBattleTerminal(result.value.snapshot);
      return;
    }
    await this.advanceBattleToAwait();
    // 推进中的终局可能已回到楼层或城镇，不能再覆盖成战斗页。
    if (this.stateValue === "town" || this.stateValue === "exploration") return;
    if (this.flowErrorDetail !== null || this.stateValue === "error") {
      if (this.stateValue !== "error") this.setState("error");
      return;
    }
    if (this.saveValue?.battle?.phase === "AWAIT_COMMAND") {
      this.setState("battle");
      return;
    }
    const finalPhase = this.saveValue?.battle?.phase ?? "missing";
    if (finalPhase === "REWARD_PENDING") {
      // 以 CAS 提交后的权威阶段为准；敌方回合可能在本次指令回调内完成胜利。
      this.setState("reward");
      return;
    }
    // 不再把未预期阶段裸投影成 UNKNOWN_EXCEPTION，保留可检索的阶段信息。
    this.setFlowError(`unexpected_post_advance_phase:${finalPhase}`);
  }

  private async prepareRewardPending(): Promise<DomainResult<GameSaveV1>> {
    if (!this.saveValue?.battle) return domainFailure("save");
    const battleContent = this.content as unknown as BattleContentSource;
    const reduced = reduceBattle(this.saveValue.battle, { type: "TURN_END" }, { getEnemy: battleContent.getEnemy.bind(battleContent), getStatus: battleContent.getStatus?.bind(battleContent) });
    if (!reduced.ok) return reduced as DomainResult<GameSaveV1>;
    const reward = this.generateEncounterReward(this.saveValue, reduced.value);
    if (!reward.ok) return reward as DomainResult<GameSaveV1>;
    const next = clone(this.saveValue) as GameSaveV1;
    next.battle = reduced.value;
    next.battle.reward = reward.value;
    next.battle.phase = "REWARD_PENDING";
    const committed = await this.commitSave("battle", next);
    if (!committed.ok) return committed;
    return success(committed.value);
  }

  private async commitTerminalWithoutReward(snapshot: BattleSnapshotV1): Promise<DomainResult<GameSaveV1>> {
    if (!this.saveValue?.expedition) return domainFailure("save");
    const next = clone(this.saveValue) as GameSaveV1;
    next.battle = clone(snapshot);
    const battleContent = this.content as unknown as BattleContentSource;
    const reduced = reduceBattle(next.battle, { type: "TURN_END" }, { getEnemy: battleContent.getEnemy.bind(battleContent), getStatus: battleContent.getStatus?.bind(battleContent) });
    if (reduced.ok) next.battle = reduced.value;
    next.battle.phase = "COMPLETE";
    const outcome = snapshot.phase === "RETREAT" ? "retreat" : "defeat";
    const health = this.syncBattlePartyHealth(next, next.battle, outcome);
    if (!health.ok) return health;
    if (outcome === "retreat") this.applyBattleReturnPoint(next, next.battle);
    else next.expedition = null;
    return this.commitSave("battle", next);
  }

  private async finishBattleTerminal(snapshot: BattleSnapshotV1): Promise<void> {
    // 敌方回合也可能击倒我方；终局先写入 COMPLETE，清理后再恢复对应场景。
    const committed = await this.commitTerminalWithoutReward(snapshot);
    if (!committed.ok) {
      this.setFlowError(`commit:${committed.error.code} phase=${snapshot.phase} step=terminal`);
      return;
    }
    const cleaned = await this.cleanupRetainedExpeditionBattle(committed.value);
    if (!cleaned.ok) {
      this.terminalCleanupError = cleaned.error.code;
      await this.route("town");
      await this.releaseBattleLease();
      this.setState("town");
      return;
    }
    await this.resumeAfterBattleCleanup(cleaned.value);
  }

  private async advanceBattleToAwait(): Promise<void> {
    for (let guard = 0; guard < 64; guard += 1) {
      const battle = this.saveValue?.battle;
      if (!battle || !this.gateway) {
        this.setBattleFlowError("battle_or_gateway_missing", battle?.phase ?? null, guard);
        return;
      }
      if (battle.phase === "AWAIT_COMMAND") return;
      if (battle.phase === "VICTORY") {
        const prepared = await this.prepareRewardPending();
        if (!prepared.ok) {
          this.setBattleFlowError(`reward_prepare:${prepared.error.code}`, battle.phase, guard);
          return;
        }
        // 推进函数也可能从敌方/控制回合直接落到胜利；奖励提交成功后
        // 立即投影领取页，不能把 REWARD_PENDING 当成未知战斗阶段报错。
        this.setState("reward");
        return;
      }
      if (battle.phase === "DEFEAT" || battle.phase === "RETREAT") {
        await this.finishBattleTerminal(battle);
        return;
      }
      if (battle.phase === "COMPLETE") return;
      if (battle.phase === "AI_DECIDE") {
        const actor = battle.units.find((unit) => unit.unitId === battle.currentUnitId);
        if (!actor || actor.faction !== "enemy") {
          this.setBattleFlowError(`ai_actor_invalid:${battle.phase}/${battle.currentUnitId ?? "null"}`, battle.phase, guard);
          return;
        }
        const battleContent = this.boundContent() as unknown as BattleContentSource & EnemyAiContentSource;
        const enemy = battleContent.getEnemy(actor.definitionId);
        if (!enemy.ok) {
          this.setBattleFlowError(`enemy_content:${enemy.error.code}`, battle.phase, guard);
          return;
        }
        const decision = decideEnemyAction({ snapshot: battle, actorUnitId: actor.unitId, enemy: enemy.value, content: battleContent, rng: new SeededRng(battle.rngState) });
        if (!decision.ok) {
          this.setBattleFlowError(`enemy_ai:${decision.error.code}`, battle.phase, guard);
          return;
        }
        let result: BattleCommandGatewayResult;
        try {
          result = await this.executeBattleGateway(decision.value.command);
        } catch (error) {
          this.setBattleFlowError(`enemy_gateway_exception:${this.safeExceptionMessage(error)}`, battle.phase, guard);
          return;
        }
        if (!result.ok) {
          this.setBattleFlowError(`enemy_gateway:${result.error.code}`, battle.phase, guard);
          return;
        }
        this.saveValue = clone(result.save) as GameSaveV1;
        continue;
      }
      if (battle.phase === "RESOLVE_ACTION") {
        // 控制状态是一个正式合成根行动，不能只消费 RESOLVE_ACTION_COMPLETE；
        // 这样才能写入 TURN_SKIPPED、周期状态和同一 revision 的事件 trace。
        let result: BattleCommandGatewayResult;
        try {
          result = this.battleScene
            ? await this.battleScene.submitControlSkip()
            : await this.gateway.executeControlSkip();
        } catch (error) {
          this.setBattleFlowError(`control_skip_gateway_exception:${this.safeExceptionMessage(error)}`, battle.phase, guard);
          return;
        }
        if (!result.ok) {
          this.setBattleFlowError(`control_skip_gateway:${result.error.code}`, battle.phase, guard);
          return;
        }
        this.saveValue = clone(result.save) as GameSaveV1;
        continue;
      }
      // 严格驱动 BattleReducer 的完整事件链；尤其 TURN_END 不能跳成 TURN_START，
      // 否则当前行动者的冷却递减和 currentUnitId 清理会被绕过。
      const event = battle.phase === "INIT" ? { type: "ROUND_START" as const }
        : battle.phase === "ROUND_START" || battle.phase === "TURN_START" ? { type: "TURN_START" as const }
              : battle.phase === "DRAIN_PRE_ACTION" ? { type: "DRAIN_PRE_ACTION_COMPLETE" as const }
            : battle.phase === "DRAIN_TRIGGERS" ? { type: "DRAIN_TRIGGERS_COMPLETE" as const }
                : battle.phase === "TURN_END" ? { type: "TURN_END" as const }
                  : battle.phase === "ROUND_END" ? { type: "ROUND_END" as const }
                    : null;
      if (!event) {
        this.setBattleFlowError(`transition_event_missing:${battle.phase}`, battle.phase, guard);
        return;
      }
      const reduced = this.reducer.reduce(battle, event);
      if (!reduced.ok) {
        this.setBattleFlowError(`reducer:${reduced.error.code}`, battle.phase, guard);
        return;
      }
      const next = clone(this.saveValue!) as GameSaveV1;
      next.battle = reduced.value;
      const committed = await this.commitSave("battle", next);
      if (!committed.ok) {
        this.setBattleFlowError(`commit:${committed.error.code}`, battle.phase, guard);
        return;
      }
    }
    const phase = this.saveValue?.battle?.phase ?? "missing";
    this.setBattleFlowError(`guard_exhausted:${phase}`, phase === "missing" ? null : phase, 64);
  }

  private generateEncounterReward(save: Readonly<GameSaveV1>, battle: Readonly<BattleSnapshotV1>): DomainResult<RewardTransactionV1> {
    if (!this.content || !save.expedition) return domainFailure("save");
    const encounter = this.content.getEncounter(battle.encounterId);
    if (!encounter.ok) return encounter;
    const table = this.content.getDropTable(encounter.value.dropTableId);
    if (!table.ok) return table;
    const floor = this.content.getFloor(save.expedition.floorId);
    if (!floor.ok) return floor;
    const lootContent = this.createLootContent(save);
    if (!lootContent.ok) return lootContent as DomainResult<RewardTransactionV1>;
    const rng = SeededRng.fromSeed(save.expedition.expeditionSeed).derive(`encounter:${battle.battleId}:loot`);
    const isFirstClear = encounter.value.kind === "boss"
      && !save.world.clearedBossEncounterIds.includes(encounter.value.id);
    const firstClearTable = isFirstClear ? this.content.getDropTable(floor.value.firstClearRewardTableId) : success(null);
    if (!firstClearTable.ok) return firstClearTable;
    return generateLoot({
      transactionId: `reward_${battle.battleId}`,
      source: { kind: "encounter", encounterId: encounter.value.id, mapId: save.expedition.mapId, objectId: battle.encounterObjectId },
      table: table.value as unknown as Parameters<typeof generateLoot>[0]["table"],
      firstClearTable: (firstClearTable.value ?? undefined) as unknown as Parameters<typeof generateLoot>[0]["firstClearTable"],
      isFirstClear,
      inventory: save.inventory,
      content: lootContent.value,
      rng,
      xp: encounter.value.xpReward,
      gold: encounter.value.goldRewardMin,
      acquiredAt: save.updatedAt,
      nextInstanceId: (index) => `reward_${battle.battleId}_instance_${index}`,
    });
  }

  private createLootContent(save: Readonly<GameSaveV1>): DomainResult<LootContentSource> {
    if (!this.content) return domainFailure("save");
    const root = this.content.getRoot();
    const recruitedCharacterIds = Object.values(save.characters).filter((character) => character.recruited).map((character) => character.characterId);
    return success({
      getItem: this.content.getItem.bind(this.content) as LootContentSource["getItem"],
      equipment: { equipmentBases: root.equipmentBases, equipmentAffixes: root.equipmentAffixes, economy: root.economy } as unknown as LootContentSource["equipment"],
      skillStone: { getCharacter: this.content.getCharacter.bind(this.content), getSkill: this.content.getSkill.bind(this.content), getSkillAffix: this.content.getSkillAffix.bind(this.content), getRoot: () => root } as unknown as LootContentSource["skillStone"],
      recruitedCharacterIds,
    });
  }

  private route(kind: "title" | "town" | "exploration" | "battle"): Promise<void> {
    const generation = this.lifecycleGeneration;
    const operation = this.routeQueue.then(() => this.routeInternal(kind, generation));
    // 队列本身不能被一次失败污染；调用方仍然收到本次 route 的原始错误。
    this.routeQueue = operation.catch(() => undefined);
    return operation;
  }

  private assertRouteActive(generation: number): void {
    if (this.destroyed || generation !== this.lifecycleGeneration) throw new Error("GAME_FLOW_DESTROYED");
  }

  private async routeInternal(kind: "title" | "town" | "exploration" | "battle", generation: number): Promise<void> {
    if (!this.router) throw new Error("路由依赖未准备");
    this.assertRouteActive(generation);
    // 这里只重试已经 detached 的历史 lease；当前 scene 的 lease 要等本次 router transition 完成后再释放。
    await this.flushTownLeaseCleanup(generation);
    this.assertRouteActive(generation);
    if (kind !== "exploration" && this.autoEncounterSession && this.encounterInFlight === null) this.failAutoEncounterSession();
    if (kind !== "exploration") {
      this.resetHeldMoveInput();
      this.autoEncounterError = null;
      this.autoEncounterFailureDiagnostics = null;
    }
    if (kind !== "exploration" && this.encounterInFlight === null) this.pendingContact = null;
    if (kind !== "town") {
      this.managementPage = null;
      this.pendingFieldAction = null;
      this.npcRouteMessage = null;
      this.townModalResolution = null;
      this.townModalPageIndex = 0;
      this.townModalSelectedFloorId = null;
      this.townModalToken += 1;
      this.townModalError = null;
      this.townModalRenderer = null;
      this.merchantPanelOpen = false;
      this.merchantPanelToken += 1;
      this.merchantBuyInFlight = null;
      this.merchantBuyOfferId = null;
      this.merchantError = null;
      this.townRestInFlight = null;
      this.townFloorDepartureInFlight = null;
      this.managementRouteDiagnostic = null;
    }
    // 标题页允许没有持久化存档；标题场景不读取 save，其他场景必须使用
    // 已经由 CAS 提交的权威快照。
    const routeSave = this.saveValue;
    if (kind !== "title" && !routeSave) throw new Error("路由快照缺失");
    const root = await this.rootFactory();
    this.assertRouteActive(generation);
    const context: GameFlowSceneContext = { root, save: routeSave as GameSaveV1, viewport: this.viewportValue };
    let built: GameFlowSceneBuildResult | null = null;
    let transitionInvoked = false;
    try {
      built = await this.createScene(kind, context, generation);
      this.assertRouteActive(generation);
      transitionInvoked = true;
      await this.router.transition(built.scene, undefined);
      this.assertRouteActive(generation);
    } catch (error) {
      if (transitionInvoked && (this.destroyed || generation !== this.lifecycleGeneration)) {
        await this.destroyRouterForStaleRoute();
      }
      if (built?.townLease) await this.releaseTownLease(built.townLease);
      if (built?.battleFloorLease) await this.releaseAssetLease(built.battleFloorLease);
      throw error;
    }
    const previousTownLease = this.townLease;
    const committedTownLease = kind === "town" ? built.townLease : null;
    const previousBattleFloorLease = this.battleFloorLease;
    const committedBattleFloorLease = kind === "battle" ? built.battleFloorLease ?? null : null;
    try {
      if (previousTownLease && previousTownLease !== committedTownLease) {
        await this.releaseTownLease(previousTownLease);
      }
      if (kind === "battle" && previousBattleFloorLease && previousBattleFloorLease !== committedBattleFloorLease) {
        await this.releaseAssetLease(previousBattleFloorLease);
      }
      this.assertRouteActive(generation);
    } catch (error) {
      if (this.destroyed || generation !== this.lifecycleGeneration) {
        await this.destroyRouterForStaleRoute();
      }
      if (committedTownLease) await this.releaseTownLease(committedTownLease);
      if (committedBattleFloorLease) await this.releaseAssetLease(committedBattleFloorLease);
      throw error;
    }
    const scene = built.scene;
    this.townLease = committedTownLease;
    this.battleFloorLease = committedBattleFloorLease;
    this.currentScene = scene;
    this.explorationScene = kind === "exploration" && scene instanceof ExplorationScene ? scene : null;
    this.battleScene = kind === "battle" && scene instanceof BattleScene ? scene : null;
    this.townScene = kind === "town" && scene instanceof TownScene ? scene : null;
    this.forwardViewportToActiveScene(this.viewportValue);
    this.runtime?.setFixedUpdateHandler?.(kind === "town" || kind === "exploration" ? () => this.fixedUpdateStep() : null);
    this.renderUi();
  }

  private handleViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.viewportValue = viewport;
    this.forwardViewportToActiveScene(viewport);
    // page size 由 safeRect 几何决定；resize 后重新投影当前 panel，避免 renderer
    // 已切到新页大小而 command gate 仍按旧 pageIndex/pageCount 接受 stale 命令。
    if (this.stateValue === "town" && this.townModalRenderer && this.townModalResolution) {
      if (this.townScene?.activePanelKind === "floorSelect") this.renderTownFloorModal();
      else if (this.townScene?.activePanelKind === "dialogue") {
        this.renderTownNpcModal();
        this.renderUi();
      }
    }
    this.applySemanticViewportLayout();
    this.applyTitleSemanticLayout();
  }

  private forwardViewportToActiveScene(viewport: ViewportResult): void {
    const active = this.currentScene as (Scene<unknown> & { setViewport?: (value: ViewportResult) => void }) | null;
    active?.setViewport?.(viewport);
  }

  private async createScene(kind: "title" | "town" | "exploration" | "battle", context: GameFlowSceneContext, generation: number): Promise<GameFlowSceneBuildResult> {
    const custom = this.options.sceneFactories?.[kind];
    if (custom) return { scene: custom(context), townLease: null };
    if (kind === "title") {
      // fake root 继续只验证标题业务生命周期；生产 Pixi 根才挂载真实标题画布构图。
      const view = isPixiSceneRoot(context.root)
        ? (() => {
          const renderer = new TitleSceneRenderer({
          root: context.root,
          backgroundTexture: this.options.titleBackgroundTexture,
          onNewGame: () => { void this.newGame(); },
          onContinue: () => { void this.continueGame(); },
          });
          // 首次进入前先应用启动时安全区，避免标题 Pixi 层短暂显示基准坐标。
          renderer.setViewport(context.viewport);
          return renderer;
        })()
        : undefined;
      return {
        scene: new TitleScene({
          root: context.root,
          view,
          getViewState: () => ({ canContinue: this.storedSaveAvailable, busy: false, errorText: null }),
          createNewGame: () => this.newGame(),
        }),
        townLease: null,
      };
    }
    if (kind === "town") {
      if (isPixiSceneRoot(context.root)) return this.createProductionTownScene(context, generation);
      return {
        scene: new TownScene({
          root: context.root,
          viewport: context.viewport,
          input: this.input,
          npcContent: this.content!,
          currentSave: () => this.saveValue!,
          floors: this.content!.getRoot().floors as unknown as ConstructorParameters<typeof TownScene>[0]["floors"],
          departure: { depart: (input) => this.enterFloor(input.floor.id, input.mode) },
        }),
        townLease: null,
      };
    }
    if (kind === "exploration") {
      const expedition = context.save.expedition;
      if (!expedition) throw new Error("探索场景缺少远征");
      const production = isPixiSceneRoot(context.root);
      const mapResult = this.content!.getMap(expedition.mapId);
      if (!mapResult.ok) throw new Error("地图读取失败");
      const map = production
        ? this.resolveMapForField(expedition.mapId)
        : mapResult.value as unknown as ConstructorParameters<typeof ExplorationScene>[0]["map"];
      const floorResult = this.content!.getFloor(expedition.floorId);
      if (!floorResult.ok) throw new Error("楼层读取失败");
      const protagonist = this.content!.getCharacter(this.content!.getRoot().protagonistCharacterId);
      if (!protagonist.ok) throw new Error("主角读取失败");
      const resolver = production ? this.createProductionAssetResolver() : null;
      const resources = production && resolver ? this.productionResources(resolver) : this.resources();
      const protagonistFieldSpriteId = production
        ? this.requireCharacterFieldSprite(this.content!.getRoot().protagonistCharacterId, "protagonist")
        : protagonist.value.fieldSpriteId;
      const encounterFieldSpriteId = (encounterId: string): string => {
        if (production) return this.requireEncounterFieldSprite(encounterId);
        const result = this.content!.getEncounter(encounterId);
        return result.ok ? result.value.fieldSpriteId : "";
      };
      const productionTilesetAssetId = production ? MAP_TILESET_ASSET_IDS[map.id] : undefined;
      if (production && !productionTilesetAssetId) throw new Error(`PIXEL_FIELD_MAP_UNSUPPORTED:${map.id}`);
      // 继续远征必须从权威快照恢复运行态，不能回到地图出生点并丢失已击败遭遇。
      const initialState = createExplorationState(map, {
        playerPosition: expedition.playerPosition,
        safePosition: expedition.safePosition,
        defeatedEncounterObjectIds: expedition.defeatedEncounterObjectIds,
        encounterProtectionStepsRemaining: expedition.encounterProtectionStepsRemaining,
      });
      const musicId: "bgm_field" | "bgm_abyss" = floorResult.value.isAbyss ? "bgm_abyss" : "bgm_field";
      const commonOptions = {
        root: context.root,
        map,
        viewport: context.viewport,
        resources,
        tilesetAssetId: production
          ? productionTilesetAssetId as string
          : `tileset_${map.assetBundleId === "town" ? "map_town" : `map_${map.assetBundleId}`}`,
        input: this.input,
        assetService: this.assetService ?? undefined,
        playerFieldSpriteId: protagonistFieldSpriteId,
        encounterFieldSpriteId,
        musicId,
        initialState,
        openedChestObjectIds: expedition.openedChestObjectIds,
        onContact: (contact: import("../domain/exploration/EncounterAi").EncounterContact) => { this.pendingContact = contact; },
        onOpenChest: (objectId: string) => this.openChest(objectId).then((result) => result.ok),
        onInteraction: (target: InteractionTarget) => this.handleExplorationInteraction(target),
        onFieldAction: (action: Exclude<FieldInputAction, "interact">) => this.handleFieldAction(action),
      };
      if (production && resolver) {
        this.buildFieldHudStatus("exploration", map.id);
        return {
          scene: new ExplorationScene({
            ...commonOptions,
            view: new FieldSceneRenderer({ root: context.root, assets: resolver, objectAtlasId: "atlas_core_ui", inputState: this.input.inputState, viewport: context.viewport }),
            getHudStatus: () => this.buildFieldHudStatus("exploration", map.id),
            npcPresentation: (npcId: string) => this.requireNpcPresentation(npcId),
          }),
          townLease: null,
        };
      }
      return {
        scene: new ExplorationScene({
          ...commonOptions,
          npcFieldSpriteId: (npcId: string): string => {
            const result = this.content!.getNpc(npcId);
            return result.ok ? result.value.spriteId : "";
          },
        }),
        townLease: null,
      };
    }
    if (!this.gateway) throw new Error("战斗网关未准备");
    const battleHud = new BattleHud();
    const productionBattle = isPixiSceneRoot(context.root);
    const battleAssets = productionBattle ? this.createProductionAssetResolver() : null;
    const battleView = productionBattle && battleAssets
      ? new BattleSceneView({
        loadArtResources: loadBattleArtResources,
        actionLabel: (action) => {
          // 文案与实际指令读取同一当前角色装备槽，不把占位技能名展示为可用技能。
          if (action === "active_2") return "未开放";
          if (action !== "active_1" && action !== "ultimate") return null;
          const battle = this.saveValue?.battle;
          const actor = battle?.units.find((unit) => unit.unitId === battle.currentUnitId);
          if (!actor || actor.faction !== "party") return null;
          const character = this.content?.getCharacter(actor.definitionId);
          const skillId = action === "active_1"
            ? this.saveValue?.characters[actor.definitionId]?.equippedActiveSkillIds.find((id) => id !== null)
            : character?.ok ? character.value.ultimateSkillId : null;
          return skillId ? this.battleSkillLabel(skillId) : "未装备";
        },
        root: context.root,
        hud: battleHud,
          viewport: context.viewport,
          unitName: (unit) => this.battleUnitName(unit),
          skillLabel: (skillId) => this.battleSkillLabel(skillId),
          comboLabel: (comboId) => this.battleComboLabel(comboId),
          assets: battleAssets,
          battleSpriteId: (unit) => this.requireBattleSpriteId(unit),
          animationSpeed: context.save.settings.battleAnimationSpeed,
          reducedFlashes: context.save.settings.reducedFlashes,
          onAction: (action) => this.handleBattleViewAction(action),
      })
      : undefined;
    let battleFloorLease: AssetLease | null = null;
    try {
      if (productionBattle && this.assetService && context.save.expedition) {
        const floorResult = this.content?.getFloor(context.save.expedition.floorId);
        if (!floorResult?.ok) throw new Error(`PIXEL_BATTLE_FLOOR_INVALID:${context.save.expedition.floorId}`);
        const acquired = await this.assetService.acquire(floorResult.value.assetBundleId);
        if (!acquired.ok) throw new Error(`PIXEL_BATTLE_FLOOR_ACQUIRE_FAILED:${floorResult.value.assetBundleId}`);
        battleFloorLease = acquired.value;
      }
      return {
        scene: new BattleScene({
          root: context.root,
          getSnapshot: () => this.saveValue?.battle ?? (() => { throw new Error("战斗快照缺失"); })(),
          gateway: this.gateway,
          hud: battleHud,
          view: battleView,
          animatorOptions: {
            speed: context.save.settings.battleAnimationSpeed,
            reducedFlashes: context.save.settings.reducedFlashes,
          },
          viewport: context.viewport,
          onCommittedSnapshot: (snapshot) => {
            this.saveValue = this.store ? clone(this.store.getSnapshot()) as GameSaveV1 : this.saveValue;
            if (this.saveValue) this.saveValue.battle = clone(snapshot);
          },
        }),
        townLease: null,
        battleFloorLease,
      };
    } catch (error) {
      // 构造战斗场景失败时也要释放已取得的楼层 bundle，避免半成品路由泄漏引用。
      await this.releaseAssetLease(battleFloorLease);
      throw error;
    }
  }

  private async createProductionTownScene(context: GameFlowSceneContext, generation: number): Promise<GameFlowSceneBuildResult> {
    if (!this.content) throw new Error("PIXEL_FIELD_CONTENT_MISSING");
    if (!isPixiSceneRoot(context.root)) throw new Error("PIXEL_FIELD_ROOT_REQUIRED");
    const root = context.root;
    const mapResult = this.content.getMap("map_town");
    if (!mapResult.ok || mapResult.value.id !== "map_town") throw new Error("PIXEL_FIELD_MAP_INVALID:map_town");
    const map = mapResult.value as unknown as Readonly<MapDefinition>;
    const tilesetAssetId = MAP_TILESET_ASSET_IDS[map.id];
    if (!tilesetAssetId) throw new Error(`PIXEL_FIELD_MAP_UNSUPPORTED:${map.id}`);
    const manifestEntry = floors06To10AssetManifest.assets.find((entry) => entry.id === tilesetAssetId);
    if (!manifestEntry || manifestEntry.kind !== "mapTileset") throw new Error(`PIXEL_FIELD_TILESET_ENTRY_INVALID:${tilesetAssetId}`);
    if (manifestEntry.bundleId !== map.assetBundleId) throw new Error(`PIXEL_FIELD_TILESET_OWNER_MISMATCH:${map.id}/${tilesetAssetId}`);
    if (!this.assetService || typeof this.assetService.acquire !== "function") throw new Error("PIXEL_FIELD_ASSET_SERVICE_MISSING");
    const acquired = await this.assetService.acquire(map.assetBundleId);
    if (!acquired.ok) throw new Error(`PIXEL_FIELD_BUNDLE_ACQUIRE_FAILED:${map.assetBundleId}/${acquired.error.code}`);
    const townLease = acquired.value;
    try {
      this.assertRouteActive(generation);
      const resolver = this.createProductionAssetResolver();
      const protagonistId = this.content.getRoot().protagonistCharacterId;
      const playerFieldSpriteId = this.requireCharacterFieldSprite(protagonistId, "protagonist");
      // 先做一次完整 HUD 校验，错误在 detached scene 构造阶段暴露，不能延迟到 ticker。
      this.buildFieldHudStatus("town", map.id);
      const modal = new TownModalRenderer({
        root: root.modal,
        assets: resolver,
        atlasId: "atlas_core_ui",
        viewport: context.viewport,
        onCommand: (command) => this.handleTownModalCommand(command),
        onSemanticControlsChanged: () => this.handleTownModalSemanticControlsChanged(),
      });
      this.townModalRenderer = modal;
      return {
        scene: new TownScene({
          root,
          viewport: context.viewport,
          input: this.input,
          npcContent: this.content,
          currentSave: () => this.saveValue!,
          floors: this.content.getRoot().floors as unknown as ConstructorParameters<typeof TownScene>[0]["floors"],
          departure: { depart: (input) => this.enterFloor(input.floor.id, input.mode) },
          map,
          resources: this.productionResources(resolver),
          tilesetAssetId,
          playerFieldSpriteId,
          npcPresentation: (npcId: string) => this.requireNpcPresentation(npcId),
          view: new FieldSceneRenderer({ root, assets: resolver, objectAtlasId: "atlas_core_ui", inputState: this.input.inputState, viewport: context.viewport }),
          getHudStatus: () => this.buildFieldHudStatus("town", map.id),
          onNpcRoute: (resolution) => this.handleWorldNpcResolution(resolution),
          onNpcError: (npcId, error) => this.handleWorldNpcError(npcId, error),
          onPanelStateChange: (kind) => this.handleTownPanelStateChange(kind),
          onFloorSelectRequest: () => this.renderTownFloorModal(),
          modal,
          onInteraction: () => undefined,
          onFieldAction: (action: Exclude<FieldInputAction, "interact">) => this.handleFieldAction(action),
        }),
        townLease,
      };
    } catch (error) {
      this.townModalRenderer?.destroy();
      this.townModalRenderer = null;
      await this.releaseTownLease(townLease);
      throw error;
    }
  }

  private createProductionAssetResolver(): PixiAssetResolver {
    if (!this.assetService || typeof this.assetService.getLoadedResource !== "function") {
      throw new Error("PIXEL_FIELD_ASSET_SERVICE_MISSING");
    }
    return new PixiAssetResolver(floors06To10AssetManifest, {
      getLoadedResource: (bundleId) => this.assetService?.getLoadedResource?.(bundleId),
    });
  }

  private requireBattleSpriteId(unit: BattleUnitViewModel): string {
    if (!this.content) throw new Error("PIXEL_BATTLE_CONTENT_MISSING");
    if (unit.unit.faction === "party") {
      const result = this.content.getCharacter(unit.unit.definitionId);
      if (!result.ok || result.value.id !== unit.unit.definitionId || result.value.battleSpriteId.trim().length === 0) {
        throw new Error(`PIXEL_BATTLE_CHARACTER_INVALID:${unit.unit.definitionId}`);
      }
      return result.value.battleSpriteId;
    }
    const result = this.content.getEnemy(unit.unit.definitionId);
    if (!result.ok || result.value.id !== unit.unit.definitionId || result.value.spriteId.trim().length === 0) {
      throw new Error(`PIXEL_BATTLE_ENEMY_INVALID:${unit.unit.definitionId}`);
    }
    return result.value.spriteId;
  }

  private productionResources(resolver: PixiAssetResolver): import("../scenes/exploration/ExplorationScene").ExplorationSceneResources {
    const hasLoadedBundle = (bundleId: string): boolean => new Set(this.assetService?.getLoadedBundleIds?.() ?? []).has(bundleId);
    return {
      hasBundle: hasLoadedBundle,
      hasAsset: (assetId) => {
        let entry;
        try {
          entry = resolver.requireEntry(assetId);
        } catch {
          return false;
        }
        return entry !== undefined && hasLoadedBundle(entry.bundleId);
      },
      hasFieldSprite: (assetId) => {
        let entry;
        try {
          entry = resolver.requireEntry(assetId);
        } catch {
          return false;
        }
        return entry?.kind === "fieldActorSheet" && hasLoadedBundle(entry.bundleId);
      },
      hasCoreFrame: (frameId) => {
        let entry;
        try {
          entry = resolver.requireEntry("atlas_core_ui");
        } catch {
          return false;
        }
        return entry?.kind === "atlas" && entry.requiredFrames.includes(frameId) && hasLoadedBundle(entry.bundleId);
      },
    };
  }

  private resolveMapForField(mapId: string): ConstructorParameters<typeof ExplorationScene>[0]["map"] {
    if (!this.content) throw new Error("FIELD_HUD_CONTENT_INVALID:content");
    const result = this.content.getMap(mapId as never);
    if (!result.ok || result.value.id !== mapId) throw new Error(`PIXEL_FIELD_MAP_INVALID:${mapId}`);
    const tilesetAssetId = MAP_TILESET_ASSET_IDS[mapId];
    if (!tilesetAssetId) throw new Error(`PIXEL_FIELD_MAP_UNSUPPORTED:${mapId}`);
    const entry = floors06To10AssetManifest.assets.find((candidate) => candidate.id === tilesetAssetId);
    if (!entry || entry.kind !== "mapTileset") throw new Error(`PIXEL_FIELD_TILESET_ENTRY_INVALID:${tilesetAssetId}`);
    if (entry.bundleId !== result.value.assetBundleId) throw new Error(`PIXEL_FIELD_TILESET_OWNER_MISMATCH:${mapId}/${tilesetAssetId}`);
    return result.value as unknown as ConstructorParameters<typeof ExplorationScene>[0]["map"];
  }

  private requireLocalized(key: string, path: string): string {
    const value = Object.prototype.hasOwnProperty.call(zhCN, key) ? zhCN[key] : undefined;
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`FIELD_HUD_CONTENT_INVALID:${path}`);
    return value;
  }

  /** NPC/商店错误只投影已有中文文案，不把 DomainError code 当作可见文案。 */
  private localizedDomainError(error: DomainErrorV1): string {
    const key = `error.${error.code}`;
    return Object.prototype.hasOwnProperty.call(zhCN, key)
      ? this.requireLocalized(key, key)
      : this.requireLocalized("error.INVALID_CONTENT", "error.INVALID_CONTENT");
  }

  private requireCharacterFieldSprite(characterId: string, path: string): string {
    const result = this.content?.getCharacter(characterId);
    if (!result?.ok || result.value.id !== characterId || result.value.fieldSpriteId.trim().length === 0) throw new Error(`PIXEL_FIELD_CHARACTER_INVALID:${path}/${characterId}`);
    return result.value.fieldSpriteId;
  }

  private requireEncounterFieldSprite(encounterId: string): string {
    const result = this.content?.getEncounter(encounterId);
    if (!result?.ok || result.value.id !== encounterId || result.value.fieldSpriteId.trim().length === 0) throw new Error(`PIXEL_FIELD_ENCOUNTER_INVALID:${encounterId}`);
    return result.value.fieldSpriteId;
  }

  private requireNpcPresentation(npcId: string): Readonly<{ spriteId: string; displayName: string }> {
    const result = this.content?.getNpc(npcId);
    if (!result?.ok || result.value.id !== npcId || result.value.spriteId.trim().length === 0) throw new Error(`PIXEL_FIELD_NPC_INVALID:${npcId}`);
    return Object.freeze({ spriteId: result.value.spriteId, displayName: this.requireLocalized(result.value.nameKey, `npcs.${npcId}.nameKey`) });
  }

  private buildFieldHudStatus(sceneKind: "town" | "exploration", mapId: string): Readonly<FieldHudStatus> {
    const save = this.saveValue;
    if (!save || !this.content) throw new Error("FIELD_HUD_CONTENT_INVALID:save");
    const cached = this.fieldHudCache;
    if (cached
      && cached.revision === save.revision
      && cached.sceneKind === sceneKind
      && cached.mapId === mapId) {
      return cached.status;
    }
    const map = this.resolveMapForField(mapId);
    const mapDisplayName = this.requireLocalized(map.nameKey, `maps.${mapId}.nameKey`);
    const equipmentContent = this.managementEquipmentContent();
    if (!equipmentContent) throw new Error("FIELD_HUD_CONTENT_INVALID:equipment");
    const slots = [0, 1, 2, 3].map((slot) => {
      const characterId = save.party.slots[slot] ?? null;
      if (characterId === null) return Object.freeze({ slot: slot as 0 | 1 | 2 | 3, member: null });
      const progress = save.characters[characterId];
      if (!progress || progress.characterId !== characterId || progress.recruited !== true) throw new Error(`FIELD_HUD_CONTENT_INVALID:party.slots.${slot}`);
      const character = this.content!.getCharacter(characterId);
      if (!character.ok || character.value.id !== characterId) throw new Error(`FIELD_HUD_CONTENT_INVALID:characters.${characterId}`);
      const displayName = this.requireLocalized(character.value.nameKey, `characters.${characterId}.nameKey`);
      const maxHp = calculateStaticMaxHp(equipmentContent, save, characterId);
      if (!maxHp.ok || !Number.isSafeInteger(maxHp.value) || maxHp.value < 1) throw new Error(`FIELD_HUD_CONTENT_INVALID:characters.${characterId}.maxHp`);
      if (!Number.isSafeInteger(progress.currentHp) || progress.currentHp < 0 || progress.currentHp > maxHp.value) throw new Error(`FIELD_HUD_CONTENT_INVALID:characters.${characterId}.currentHp`);
      return Object.freeze({
        slot: slot as 0 | 1 | 2 | 3,
        member: Object.freeze({ characterId, displayName, currentHp: progress.currentHp, maxHp: maxHp.value }),
      });
    }) as [FieldHudStatus["partySlots"][0], FieldHudStatus["partySlots"][1], FieldHudStatus["partySlots"][2], FieldHudStatus["partySlots"][3]];
    const status = Object.freeze({ sceneKind, mapId, mapDisplayName, partySlots: Object.freeze(slots) });
    this.fieldHudCache = { revision: save.revision, sceneKind, mapId, status };
    return status;
  }

  private townLeaseErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.length > 0 ? error.message : "PIXEL_TOWN_LEASE_RELEASE_FAILED";
  }

  private async flushTownLeaseCleanup(generation: number): Promise<void> {
    for (const lease of [...this.townLeaseCleanup]) {
      if (this.destroyed || generation !== this.lifecycleGeneration) return;
      try {
        await lease.release();
        this.townLeaseCleanup.delete(lease);
      } catch (error) {
        this.townLeaseDiagnostic = this.townLeaseErrorMessage(error);
      }
    }
    if (this.townLeaseCleanup.size === 0) this.townLeaseDiagnostic = null;
  }

  private async destroyRouterForStaleRoute(): Promise<void> {
    const destroy = this.router?.destroy;
    if (!destroy) return;
    try {
      await destroy.call(this.router);
    } catch {
      // route 已失效时保留 GAME_FLOW_DESTROYED，清理失败交给路由自身诊断。
    }
  }

  private async releaseTownLease(lease: AssetLease): Promise<void> {
    try {
      await lease.release();
    } catch (error) {
      this.townLeaseCleanup.add(lease);
      this.townLeaseDiagnostic = this.townLeaseErrorMessage(error);
    }
  }

  private resources(): import("../scenes/exploration/ExplorationScene").ExplorationSceneResources {
    const manifestAssets = new Map(floors06To10AssetManifest.assets.map((asset) => [asset.id, asset]));
    // Scene 在 detached prepare 阶段才 acquire floor bundle；每次读取都查询最新
    // lease 快照，不能在 createScene 时捕获仅包含 boot/core_ui 的旧集合。
    const hasLoadedBundle = (bundleId: string): boolean => new Set(this.assetService?.getLoadedBundleIds() ?? []).has(bundleId);
    return {
      hasBundle: hasLoadedBundle,
      hasAsset: (assetId) => { const asset = manifestAssets.get(assetId); return asset !== undefined && hasLoadedBundle(asset.bundleId); },
      hasFieldSprite: (assetId) => { const asset = manifestAssets.get(assetId); return asset?.kind === "fieldActorSheet" && hasLoadedBundle(asset.bundleId); },
      hasCoreFrame: (frameId) => {
        const atlas = manifestAssets.get("atlas_core_ui");
        return atlas?.kind === "atlas"
          && atlas.requiredFrames.includes(frameId)
          && hasLoadedBundle(atlas.bundleId);
      },
    };
  }

  /** 将所有按住的方向合成为一个移动轴，InputState 会继续负责最终归一化。 */
  private updateHeldMoveInput(): void {
    let x = 0;
    let y = 0;
    for (const direction of this.heldMovePointers.values()) {
      x += direction.x;
      y += direction.y;
    }
    this.input.inputState.setMove(x, y);
  }

  /** 释放应用层持有的指针并清零移动，避免 DOM 重绘或路由切换造成粘滞。 */
  private resetHeldMoveInput(): void {
    if (this.heldMovePointers.size === 0) return;
    for (const pointerId of this.heldMovePointers.keys()) this.input.inputState.releasePointer(pointerId);
    this.heldMovePointers.clear();
    this.input.inputState.setMove(0, 0);
  }

  private handleMovePointerDown(button: HTMLButtonElement, direction: Vector2, event: PointerEvent): void {
    if (this.destroyed || this.stateValue !== "exploration") return;
    if (!this.input.inputState.claimPointer(event.pointerId)) return;
    this.heldMovePointers.set(event.pointerId, direction);
    this.updateHeldMoveInput();
    event.preventDefault();
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // 某些浏览器在 pointerdown 已结束的边界时拒绝捕获；pointerup/cancel 仍会清理状态。
    }
  }

  private handleMovePointerRelease(event: PointerEvent): void {
    if (!this.heldMovePointers.has(event.pointerId)) return;
    this.heldMovePointers.delete(event.pointerId);
    this.input.inputState.releasePointer(event.pointerId);
    this.updateHeldMoveInput();
    event.preventDefault();
  }

  private bindMoveButton(button: HTMLButtonElement, direction: Vector2): void {
    const pointerDown = (event: PointerEvent): void => this.handleMovePointerDown(button, direction, event);
    const pointerRelease = (event: PointerEvent): void => this.handleMovePointerRelease(event);
    button.addEventListener("pointerdown", pointerDown);
    button.addEventListener("pointerup", pointerRelease);
    button.addEventListener("pointercancel", pointerRelease);
    button.addEventListener("lostpointercapture", pointerRelease);
    this.uiUnbinds.push(() => {
      button.removeEventListener("pointerdown", pointerDown);
      button.removeEventListener("pointerup", pointerRelease);
      button.removeEventListener("pointercancel", pointerRelease);
      button.removeEventListener("lostpointercapture", pointerRelease);
    });
  }

  /** 创建移动端方向键；按钮只写入输入层，不直接修改探索领域状态。 */
  private appendExplorationMoveControls(documentValue: Document, ui: HTMLElement): void {
    const movement = documentValue.createElement("div");
    movement.dataset.testid = "exploration-movement";
    const directions: readonly { testId: string; label: string; direction: Vector2 }[] = [
      { testId: "move-up", label: "上", direction: { x: 0, y: -1 } },
      { testId: "move-down", label: "下", direction: { x: 0, y: 1 } },
      { testId: "move-left", label: "左", direction: { x: -1, y: 0 } },
      { testId: "move-right", label: "右", direction: { x: 1, y: 0 } },
    ];
    for (const { testId, label, direction } of directions) {
      const button = documentValue.createElement("button");
      button.type = "button";
      button.dataset.testid = testId;
      button.dataset.explorationMove = "true";
      button.textContent = label;
      this.bindMoveButton(button, direction);
      movement.appendChild(button);
    }
    ui.appendChild(movement);
  }

  private updateExplorationPositionHud(): void {
    if (!this.explorationPositionHud) return;
    const position = this.explorationScene?.state.playerPosition;
    this.explorationPositionHud.textContent = position
      ? `探索坐标：(${Math.round(position.x)}, ${Math.round(position.y)})`
      : "探索坐标：(--, --)";
  }

  /** 结束自动寻怪 resolver，并统一清理输入，避免路由/销毁留下悬空移动。 */
  private finishAutoEncounterSession(result: DomainResult<BattleSnapshotV1>): void {
    const session = this.autoEncounterSession;
    if (!session) return;
    this.autoEncounterSession = null;
    this.autoMoving = false;
    this.autoTarget = null;
    this.autoPath = [];
    this.resetHeldMoveInput();
    session.resolve(result);
  }

  private failAutoEncounterSession(): void {
    const session = this.autoEncounterSession;
    if (!session) return;
    const actor = this.explorationScene?.actorViews.find((candidate) => candidate.objectId === session.targetObjectId);
    this.autoEncounterFailureDiagnostics = {
      targetObjectId: session.targetObjectId,
      steps: session.steps,
      maxSteps: session.maxSteps,
      playerPosition: this.explorationScene ? { ...this.explorationScene.state.playerPosition } : null,
      actorPosition: actor ? { ...actor.position } : null,
      waypoint: this.autoTarget ? { ...this.autoTarget } : null,
      pathRemaining: this.autoPath.length,
      lastTargetPosition: session.lastTargetPosition ? { ...session.lastTargetPosition } : null,
      phase: this.explorationScene?.state.phase ?? null,
      inputEnabled: this.input.isEnabled,
      commandedMove: { ...session.commandedMove },
      playerBeforeFixed: session.playerBeforeFixed ? { ...session.playerBeforeFixed } : null,
      playerAfterFixed: session.playerAfterFixed ? { ...session.playerAfterFixed } : null,
      stalledSteps: session.stalledSteps,
    };
    this.finishAutoEncounterSession(failure(createDomainError("INVALID_TARGET", {
      reason: "UNKNOWN",
      targetUnitId: session.targetObjectId,
    })));
  }

  /** 每次重规划只读取当前 ActorView 坐标，不把对象命名或旧坐标写入路径。 */
  private replanAutoEncounter(session: AutoEncounterSession): boolean {
    if (!this.explorationScene) return false;
    const actor = this.explorationScene.actorViews.find((candidate) => candidate.objectId === session.targetObjectId);
    if (!actor) return false;
    const path = findAutoPath(session.map, this.explorationScene.state.playerPosition, actor.position);
    if (!path) return false;
    const requiredSteps = autoRouteRequiredSteps(this.explorationScene.state.playerPosition, path);
    if (requiredSteps > 0) {
      session.maxSteps = Math.max(
        session.maxSteps,
        Math.min(HARD_MAX_AUTO_STEPS, session.steps + requiredSteps + AUTO_ROUTE_MARGIN_STEPS),
      );
    }
    this.autoPath = [...path];
    this.autoTarget = this.autoPath.shift() ?? { ...actor.position };
    session.lastTargetPosition = { ...actor.position };
    session.nextReplanStep = session.steps + 32;
    return true;
  }

  /** 单个 fixed tick 推进自动会话；不在点击事件里递归调用 fixedUpdate。 */
  private advanceAutoEncounterTick(): boolean {
    const session = this.autoEncounterSession;
    if (!session || !this.explorationScene) return true;
    session.steps += 1;
    if (session.steps > session.maxSteps || session.stalledSteps >= AUTO_STALL_STEPS) {
      this.failAutoEncounterSession();
      return false;
    }
    const actor = this.explorationScene.actorViews.find((candidate) => candidate.objectId === session.targetObjectId);
    if (!actor) {
      this.failAutoEncounterSession();
      return false;
    }
    const targetMoved = session.lastTargetPosition !== null
      && Math.hypot(actor.position.x - session.lastTargetPosition.x, actor.position.y - session.lastTargetPosition.y) > 24;
    if (this.autoTarget === null || session.steps >= session.nextReplanStep || targetMoved) {
      if (!this.replanAutoEncounter(session)) {
        this.failAutoEncounterSession();
        return false;
      }
    }

    let position = this.explorationScene.state.playerPosition;
    let distance = this.autoTarget ? Math.hypot(this.autoTarget.x - position.x, this.autoTarget.y - position.y) : 0;
    // 每个 fixed tick 最多消费一个已到达 waypoint；不能在同一 tick 跨过多个非零节点，
    // 否则亚像素位置会在拐角前切换成下一段碰撞路径。
    if (this.autoTarget && distance <= AUTO_WAYPOINT_EPSILON && this.autoPath.length > 0) {
      this.autoTarget = this.autoPath.shift() ?? null;
      position = this.explorationScene.state.playerPosition;
      distance = this.autoTarget ? Math.hypot(this.autoTarget.x - position.x, this.autoTarget.y - position.y) : 0;
    }
    let commandedMove: Vector2 = { x: 0, y: 0 };
    if (this.autoTarget) {
      const dx = this.autoTarget.x - position.x;
      const dy = this.autoTarget.y - position.y;
      if (distance <= AUTO_WAYPOINT_EPSILON) {
        this.input.inputState.setMove(0, 0);
      } else if (distance <= PLAYER_SPEED_PER_STEP) {
        // InputState 对长度不超过 1 的向量保留比例；按固定步速度反推，
        // 让 MovementSystem 下一步精确落在 waypoint，而不是提前切换拐角。
        commandedMove = { x: dx / PLAYER_SPEED_PER_STEP, y: dy / PLAYER_SPEED_PER_STEP };
        this.input.inputState.setMove(commandedMove.x, commandedMove.y);
      } else {
        this.input.inputState.setMove(dx, dy);
        commandedMove = { x: dx, y: dy };
      }
    } else {
      this.input.inputState.setMove(0, 0);
    }
    session.commandedMove = commandedMove;
    return true;
  }

  private fixedUpdateStep(): void {
    if (this.townScene && this.stateValue === "town") {
      // 城镇与探索共用同一个 GameApp fixed ticker；场景自己只消费一次 snapshot。
      this.townScene.fixedUpdate();
      return;
    }
    if (!this.explorationScene || this.stateValue !== "exploration") {
      // 战斗转场仍在 encounterInFlight 时，等待它把成功结果交给 resolver；
      // 其它离开探索的路径则立即结束自动会话。
      if (this.autoEncounterSession && this.encounterInFlight === null) this.failAutoEncounterSession();
      return;
    }
    const sessionBeforeFixed = this.autoMoving ? this.autoEncounterSession : null;
    const playerBeforeFixed = sessionBeforeFixed ? { ...this.explorationScene.state.playerPosition } : null;
    if (this.autoMoving && !this.advanceAutoEncounterTick()) return;
    const contact = this.explorationScene.fixedUpdate();
    const sessionAfterFixed = this.autoEncounterSession;
    if (sessionBeforeFixed && sessionAfterFixed === sessionBeforeFixed && playerBeforeFixed !== null) {
      const playerAfterFixed = { ...this.explorationScene.state.playerPosition };
      sessionAfterFixed.playerBeforeFixed = playerBeforeFixed;
      sessionAfterFixed.playerAfterFixed = playerAfterFixed;
      const commandedLength = Math.hypot(sessionAfterFixed.commandedMove.x, sessionAfterFixed.commandedMove.y);
      const movedDistance = Math.hypot(
        playerAfterFixed.x - playerBeforeFixed.x,
        playerAfterFixed.y - playerBeforeFixed.y,
      );
      sessionAfterFixed.stalledSteps = commandedLength > AUTO_WAYPOINT_EPSILON && movedDistance <= AUTO_WAYPOINT_EPSILON
        ? sessionAfterFixed.stalledSteps + 1
        : 0;
    }
    this.updateExplorationPositionHud();
    const pending = contact ?? this.pendingContact;
    if (pending && this.pendingContact === null) this.pendingContact = pending;
    if (this.pendingContact && this.encounterInFlight === null) {
      const contactValue = this.pendingContact;
      this.pendingContact = null;
      this.encounterInFlight = this.handleEncounterContact(contactValue)
        .then((result) => {
          const session = this.autoEncounterSession;
          if (!session) return;
          if (result?.ok) {
            this.finishAutoEncounterSession(success(result.value));
          } else if (result) {
            this.finishAutoEncounterSession(result);
          } else if (this.saveValue?.battle) {
            this.finishAutoEncounterSession(success(this.saveValue.battle));
          } else {
            this.failAutoEncounterSession();
          }
        })
        .catch(() => {
          if (this.autoEncounterSession) this.finishAutoEncounterSession(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
        })
        .finally(() => {
          this.encounterInFlight = null;
        });
    }
  }

  private async releaseBattleLease(): Promise<void> {
    const lease = this.battleLease;
    this.battleLease = null;
    const floorLease = this.battleFloorLease;
    this.battleFloorLease = null;
    await this.releaseAssetLease(lease);
    await this.releaseAssetLease(floorLease);
  }

  private async releaseAssetLease(lease: AssetLease | null): Promise<void> {
    await lease?.release().catch(() => undefined);
  }

  private setStartupPlaceholderHidden(hidden: boolean): void {
    const documentValue = this.options.document
      ?? this.options.gameRoot?.ownerDocument
      ?? (typeof document === "undefined" ? null : document);
    const placeholder = documentValue?.querySelector<HTMLElement>("#startup-placeholder");
    if (placeholder) placeholder.hidden = hidden;
  }

  private mountUi(): void {
    const documentValue = this.options.document ?? this.options.gameRoot?.ownerDocument ?? (typeof document === "undefined" ? null : document);
    const root = this.options.gameRoot ?? documentValue?.querySelector<HTMLElement>("#game-root");
    if (!documentValue || !root) return;
    const ui = documentValue.createElement("div");
    ui.id = "game-flow-ui";
    ui.className = "semantic-ui";
    ui.setAttribute("aria-live", "polite");
    root.appendChild(ui);
    this.flowUi = ui;
    this.applySemanticInputGate(ui);
    this.applySemanticViewportLayout();
    this.renderUi();
  }

  private applySemanticInputGate(ui: HTMLElement): void {
    const enabled = this.runtime?.isInputEnabled ?? true;
    const semanticRoot = ui as HTMLElement & { inert?: boolean };
    semanticRoot.inert = !enabled;
    ui.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  /** 语义根与 contain 后的 canvas 共享 CSS 原点和尺寸，子按钮只使用逻辑坐标。 */
  private applySemanticViewportLayout(): void {
    const ui = this.flowUi;
    if (!ui || !ui.style) return;
    const viewport = this.viewportValue;
    ui.style.left = `${viewport.offsetX}px`;
    ui.style.top = `${viewport.offsetY}px`;
    ui.style.width = `${viewport.cssWidth}px`;
    ui.style.height = `${viewport.cssHeight}px`;
    ui.style.right = "auto";
    ui.style.bottom = "auto";
  }

  /** 按 contain 后的 canvas 原点与逻辑矩形更新标题语义命中区，不重建业务状态。 */
  private applyTitleSemanticLayout(): void {
    if (this.stateValue !== "title") return;
    const documentValue = this.options.document
      ?? this.options.gameRoot?.ownerDocument
      ?? (typeof document === "undefined" ? null : document);
    if (!documentValue) return;

    const viewport = this.viewportValue;
    const layout = layoutTitleButtons(viewport.safeRect);
    const apply = (testId: "continue" | "new-game", rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): void => {
      const button = documentValue.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!button || !button.style) return;
      const rawWidth = rect.width * viewport.scale;
      const rawHeight = rect.height * viewport.scale;
      const width = Math.max(48, rawWidth);
      const height = Math.max(48, rawHeight);
      const centerX = viewport.offsetX + (rect.x + rect.width / 2) * viewport.scale;
      const centerY = viewport.offsetY + (rect.y + rect.height / 2) * viewport.scale;
      button.style.left = `${width === rawWidth ? rect.x * viewport.scale : centerX - viewport.offsetX - width / 2}px`;
      button.style.top = `${height === rawHeight ? rect.y * viewport.scale : centerY - viewport.offsetY - height / 2}px`;
      button.style.width = `${width}px`;
      button.style.height = `${height}px`;
    };
    apply("continue", layout.continue);
    apply("new-game", layout.newGame);
  }

  /** 管理页先用 DOM 投影承载真实存档摘要，后续 screen adapter 可覆盖导航。 */
  private async updateSettings(mutator: (settings: GameSaveV1["settings"]) => void): Promise<void> {
    if (!this.saveValue) return;
    const next = clone(this.saveValue) as GameSaveV1;
    mutator(next.settings);
    const committed = await this.commitSave("transaction", next);
    if (committed.ok) this.renderUi();
  }

  private resetNpcPanelSession(): void {
    // 每次重新打开 NPC 都建立新的面板会话；旧购买 Promise 完成后不得污染新面板。
    this.merchantPanelOpen = false;
    this.merchantPanelToken += 1;
    this.merchantBuyInFlight = null;
    this.merchantBuyOfferId = null;
    this.merchantError = null;
    this.townModalResolution = null;
    this.townModalPageIndex = 0;
    this.townModalSelectedFloorId = null;
    this.townModalError = null;
    this.townModalToken += 1;
    this.npcResolutionApplied = false;
  }

  private async handleNpc(npcId: string): Promise<void> {
    this.resetNpcPanelSession();
    const result = await this.townScene?.interactNpc(npcId);
    if (!result?.ok) {
      this.npcRouteMessage = "该 NPC 当前未解锁或不可用";
      this.renderUi();
      return;
    }
    // 生产 TownScene 会通过 onNpcRoute 把同一份已解析结果交给这里；
    // legacy fake 只返回 DomainResult，因此保留一次直接 apply 的兼容路径。
    if (!this.npcResolutionApplied) await this.applyNpcResolution(result.value);
  }

  private async handleWorldNpcResolution(resolution: import("../domain/town/NpcService").NpcResolution): Promise<void> {
    this.resetNpcPanelSession();
    this.npcResolutionApplied = true;
    await this.applyNpcResolution(resolution);
  }

  private async handleWorldNpcError(npcId: string, error: DomainErrorV1): Promise<void> {
    this.townModalResolution = null;
    this.townModalPageIndex = 0;
    this.townModalSelectedFloorId = null;
    this.townModalError = this.localizedDomainError(error);
    this.npcRouteMessage = this.localizedDomainError(error);
    this.renderTownLockedNpcModal(npcId, error);
    this.renderUi();
  }

  private townModalAction(
    testId: string,
    label: string,
    command: TownModalCommand,
    enabled = true,
    disabledReasonText: string | null = null,
  ) {
    return { testId, ariaLabel: label, label, command, enabled, disabledReasonText } as const;
  }

  private townDialogueText(resolution: import("../domain/town/NpcService").NpcResolution): string {
    const dialogue = this.content?.getRoot().dialogues.find((candidate) => candidate.id === resolution.route.dialogueId);
    const page = dialogue?.pages[0];
    if (!page) throw new Error(`TOWN_MODAL_DIALOGUE_MISSING:${resolution.route.dialogueId}`);
    return this.requireLocalized(page.textKey, `dialogues.${resolution.route.dialogueId}.textKey`);
  }

  private townNpcTitle(resolution: import("../domain/town/NpcService").NpcResolution): string {
    return this.requireLocalized(resolution.npc.nameKey, `npcs.${resolution.npc.id}.nameKey`);
  }

  private projectTownOffer(offer: GameSaveV1["shop"]["offers"][number]): import("../ui/rendering/TownModalRenderer").TownModalOffer {
    if (!this.content) throw new Error("TOWN_MODAL_CONTENT_MISSING");
    let nameKey: string;
    if (offer.kind === "stackableItem") {
      const result = this.content.getItem(offer.itemId);
      if (!result.ok || result.value.id !== offer.itemId) throw new Error(`TOWN_MODAL_ITEM_MISSING:${offer.itemId}`);
      nameKey = result.value.nameKey;
    } else if (offer.kind === "equipment") {
      const result = this.content.getEquipmentBase(offer.equipment.baseId);
      if (!result.ok || result.value.id !== offer.equipment.baseId) throw new Error(`TOWN_MODAL_EQUIPMENT_MISSING:${offer.equipment.baseId}`);
      nameKey = result.value.nameKey;
    } else {
      const result = this.content.getCharacter(offer.skillStone.attunedCharacterId);
      if (!result.ok || result.value.id !== offer.skillStone.attunedCharacterId) throw new Error(`TOWN_MODAL_CHARACTER_MISSING:${offer.skillStone.attunedCharacterId}`);
      nameKey = result.value.nameKey;
    }
    return Object.freeze({
      offerId: offer.offerId,
      name: this.requireLocalized(nameKey, `shop.offers.${offer.offerId}.nameKey`),
      priceText: `${offer.goldPrice} 金币`,
      sold: offer.sold,
      enabled: !offer.sold && Boolean(this.saveValue && this.saveValue.gold >= offer.goldPrice),
      disabledReasonText: offer.sold
        ? this.requireLocalized("shop.sold", "shop.sold")
        : this.saveValue && this.saveValue.gold < offer.goldPrice
          ? this.requireLocalized("error.INSUFFICIENT_GOLD", "error.INSUFFICIENT_GOLD")
            .replace("{required}", String(offer.goldPrice))
            .replace("{owned}", String(this.saveValue.gold))
          : null,
    });
  }

  private renderTownNpcModal(): void {
    const renderer = this.townModalRenderer;
    const resolution = this.townModalResolution;
    if (!renderer || !resolution) return;
    const close = this.townModalAction("town-modal-close", this.requireLocalized("common.close", "common.close"), { kind: "close" }, !(this.merchantBuyInFlight || this.townRestInFlight));
    const actions = [close];
    if (resolution.route.function === "inn") {
      actions.unshift(this.townModalAction("town-modal-rest", this.requireLocalized("town.rest", "town.rest"), { kind: "rest" }, this.townRestInFlight === null, this.townRestInFlight ? "正在休整" : null));
    }
    if (resolution.route.function === "cartographer") {
      actions.unshift(this.townModalAction("town-modal-open-floor-select", this.requireLocalized("town.start_expedition", "town.start_expedition"), { kind: "openFloorSelect" }, true));
    }
    const root = this.content?.getRoot();
    const base = {
      title: this.townNpcTitle(resolution),
      body: this.townDialogueText(resolution),
      statusText: this.npcRouteMessage,
      errorText: this.townModalError,
      busy: this.merchantBuyInFlight !== null || this.townRestInFlight !== null,
      actions,
    } as const;
    if (resolution.route.function === "merchant") {
      const offers = (this.saveValue?.shop.offers ?? []).map((offer) => this.projectTownOffer(offer));
      const pageSize = getTownModalPageSize(this.viewportValue);
      const pageCount = Math.max(1, Math.ceil(offers.length / pageSize));
      this.townModalPageIndex = Math.min(Math.max(0, this.townModalPageIndex), pageCount - 1);
      if (this.townModalPageIndex > 0) actions.push(this.townModalAction("town-modal-merchant-prev", "上一页", { kind: "changePage", panel: "merchant", pageIndex: this.townModalPageIndex - 1 }));
      if (this.townModalPageIndex < pageCount - 1) actions.push(this.townModalAction("town-modal-merchant-next", "下一页", { kind: "changePage", panel: "merchant", pageIndex: this.townModalPageIndex + 1 }));
      renderer.render({ ...base, kind: "merchant", gold: this.saveValue?.gold ?? 0, offers, busyOfferId: this.merchantBuyOfferId, pageIndex: this.townModalPageIndex, pageCount });
      return;
    }
    if (resolution.route.function === "abyssWatcher") {
      const echoText = `可用回响 ${this.saveValue?.world.echoCharges ?? 0} 次`;
      renderer.render({ ...base, body: `${base.body}\n${echoText}`, kind: "npc" });
      return;
    }
    renderer.render({ ...base, kind: "npc" });
    void root;
  }

  private renderTownLockedNpcModal(npcId: string, error: DomainErrorV1): void {
    const renderer = this.townModalRenderer;
    const npc = this.content?.getNpc(npcId);
    if (!renderer || !npc?.ok || npc.value.id !== npcId) return;
    const details = error.details;
    const reasonKey = details && "lockReasonKey" in details && typeof details.lockReasonKey === "string" ? details.lockReasonKey : npc.value.lockReasonKey;
    const title = this.requireLocalized(npc.value.nameKey, `npcs.${npcId}.nameKey`);
    const reason = this.requireLocalized(reasonKey, `npcs.${npcId}.lockReasonKey`);
    renderer.render({
      kind: "npc",
      title,
      body: reason,
      statusText: null,
      errorText: this.townModalError,
      busy: false,
      actions: [this.townModalAction("town-modal-close", this.requireLocalized("common.close", "common.close"), { kind: "close" })],
    });
  }

  private renderTownFloorModal(): void {
    const renderer = this.townModalRenderer;
    const root = this.content?.getRoot();
    if (!renderer || !root) return;
    const entries = buildFloorEntries(root.floors as unknown as Parameters<typeof buildFloorEntries>[0], this.saveValue?.world ?? {
      highestUnlockedFloor: 0, clearedBossEncounterIds: [], bossRetryUnlockedFloorIds: [], completedQuestIds: [], discoveredComboIds: [], discoveredEnemyIds: [], echoCharges: 0, echoAttemptSequence: 0, clearedEchoIds: [], storyCompleted: false,
    }).map((entry) => Object.freeze({
      floorId: entry.floor.id,
      title: this.requireLocalized(entry.floor.nameKey, `floors.${entry.floor.id}.nameKey`),
      subtitle: `第${entry.floor.floorNumber}层`,
      locked: entry.locked,
      modes: entry.modes.map((mode) => Object.freeze({
        mode,
        label: mode === "exploration" ? this.requireLocalized("floor.enter_full", "floor.enter_full") : mode === "shortFarm" ? this.requireLocalized("floor.enter_short", "floor.enter_short") : this.requireLocalized("floor.enter_boss_retry", "floor.enter_boss_retry"),
        enabled: true,
        disabledReasonText: null,
      })),
    })) as readonly TownModalFloorEntry[];
    const pageSize = getTownModalPageSize(this.viewportValue);
    const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
    this.townModalPageIndex = Math.min(Math.max(0, this.townModalPageIndex), pageCount - 1);
    const actions = [this.townModalAction("town-modal-close", this.requireLocalized("common.close", "common.close"), { kind: "close" })];
    if (this.townModalPageIndex > 0) actions.push(this.townModalAction("town-modal-floor-prev", "上一页", { kind: "changePage", panel: "floorSelect", pageIndex: this.townModalPageIndex - 1 }));
    if (this.townModalPageIndex < pageCount - 1) actions.push(this.townModalAction("town-modal-floor-next", "下一页", { kind: "changePage", panel: "floorSelect", pageIndex: this.townModalPageIndex + 1 }));
    renderer.render({
      kind: "floorSelect",
      title: this.requireLocalized("town.start_expedition", "town.start_expedition"),
      body: "选择目标楼层与远征模式。",
      statusText: this.npcRouteMessage,
      errorText: this.townModalError,
      busy: this.townFloorDepartureInFlight !== null,
      entries,
      selectedFloorId: this.townModalSelectedFloorId,
      pageIndex: this.townModalPageIndex,
      pageCount,
      actions,
    });
    this.renderUi();
  }

  private handleTownPanelStateChange(kind: "dialogue" | "floorSelect" | null): void {
    if (kind === null) {
      this.townModalToken += 1;
      this.townModalResolution = null;
      this.townModalSelectedFloorId = null;
      this.townModalError = null;
      this.townModalRenderer?.render({ kind: "closed", title: "", body: "", statusText: null, errorText: null, busy: false, actions: [] });
      this.renderUi();
    } else if (kind === "floorSelect") {
      this.renderTownFloorModal();
    }
  }

  /** 只接受当前 TownScene panel/session 产生的命令；DOM 旧节点与跨面板命令直接丢弃。 */
  private isCurrentTownModalCommand(command: TownModalCommand): boolean {
    const scene = this.townScene;
    const resolution = this.townModalResolution;
    if (!scene) return false;
    if (command.kind === "close") return scene.activePanelKind !== null;
    if (command.kind === "openFloorSelect") return scene.activePanelKind === "dialogue" && resolution?.route.function === "cartographer";
    if (command.kind === "rest") return scene.activePanelKind === "dialogue" && resolution?.route.function === "inn" && this.townRestInFlight === null;
    if (command.kind === "buyOffer") {
      if (scene.activePanelKind !== "dialogue" || resolution?.route.function !== "merchant" || this.merchantBuyInFlight !== null) return false;
      const offers = this.saveValue?.shop.offers ?? [];
      const pageSize = getTownModalPageSize(this.viewportValue);
      const visibleStart = Math.max(0, this.townModalPageIndex) * pageSize;
      const offer = offers.slice(visibleStart, visibleStart + pageSize).find((candidate) => candidate.offerId === command.offerId);
      return Boolean(offer && !offer.sold && (this.saveValue?.gold ?? 0) >= offer.goldPrice);
    }
    if (command.kind === "changePage") {
      if (command.panel === "merchant" && (scene.activePanelKind !== "dialogue" || resolution?.route.function !== "merchant")) return false;
      if (command.panel === "floorSelect" && scene.activePanelKind !== "floorSelect") return false;
      const count = command.panel === "merchant" ? this.saveValue?.shop.offers.length ?? 0 : this.content?.getRoot().floors.length ?? 0;
      const pageSize = getTownModalPageSize(this.viewportValue);
      const pageCount = Math.max(1, Math.ceil(count / pageSize));
      return Number.isInteger(command.pageIndex) && command.pageIndex >= 0 && command.pageIndex < pageCount;
    }
    if (command.kind === "selectFloor") {
      if (scene.activePanelKind !== "floorSelect") return false;
      const entries = this.content?.getRoot().floors ?? [];
      const pageSize = getTownModalPageSize(this.viewportValue);
      const visibleStart = Math.max(0, this.townModalPageIndex) * pageSize;
      const visible = entries.slice(visibleStart, visibleStart + pageSize);
      const entry = visible.find((candidate) => candidate.id === command.floorId);
      const world = this.saveValue?.world;
      return Boolean(entry && world && !buildFloorEntries([entry] as unknown as Parameters<typeof buildFloorEntries>[0], world)[0]?.locked);
    }
    if (command.kind === "enterFloor") {
      if (scene.activePanelKind !== "floorSelect" || this.townModalSelectedFloorId !== command.floorId) return false;
      const entries = this.content?.getRoot().floors ?? [];
      const pageSize = getTownModalPageSize(this.viewportValue);
      const visibleStart = Math.max(0, this.townModalPageIndex) * pageSize;
      const visible = entries.slice(visibleStart, visibleStart + pageSize);
      const entry = visible.find((candidate) => candidate.id === command.floorId);
      const world = this.saveValue?.world;
      const projected = entry && world ? buildFloorEntries([entry] as unknown as Parameters<typeof buildFloorEntries>[0], world)[0] : undefined;
      return Boolean(projected && !projected.locked && projected.modes.includes(command.mode as typeof projected.modes[number]));
    }
    return false;
  }

  private handleTownModalCommand(command: TownModalCommand): Promise<void> | void {
    if (!this.isCurrentTownModalCommand(command)) return;
    if (command.kind === "close") {
      this.closeNpcPanel();
      return;
    }
    if (command.kind === "openFloorSelect") {
      this.townScene?.openFloorSelectFromPanel();
      return;
    }
    if (command.kind === "selectFloor") {
      const entry = this.content?.getRoot().floors.find((candidate) => candidate.id === command.floorId);
      if (!entry) return;
      const world = this.saveValue?.world;
      if (!world || !buildFloorEntries([entry] as unknown as Parameters<typeof buildFloorEntries>[0], world)[0]?.modes.length) return;
      this.townModalSelectedFloorId = command.floorId;
      this.renderTownFloorModal();
      return;
    }
    if (command.kind === "changePage") {
      const max = command.panel === "merchant"
        ? Math.max(1, Math.ceil((this.saveValue?.shop.offers.length ?? 0) / getTownModalPageSize(this.viewportValue)))
        : Math.max(1, Math.ceil((this.content?.getRoot().floors.length ?? 0) / getTownModalPageSize(this.viewportValue)));
      if (command.pageIndex < 0 || command.pageIndex >= max) return;
      this.townModalPageIndex = command.pageIndex;
      if (command.panel === "merchant") { this.renderTownNpcModal(); this.renderUi(); }
      else this.renderTownFloorModal();
      return;
    }
    if (command.kind === "buyOffer") {
      void this.buyMerchantOffer(command.offerId);
      return;
    }
    if (command.kind === "rest") {
      if (this.townRestInFlight) return this.townRestInFlight.then(() => undefined);
      const token = this.townModalToken;
      const request = this.restAtInn()
        .then((result) => {
          if (token !== this.townModalToken) return result;
          this.townModalError = result.ok ? null : "暂时无法休整，请重试";
          this.npcRouteMessage = result.ok && result.value === this.saveValue ? this.requireLocalized("town.no_rest_needed", "town.no_rest_needed") : result.ok ? "队伍已恢复" : "旅店操作失败";
          this.renderTownNpcModal();
          this.renderUi();
          return result;
        })
        .catch(() => failure(createDomainError("SAVE_FAILED", { operation: "save" })) as DomainResult<GameSaveV1>)
        .finally(() => {
          if (this.townRestInFlight !== request) return;
          this.townRestInFlight = null;
          if (token === this.townModalToken && this.townModalResolution?.route.function === "inn") {
            this.renderTownNpcModal();
            this.renderUi();
          }
        });
      this.townRestInFlight = request;
      this.renderTownNpcModal();
      this.renderUi();
      return request.then(() => undefined);
    }
    const request = this.townScene?.departFromFloorPanel(command.floorId, command.mode);
    if (!request) return;
    const token = this.townModalToken;
    this.townFloorDepartureInFlight = request;
    void request.then((result) => {
      if (token !== this.townModalToken || result.ok) return;
      this.townModalError = "进入楼层失败，请重试";
      this.renderTownFloorModal();
    }).finally(() => {
      if (this.townFloorDepartureInFlight !== request) return;
      this.townFloorDepartureInFlight = null;
      if (token === this.townModalToken && this.townScene?.activePanelKind === "floorSelect") this.renderTownFloorModal();
    });
    this.renderTownFloorModal();
  }

  /** 城镇 field action 与语义管理按钮共用同一入口，外部页面失败只留下稳定诊断。 */
  private async routeManagementPage(route: "inventory" | "party" | "skill" | "combo" | "settings"): Promise<void> {
    if (this.stateValue !== "town" || this.saveValue?.expedition !== null || this.saveValue?.battle !== null) {
      this.setExplorationMessage("远征期间暂不可打开管理页");
      return;
    }
    try {
      await this.options.onManagementRoute?.(route);
    } catch {
      this.managementRouteDiagnostic = `MANAGEMENT_ROUTE_FAILED:${route}`;
      this.renderUi();
      return;
    }
    this.managementRouteDiagnostic = null;
    this.pendingFieldAction = null;
    this.managementPage = route;
    this.renderUi();
  }

  /** Pixi HUD 的菜单键打开可见管理中心，再由玩家选择具体系统。 */
  private openManagementHub(): void {
    if (this.stateValue !== "town" || this.saveValue?.expedition !== null || this.saveValue?.battle !== null) {
      this.setExplorationMessage("远征期间暂不可打开管理页");
      return;
    }
    this.managementRouteDiagnostic = null;
    this.pendingFieldAction = null;
    this.managementPage = "menu";
    this.renderUi();
  }

  private async applyNpcResolution(resolution: import("../domain/town/NpcService").NpcResolution): Promise<void> {
    this.townModalResolution = resolution;
    this.townModalPageIndex = 0;
    this.townModalSelectedFloorId = null;
    this.townModalError = null;
    switch (resolution.route.function) {
      case "tavern": this.npcRouteMessage = "酒馆：队伍与招募摘要"; break;
      case "blacksmith": this.npcRouteMessage = "铁匠：背包与装备入口"; break;
      case "skillMentor": this.npcRouteMessage = "技能导师：技能与铭石入口"; break;
      case "merchant":
        this.merchantPanelOpen = true;
        this.npcRouteMessage = "商人：商店购买";
        break;
      case "inn": this.npcRouteMessage = "旅店：点击免费休整"; break;
      case "cartographer": this.npcRouteMessage = "制图师：楼层入口"; break;
      case "abyssWatcher": {
        const root = this.content?.getRoot();
        const state = root && this.saveValue ? buildAbyssEchoState(this.saveValue.world, root.abyssEchoes) : null;
        this.npcRouteMessage = state?.kind === "success"
          ? `深渊观测者：可用回响 ${this.saveValue?.world.echoCharges ?? 0} 次`
          : `深渊观测者：${state?.kind ?? "状态不可用"}`;
        break;
      }
      default: this.npcRouteMessage = "NPC 功能未接入";
    }
    this.renderTownNpcModal();
    this.renderUi();
  }

  private async handleFieldAction(action: Exclude<FieldInputAction, "interact">): Promise<void> {
    if (action === "map") {
      // 大地图的目标页面尚未冻结，保留显式 pending 状态。
      this.pendingFieldAction = action;
      this.setExplorationMessage("地图面板待接入");
      return;
    }
    if (action === "menu") {
      this.openManagementHub();
      return;
    }
    await this.routeManagementPage(action);
  }

  /** 城镇重试 COMPLETE 清理；失败仍停留城镇，不切换全局 error。 */
  private async retryCompleteBattleCleanupFromTown(): Promise<DomainResult<GameSaveV1>> {
    if (!this.saveValue) return domainFailure("save");
    const cleaned = await this.cleanupRetainedExpeditionBattle(this.saveValue);
    this.terminalCleanupError = cleaned.ok ? null : cleaned.error.code;
    if (cleaned.ok) await this.resumeAfterBattleCleanup(cleaned.value);
    else this.setState("town");
    return cleaned;
  }

  private closeNpcPanel(): void {
    this.townScene?.closePanel();
    this.npcRouteMessage = null;
    this.merchantPanelOpen = false;
    this.merchantPanelToken += 1;
    this.merchantBuyInFlight = null;
    this.merchantBuyOfferId = null;
    this.merchantError = null;
    this.renderUi();
  }

  /** 管理页统一通过当前 Store revision 做一次显式 CAS，再进入主流程事务。 */
  private persistManagement(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    if (!this.store) return Promise.resolve(domainFailure("save"));
    const actualRevision = this.store.getSnapshot().revision;
    if (expectedRevision !== actualRevision) {
      return Promise.resolve(failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision })));
    }
    return this.commitSave("transaction", clone(nextSave)).then((committed) => {
      if (!committed.ok && committed.error.code === "SAVE_FAILED" && this.coordinator) {
        // 管理页失败不改变 Store；撤销失败候选后下一次点击可重新创建同一事务。
        const pending = this.coordinator.pendingCandidates.find((candidate) => (
          candidate.kind === "transaction" && candidate.expectedRevision === expectedRevision
        ));
        if (pending) this.coordinator.cancel(pending.candidateId);
      }
      return committed;
    });
  }

  private onManagementStoreReplaced(save: Readonly<GameSaveV1>): void {
    this.saveValue = clone(save) as GameSaveV1;
    this.renderUi();
  }

  private managementEquipmentContent(): EquipmentServiceContent | null {
    if (!this.content) return null;
    const root = this.content.getRoot();
    const bound = this.boundContent();
    return {
      equipmentBases: root.equipmentBases,
      equipmentAffixes: root.equipmentAffixes,
      economy: root.economy,
      characters: root.characters,
      skills: root.skills,
      skillAffixes: root.skillAffixes,
      getCharacter: bound.getCharacter,
      getSkill: bound.getSkill,
    } as unknown as EquipmentServiceContent;
  }

  private managementProgression(): ProgressionService | null {
    if (!this.content) return null;
    const bound = this.boundContent();
    return new ProgressionService({
      getCharacter: bound.getCharacter as unknown as (id: string) => DomainResult<Readonly<CharacterDefinition>>,
      getSkill: bound.getSkill as unknown as (id: string) => DomainResult<Readonly<SkillDefinition>>,
    });
  }

  /** 野外消耗品只复用明确的 ContentCatalog getter，不从其它页面状态猜测内容。 */
  private ensureFieldItemService(): FieldItemService | null {
    if (this.fieldItemService) return this.fieldItemService;
    if (!this.content) return null;
    const bound = this.boundContent();
    this.fieldItemService = new FieldItemService({
      getItem: bound.getItem,
      getCharacter: bound.getCharacter,
      getEquipmentBase: bound.getEquipmentBase,
      getEquipmentAffix: bound.getEquipmentAffix,
    } as unknown as ConstructorParameters<typeof FieldItemService>[0]);
    return this.fieldItemService;
  }

  /** 商店服务只读当前内容经济配置；服务实例随存档更换而重建。 */
  private ensureShopService(): ShopService | null {
    if (this.shopService) return this.shopService;
    if (!this.content) return null;
    this.shopService = new ShopService({ economy: this.content.getRoot().economy });
    return this.shopService;
  }

  private async executeMerchantBuy(offerId: string): Promise<DomainResult<GameSaveV1>> {
    if (!this.ensureReady() || !this.saveValue || this.stateValue !== "town"
      || this.saveValue.expedition !== null || this.saveValue.battle !== null) {
      return failure(createDomainError("NOT_IN_TOWN", null));
    }
    const service = this.ensureShopService();
    if (!service) return domainFailure("save");
    const bought = service.buy(this.saveValue, offerId);
    if (!bought.ok) return bought;
    return this.persistManagement(this.saveValue.revision, bought.value);
  }

  /** 购买按钮共享一次进行中的提交，失败保留面板并允许下一次重试。 */
  private buyMerchantOffer(offerId: string): Promise<DomainResult<GameSaveV1>> {
    if (this.merchantBuyInFlight) return this.merchantBuyInFlight;
    const panelToken = this.merchantPanelToken;
    const request = this.executeMerchantBuy(offerId)
      .then((result) => {
        if (this.merchantPanelOpen && this.merchantPanelToken === panelToken) {
          this.merchantError = result.ok ? null : result.error.code;
          this.townModalError = result.ok ? null : "购买失败，请重试";
          this.renderTownNpcModal();
          this.renderUi();
        }
        return result;
      })
      .catch(() => {
        const result: DomainResult<GameSaveV1> = failure(createDomainError("SAVE_FAILED", { operation: "save" }));
        if (this.merchantPanelOpen && this.merchantPanelToken === panelToken) {
          this.merchantError = result.error.code;
          this.townModalError = "购买失败，请重试";
          this.renderTownNpcModal();
          this.renderUi();
        }
        return result;
      })
      .finally(() => {
        if (this.merchantBuyInFlight === request) {
          this.merchantBuyInFlight = null;
          this.merchantBuyOfferId = null;
          if (this.merchantPanelOpen && this.merchantPanelToken === panelToken) {
            this.renderTownNpcModal();
            this.renderUi();
          }
        }
      });
    this.merchantBuyInFlight = request;
    this.merchantBuyOfferId = offerId;
    this.merchantError = null;
    this.renderUi();
    return request;
  }

  private ensureInventoryScreen(): InventoryScreen | null {
    if (this.inventoryScreen) return this.inventoryScreen;
    if (!this.content || !this.saveValue) return null;
    const equipmentContent = this.managementEquipmentContent();
    if (!equipmentContent) return null;
    const root = this.content.getRoot();
    const itemDefinitions = Object.fromEntries(root.items.map((item) => [item.id, item])) as unknown as ConstructorParameters<typeof InventoryScreen>[0]["itemDefinitions"];
    this.inventoryScreen = new InventoryScreen({
      currentSave: () => this.saveValue!,
      scene: "town",
      itemDefinitions,
      economy: root.economy,
      equipmentService: new EquipmentService(equipmentContent),
      fieldItemService: this.ensureFieldItemService() ?? undefined,
      reforgeService: new ReforgeService(equipmentContent),
      persist: (expectedRevision, nextSave) => this.persistManagement(expectedRevision, nextSave),
      staticMaxHp: (save, characterId) => calculateStaticMaxHp(equipmentContent, save, characterId),
      onStoreReplaced: (save) => this.onManagementStoreReplaced(save),
    });
    return this.inventoryScreen;
  }

  private ensurePartyScreen(): PartyScreen | null {
    if (this.partyScreen) return this.partyScreen;
    if (!this.content || !this.saveValue) return null;
    const bound = this.boundContent();
    const root = this.content.getRoot();
    const progression = this.managementProgression();
    if (!progression) return null;
    const partyService = new PartyService({
      getCharacter: bound.getCharacter,
    } as unknown as ConstructorParameters<typeof PartyService>[0]);
    const recruitmentService = new RecruitmentService({
      content: { getRecruitment: bound.getRecruitment } as unknown as ConstructorParameters<typeof RecruitmentService>[0]["content"],
      progression,
      protagonistCharacterId: root.protagonistCharacterId,
    });
    this.partyScreen = new PartyScreen({
      currentSave: () => this.saveValue!,
      partyService,
      partyContent: { getCharacter: bound.getCharacter } as unknown as ConstructorParameters<typeof PartyScreen>[0]["partyContent"],
      protagonistCharacterId: root.protagonistCharacterId,
      persist: (expectedRevision, nextSave) => this.persistManagement(expectedRevision, nextSave),
      recruitmentService,
      onStoreReplaced: (save) => this.onManagementStoreReplaced(save),
    });
    return this.partyScreen;
  }

  private ensureSkillScreen(): SkillScreen | null {
    if (this.skillScreen) return this.skillScreen;
    if (!this.content || !this.saveValue) return null;
    const bound = this.boundContent();
    const skillService = new SkillService({
      getCharacter: bound.getCharacter,
      getSkill: bound.getSkill,
    } as unknown as ConstructorParameters<typeof SkillService>[0]);
    const skillStoneContent = {
      getCharacter: bound.getCharacter,
      getSkill: bound.getSkill,
      getSkillAffix: bound.getSkillAffix,
      getRoot: bound.getRoot,
    } as unknown as ConstructorParameters<typeof SkillStoneGenerator>[0];
    const generator = new SkillStoneGenerator(skillStoneContent);
    this.skillScreen = new SkillScreen({
      currentSave: () => this.saveValue!,
      content: { getCharacter: bound.getCharacter, getSkill: bound.getSkill } as unknown as ConstructorParameters<typeof SkillScreen>[0]["content"],
      skillContent: { getCharacter: bound.getCharacter, getSkill: bound.getSkill, getSkillAffix: bound.getSkillAffix } as unknown as ConstructorParameters<typeof SkillScreen>[0]["skillContent"],
      skillService,
      skillStoneGenerator: generator,
      persist: (expectedRevision, nextSave) => this.persistManagement(expectedRevision, nextSave),
      onStoreReplaced: (save) => this.onManagementStoreReplaced(save),
    });
    return this.skillScreen;
  }

  private ensureComboScreen(): ComboScreen | null {
    if (this.comboScreen) return this.comboScreen;
    if (!this.content) return null;
    const bound = this.boundContent();
    const root = this.content.getRoot();
    const matcher = new ComboMatcher({
      getCharacter: bound.getCharacter,
      getSkill: bound.getSkill,
      getEquipmentBase: bound.getEquipmentBase,
      getEquipmentAffix: bound.getEquipmentAffix,
      getSkillAffix: bound.getSkillAffix,
      getCombo: bound.getCombo,
    } as unknown as ConstructorParameters<typeof ComboMatcher>[0]);
    this.comboScreen = new ComboScreen({
      currentSave: () => this.saveValue!,
      comboDefinitions: root.combos as unknown as ConstructorParameters<typeof ComboScreen>[0]["comboDefinitions"],
      match: (save) => matcher.matchParty({
        party: save.party,
        characters: save.characters,
        inventory: save.inventory,
        comboIds: root.combos.map((combo) => combo.id),
      }),
      persist: (expectedRevision, nextSave) => this.persistManagement(expectedRevision, nextSave),
      onStoreReplaced: (save) => this.onManagementStoreReplaced(save),
    });
    return this.comboScreen;
  }

  private async managementAction(action: () => Promise<unknown> | unknown): Promise<void> {
    if (!this.saveValue || this.saveValue.expedition !== null || this.saveValue.battle !== null) return;
    await action();
    this.renderUi();
  }

  private renderUi(): void {
    const ui = this.flowUi;
    if (!ui) return;
    const previousPage = ui.dataset.page;
    const focusedControl = ui.ownerDocument.activeElement;
    const hadUiFocus = focusedControl ? ui.contains(focusedControl) : false;
    const focusedId = hadUiFocus ? focusedControl?.getAttribute("data-testid") : null;
    const previousScroll = ui.querySelector?.<HTMLElement>(".management-scroll-content")?.scrollTop ?? 0;
    // 标题保留与 Pixi 按钮对齐的透明语义层；其余旧 DOM 仅保留自动化/迁移语义并隐藏。
    const visibleTownModal = this.stateValue === "town" && this.townModalRenderer !== null && this.townModalRenderer.semanticControls.length > 0;
    const productionTownModal = this.stateValue === "town" && this.townModalRenderer !== null;
    const visibleManagement = this.stateValue === "town" && this.managementPage !== null;
    // 管理页是实际可操作的移动端界面，不能继续落入旧的透明 semantic/legacy 层。
    ui.className = this.stateValue === "reward" ? "reward-ui" : visibleManagement
      ? "management-ui"
      : this.stateValue === "title" || visibleTownModal ? "semantic-ui" : "semantic-ui legacy-debug-ui";
    this.applySemanticInputGate(ui);
    this.applySemanticViewportLayout();
    this.resetHeldMoveInput();
    this.explorationPositionHud = null;
    for (const unbind of this.uiUnbinds.splice(0)) unbind();
    ui.replaceChildren();
    const documentValue = ui.ownerDocument;
    ui.dataset.page = this.managementPage ?? this.stateValue;
    const status = documentValue.createElement("p");
    status.dataset.testid = "flow-status";
    status.className = "semantic-status";
    status.textContent = this.statusText();
    ui.appendChild(status);
    if (this.pendingFieldAction !== null) {
      const pending = documentValue.createElement("p");
      pending.dataset.testid = "field-action-pending";
      pending.className = "semantic-status";
      pending.textContent = this.pendingFieldAction === "map" ? "地图面板待接入" : "菜单面板待接入";
      ui.appendChild(pending);
    }
    if (this.managementRouteDiagnostic !== null) {
      const diagnostic = documentValue.createElement("p");
      diagnostic.dataset.testid = "management-route-diagnostic";
      diagnostic.className = "semantic-status";
      diagnostic.textContent = this.managementRouteDiagnostic;
      ui.appendChild(diagnostic);
    }
    if (this.townLeaseDiagnostic !== null) {
      const diagnostic = documentValue.createElement("p");
      diagnostic.dataset.testid = "town-lease-diagnostic";
      diagnostic.className = "semantic-status";
      diagnostic.textContent = `TOWN_LEASE_CLEANUP_FAILED:${this.townLeaseDiagnostic}`;
      ui.appendChild(diagnostic);
    }
    if (this.flowErrorDetail !== null) {
      const detail = documentValue.createElement("p");
      detail.dataset.testid = "flow-error-detail";
      detail.className = "semantic-status";
      detail.textContent = this.flowErrorDetail;
      ui.appendChild(detail);
    }
    const addButton = (
      testId: string,
      label: string,
      action: () => Promise<unknown>,
      disabled = false,
      container: HTMLElement = ui,
    ): HTMLButtonElement => {
      const button = documentValue.createElement("button");
      button.type = "button";
      button.dataset.testid = testId;
      button.textContent = label;
      button.setAttribute("aria-label", label);
      if (visibleManagement) {
        button.className = testId === "return-town" ? "management-return" : "management-action";
        if (["management-party-confirm", "management-combo-commit"].includes(testId)) button.dataset.tone = "primary";
      }
      button.disabled = disabled;
      if (disabled) button.setAttribute("aria-disabled", "true");
      const listener = (): void => {
        let request: Promise<unknown> | unknown;
        try {
          request = action();
        } catch (error) {
          this.setFlowError(`action_exception:${this.safeExceptionMessage(error)}`);
          return;
        }
        void Promise.resolve(request).catch((error: unknown) => {
          this.setFlowError(`action_exception:${this.safeExceptionMessage(error)}`);
        });
      };
      button.addEventListener("click", listener);
      this.uiUnbinds.push(() => button.removeEventListener("click", listener));
      container.appendChild(button);
      return button;
    };
    if (this.stateValue === "title") {
      addButton("continue", "继续游戏", () => this.continueGame(), !this.storedSaveAvailable);
      addButton("new-game", "开始新游戏", () => this.newGame());
    } else if (this.stateValue === "town" && (this.managementPage !== null || !productionTownModal)) {
      const currentSave = this.saveValue;
      const world = currentSave?.world;
      const root = this.content?.getRoot();
      if (world && root) {
        if (currentSave?.battle?.phase === "COMPLETE") {
          addButton(
            "complete-battle-cleanup",
            "清理已完成战斗",
            () => this.retryCompleteBattleCleanupFromTown(),
            this.terminalCleanupInFlight !== null,
          );
          if (this.terminalCleanupError) {
            const error = documentValue.createElement("p");
            error.dataset.testid = "complete-battle-cleanup-error";
            error.textContent = this.terminalCleanupError;
            ui.appendChild(error);
          }
        }
        if (this.managementPage) {
          const managementPage = this.managementPage;
          const managementTitle = documentValue.createElement("h1");
          managementTitle.dataset.testid = "management-title";
          managementTitle.className = "management-title";
          managementTitle.textContent = {
            menu: "冒险菜单",
            inventory: "背包",
            party: "队伍编成",
            skill: "技能与铭石",
            combo: "Combo 图鉴",
            settings: "系统设置",
          }[managementPage];
          const header = documentValue.createElement("header");
          header.className = "management-header";
          const headingGroup = documentValue.createElement("div");
          const eyebrow = documentValue.createElement("span");
          eyebrow.className = "management-eyebrow";
          eyebrow.textContent = "PIXEL EXPEDITION / 冒险手札";
          headingGroup.appendChild(eyebrow);
          headingGroup.appendChild(managementTitle);
          header.appendChild(headingGroup);
          const wallet = documentValue.createElement("div");
          wallet.className = "management-wallet";
          for (const [label, value] of [["金币", currentSave?.gold ?? 0], ["已解锁", `${world.highestUnlockedFloor} / 10 层`]] as const) {
            const item = documentValue.createElement("span");
            item.textContent = label;
            const amount = documentValue.createElement("strong");
            amount.textContent = String(value);
            item.appendChild(amount);
            wallet.appendChild(item);
          }
          header.appendChild(wallet);
          ui.appendChild(header);
          const addIcon = (button: HTMLElement, route: string): void => {
            const icon = documentValue.createElement("span");
            icon.className = "ui-icon";
            icon.dataset.icon = route;
            icon.setAttribute("aria-hidden", "true");
            button.appendChild(icon);
          };
          const appendArt = (parent: HTMLElement, src: string | null): void => {
            if (!src) return;
            const image = documentValue.createElement("img");
            image.className = "management-asset-icon";
            image.src = assetUrl(src);
            image.alt = "";
            image.width = 48;
            image.height = 48;
            image.setAttribute("aria-hidden", "true");
            parent.appendChild(image);
          };
          const navigation = documentValue.createElement("nav");
          navigation.className = "management-tabs";
          navigation.setAttribute("aria-label", "冒险管理导航");
          for (const [route, label] of [["inventory", "背包"], ["party", "队伍"], ["skill", "技能"], ["combo", "羁绊"], ["settings", "设置"]] as const) {
            const tab = addButton(`management-tab-${route}`, label, () => this.routeManagementPage(route), managementPage === route, navigation);
            tab.textContent = "";
            addIcon(tab, route);
            const text = documentValue.createElement("span");
            text.textContent = label;
            tab.appendChild(text);
            if (managementPage === route) tab.setAttribute("aria-current", "page");
          }
          const summary = documentValue.createElement("p");
          summary.dataset.testid = "management-summary";
          summary.className = "management-summary";
          const page = this.managementPage;
          if (page === "menu") {
            summary.textContent = "篝火仍在燃烧。整理行囊，集结同伴，为下一次远征做好准备。";
            ui.appendChild(summary);
            const managementEntries: readonly ["inventory" | "party" | "skill" | "combo" | "settings", string][] = [
              ["inventory", "背包与装备"],
              ["party", "队伍编成"],
              ["skill", "技能与铭石"],
              ["combo", "Combo 图鉴"],
              ["settings", "系统设置"],
            ];
            const managementHub = documentValue.createElement("nav");
            managementHub.dataset.testid = "management-hub";
            managementHub.className = "management-hub";
            managementHub.setAttribute("aria-label", "冒险管理功能");
            const descriptions = {
              inventory: ["整理战利品，打造专属构筑", `${currentSave?.inventory.equipment.length ?? 0} 件装备 · ${currentSave?.inventory.skillStones.length ?? 0} 枚铭石`],
              party: ["调整站位，让同伴各展所长", `${Object.values(currentSave?.characters ?? {}).filter((character) => character.recruited).length} 位同伴已集结`],
              skill: ["磨炼招式，唤醒铭石的力量", "升级技能 · 调整主动槽"],
              combo: ["寻找词条之间的连锁可能", `${world.discoveredComboIds.length} 种羁绊已发现`],
              settings: ["调整画质，找到舒适的节奏", "显示偏好 · 闪光设置"],
            };
            for (const [route, label] of managementEntries) {
              const entry = addButton(`management-hub-${route}`, label, () => this.routeManagementPage(route), false, managementHub);
              entry.textContent = "";
              addIcon(entry, route);
              for (const [className, text] of [["hub-label", label], ["hub-description", descriptions[route][0]], ["hub-meta", descriptions[route][1]]]) {
                const line = documentValue.createElement("span");
                line.className = className;
                line.textContent = text;
                entry.appendChild(line);
              }
            }
            const note = documentValue.createElement("aside");
            note.className = "expedition-note";
            const noteTitle = documentValue.createElement("strong");
            noteTitle.textContent = "下一站，深渊";
            const noteBody = documentValue.createElement("span");
            noteBody.textContent = "与制图师交谈，选择目标楼层。出发前可到旅店恢复队伍。";
            const noteFooter = documentValue.createElement("small");
            noteFooter.textContent = "队伍与装备仅可在城镇调整";
            note.appendChild(noteTitle);
            note.appendChild(noteBody);
            note.appendChild(noteFooter);
            managementHub.appendChild(note);
            ui.appendChild(managementHub);
          } else if (page === "inventory") {
            const screen = this.ensureInventoryScreen();
            const state = screen?.state;
            const inventoryStatusLabel = state?.status === "empty" ? "待探索" : state?.status === "loading" ? "保存中" : state?.status === "disabled" ? "暂不可用" : "已就绪";
            summary.textContent = `背包：装备 ${currentSave?.inventory.equipment.length ?? 0}，铭石 ${currentSave?.inventory.skillStones.length ?? 0}，药水 ${currentSave?.inventory.stackables.item_minor_potion ?? 0}；状态 ${inventoryStatusLabel}`;
            ui.appendChild(summary);
            if (screen && state) {
              const selected = state.selected;
              const selectedInstance = currentSave && selected?.kind === "equipment"
                ? managementEquipmentInSave(currentSave, selected.id)
                : undefined;
              const equipmentContent = this.managementEquipmentContent();
              for (const item of state.items) {
                const itemLine = documentValue.createElement("p");
                itemLine.className = "management-inventory-item";
                itemLine.dataset.testid = `inventory-item-${item.id}`;
                const itemInstance = currentSave && item.kind === "equipment" ? managementEquipmentInSave(currentSave, item.id) : undefined;
                const itemBase = itemInstance ? root.equipmentBases.find((base) => base.id === itemInstance.baseId) : undefined;
                const itemName = itemBase ? managementEquipmentName(itemBase) : item.id;
                const itemMeta = itemInstance && itemBase
                  ? `·${MANAGEMENT_QUALITY_LABELS[itemInstance.quality]}·装等${itemInstance.itemLevel}·${MANAGEMENT_SLOT_LABELS[itemBase.slot]}`
                  : "";
                itemLine.textContent = `${itemName}（${item.id}）${itemMeta} ×${item.quantity}${item.locked ? "·已锁定" : ""}${item.equipped ? "·已装备" : ""}${item.disabledReasonKey ? `·${item.disabledReasonKey}` : ""}`;
                appendArt(itemLine, artIconUrl(itemBase?.spriteId ?? `icon_${item.id}`));
                ui.appendChild(itemLine);
                if (item.kind === "equipment" && !item.overflow) {
                  addButton(
                    `management-inventory-select-${item.id}`,
                    `查看 ${itemName}`,
                    async () => { screen.selectItem(item.id); this.renderUi(); },
                    false,
                  );
                }
              }

              const firstEquipment = state.items.find((item) => item.kind === "equipment" && !item.overflow);
              if (!firstEquipment) {
                const emptyState = documentValue.createElement("section");
                emptyState.dataset.testid = "management-inventory-empty-state";
                emptyState.className = "inventory-empty-state";
                emptyState.textContent = "暂无装备。先去野外探索并击败小怪，装备和铭石会在战利品中出现。";
                ui.appendChild(emptyState);
              }

              const fieldItemDisabledReason = documentValue.createElement("p");
              fieldItemDisabledReason.dataset.testid = "inventory-field-item-disabled-reason";
              // FieldItemService 只允许 expedition 场景使用野外物品；城镇管理页明确展示门禁，避免按钮看似可用但点击无效。
              fieldItemDisabledReason.dataset.reason = "inventory.field_item_requires_expedition";
              fieldItemDisabledReason.textContent = "野外药水仅可在远征中使用；城镇可到旅店休整。";
              ui.appendChild(fieldItemDisabledReason);
              addButton("management-inventory-use-potion", "使用野外药水", () => this.managementAction(async () => {
                const characterId = this.saveValue?.party.slots.find((id): id is string => id !== null);
                if (!characterId) return;
                const preview = screen.previewFieldItem("item_minor_potion", characterId);
                if (preview.ok) await screen.useFieldItem();
              }), true);
              // 没有战斗消耗品时不渲染无意义禁用项；药水仍保留数量与远征门禁。
              const hasOtherStackable = Object.entries(currentSave?.inventory.stackables ?? {})
                .some(([itemId, quantity]) => itemId !== "item_minor_potion" && quantity > 0);
              if (hasOtherStackable) addButton("management-inventory-battle-item", "战斗物品需在战斗指令中使用", async () => undefined, true);

              if (firstEquipment) {
                const firstSelected = selected ?? firstEquipment;
                addButton("management-inventory-select-first", "选择首件装备", async () => {
                  screen.selectItem(firstEquipment.id);
                  this.renderUi();
                });
                addButton("management-inventory-lock", selected?.locked ? "解锁当前物品" : "锁定当前物品", () => this.managementAction(async () => {
                  if (!screen.state.selected) screen.selectItem(firstSelected.id);
                  await screen.toggleLock();
                }));
                addButton("management-inventory-equip", "装备到队伍首位", () => this.managementAction(async () => {
                  const target = screen.state.selected ?? firstEquipment;
                  const characterId = this.saveValue?.party.slots[0];
                  if (!target || target.kind !== "equipment" || !characterId) return;
                  if (!screen.state.selected) screen.selectItem(target.id);
                  const drafted = screen.previewEquip(characterId);
                  if (drafted.ok) await screen.confirmEquip();
                }));
                const equippedEntry = Object.entries(currentSave?.characters ?? {}).flatMap(([characterId, progress]) => Object.entries(progress.equipmentBySlot).map(([slot, instanceId]) => ({ characterId, slot, instanceId })))[0];
                addButton("management-inventory-unequip", "卸下首件装备", () => this.managementAction(async () => {
                  if (!equippedEntry || !equippedEntry.instanceId) return;
                  await screen.confirmUnequip(equippedEntry.characterId, equippedEntry.slot as Parameters<InventoryScreen["confirmUnequip"]>[1]);
                }), equippedEntry === undefined || equippedEntry.instanceId === null);
                addButton("management-inventory-disassemble", "分解当前物品", () => this.managementAction(async () => {
                  if (!screen.state.selected) screen.selectItem(firstSelected.id);
                  if (screen.state.selected) await screen.disassemble();
                }));

                // 详情严格消费内容表字段；找不到底材或词条时直接显示 INVALID_CONTENT，
                // 不使用 ID 后缀猜测名称，也不把机制词条冒充静态属性。
                if (selectedInstance && currentSave) {
                const detail = documentValue.createElement("section");
                detail.dataset.testid = "management-inventory-detail";
                detail.dataset.quality = selectedInstance.quality;
                detail.className = "inventory-detail-card";
                const base = root.equipmentBases.find((candidate) => candidate.id === selectedInstance.baseId);
                if (!base) {
                  detail.textContent = "INVALID_CONTENT";
                } else {
                  const baseValue = managementBaseValue(base, selectedInstance);
                  if (!Number.isSafeInteger(baseValue) || (base.slot === "weapon" ? base.weaponType === null : base.weaponType !== null)) {
                    detail.textContent = "INVALID_CONTENT";
                  } else {
                    const lines = [
                      `${managementEquipmentName(base)} · ${MANAGEMENT_QUALITY_LABELS[selectedInstance.quality]} · 物品等级 ${selectedInstance.itemLevel}`,
                      `部位：${MANAGEMENT_SLOT_LABELS[base.slot]}`,
                      `基础属性：${MANAGEMENT_STAT_LABELS[base.baseStat]} +${baseValue}`,
                    ];
                    const appendAffix = (roll: EquipmentInstance["affixes"][number], kind: "普通词条" | "深渊词条"): void => {
                      const affix = root.equipmentAffixes.find((candidate) => candidate.id === roll.affixId);
                      if (!affix) {
                        lines.push(`${kind}：INVALID_CONTENT`);
                        return;
                      }
                      const marks = [
                        roll.craftEmpowered ? "锻造强化" : "未锻造",
                        roll.reforged ? "已重铸" : "未重铸",
                      ].join("/");
                      const modifiers = affix.modifiers.map((modifier) => managementModifierSummary(modifier)).join("、") || "无静态修正";
                      const tags = affix.tags.map((tag) => `${tag.tagId}×${tag.count}`).join("、") || "无";
                      lines.push(`${kind}：${managementAffixName(affix)} · T${roll.tier} · roll=${roll.roll} · ${marks} · ${modifiers} · 标签 ${tags}`);
                    };
                    for (const roll of selectedInstance.affixes) appendAffix(roll, "普通词条");
                    if (selectedInstance.abyssAffix !== null) appendAffix(selectedInstance.abyssAffix, "深渊词条");
                    detail.textContent = lines.join("；");
                  }
                }
                ui.appendChild(detail);
                }

                const partyCharacterIds = currentSave?.party.slots.filter((characterId): characterId is string => characterId !== null) ?? [];
              const selectedBase = selectedInstance ? root.equipmentBases.find((base) => base.id === selectedInstance.baseId) : undefined;
                for (const characterId of partyCharacterIds) {
                const progress = currentSave?.characters[characterId];
                if (!progress || progress.recruited !== true) continue;
                const characterResult = this.content?.getCharacter(characterId);
                const characterName = this.content ? managementCharacterName(this.content, characterId) : characterId;
                const slot = selectedBase?.slot;
                const currentId = slot ? progress.equipmentBySlot[slot] : null;
                const currentInstance = currentId ? managementEquipmentInSave(currentSave!, currentId) : undefined;
                const currentBase = currentInstance ? root.equipmentBases.find((base) => base.id === currentInstance.baseId) : undefined;
                const currentText = currentId === null ? "空" : currentBase ? managementEquipmentName(currentBase) : "INVALID_CONTENT";
                const equipTestId = `management-inventory-equip-${characterId}`;
                let disabledReason: string | null = null;
                if (!selected) disabledReason = "inventory.equipment_required";
                else if (!selectedInstance || !selectedBase) disabledReason = "INVALID_CONTENT";
                else if (selected?.overflow === true) disabledReason = "inventory.overflow_not_equipable";
                else if (managementIsEquipped(currentSave!, selectedInstance.instanceId)) disabledReason = "inventory.item_already_equipped";
                else if (!characterResult?.ok) disabledReason = "INVALID_CONTENT";
                else if ((selectedBase.slot === "weapon" && selectedBase.weaponType === null)
                  || (selectedBase.slot !== "weapon" && selectedBase.weaponType !== null)) disabledReason = "INVALID_CONTENT";
                else if (selectedBase.slot === "weapon" && selectedBase.weaponType !== null && !characterResult.value.allowedWeaponTypes.includes(selectedBase.weaponType)) disabledReason = "WEAPON_NOT_ALLOWED";
                else if (state.status === "loading") disabledReason = "inventory.saving";
                addButton(
                  equipTestId,
                  `装备给${characterName}${slot ? `·${MANAGEMENT_SLOT_LABELS[slot]}` : ""}（当前：${currentText}）`,
                  () => this.managementAction(async () => {
                    if (!selectedInstance || !selectedBase) return;
                    const selectedResult = screen.selectItem(selectedInstance.instanceId);
                    if (!selectedResult.ok) return;
                    const drafted = screen.previewEquip(characterId, selectedBase.slot);
                    if (drafted.ok) await screen.confirmEquip();
                  }),
                  disabledReason !== null,
                );
                if (disabledReason !== null) {
                  const reason = documentValue.createElement("p");
                  reason.dataset.testid = `${equipTestId}-disabled-reason`;
                  reason.textContent = disabledReason;
                  ui.appendChild(reason);
                }

                const compare = documentValue.createElement("p");
                compare.dataset.testid = `management-inventory-compare-${characterId}`;
                compare.className = "inventory-compare-line";
                if (!selectedInstance) {
                  compare.textContent = `${characterName}：请选择装备后比较`;
                } else if (!selectedBase || !equipmentContent) {
                  compare.textContent = `${characterName}：INVALID_CONTENT`;
                } else if (!characterResult?.ok) {
                  compare.textContent = `${characterName}：INVALID_CONTENT`;
                } else {
                  const replacement = clone(currentSave!) as GameSaveV1;
                  replacement.characters[characterId].equipmentBySlot[selectedBase.slot] = selectedInstance.instanceId;
                  const currentModifiers = calculateEquipmentStatModifiers(equipmentContent, currentSave!, characterId);
                  const replacementModifiers = calculateEquipmentStatModifiers(equipmentContent, replacement, characterId);
                  if (!currentModifiers.ok || !replacementModifiers.ok) {
                    compare.textContent = `${characterName}：INVALID_CONTENT`;
                  } else {
                    const deltas: string[] = [];
                    for (const stat of MANAGEMENT_STAT_KEYS) {
                      const flatDelta = (replacementModifiers.value.flat?.[stat] ?? 0) - (currentModifiers.value.flat?.[stat] ?? 0);
                      const percentDelta = (replacementModifiers.value.percentBps?.[stat] ?? 0) - (currentModifiers.value.percentBps?.[stat] ?? 0);
                      if (flatDelta !== 0) deltas.push(`${MANAGEMENT_STAT_LABELS[stat]} ${flatDelta > 0 ? "+" : ""}${flatDelta}`);
                      if (percentDelta !== 0) deltas.push(`${MANAGEMENT_STAT_LABELS[stat]}% ${percentDelta > 0 ? "+" : ""}${percentDelta}bp`);
                    }
                    compare.textContent = deltas.length > 0
                      ? `${characterName}·${MANAGEMENT_SLOT_LABELS[selectedBase.slot]}：${deltas.join("，")}`
                      : `${characterName}：属性持平；机制词条见详情`;
                  }
                }
                ui.appendChild(compare);
                }

              // 装备列表按 party slot、六部位固定顺序展示；卸下仍走 Screen 的 CAS 提交。
                const equippedList = documentValue.createElement("section");
              equippedList.dataset.testid = "management-inventory-equipped-list";
              equippedList.className = "inventory-equipped-list";
                for (const characterId of partyCharacterIds) {
                const progress = currentSave?.characters[characterId];
                if (!progress || progress.recruited !== true) continue;
                const characterName = this.content ? managementCharacterName(this.content, characterId) : characterId;
                for (const slot of MANAGEMENT_EQUIPMENT_SLOT_ORDER) {
                  const instanceId = progress.equipmentBySlot[slot];
                  const instance = instanceId ? managementEquipmentInSave(currentSave!, instanceId) : undefined;
                  const base = instance ? root.equipmentBases.find((candidate) => candidate.id === instance.baseId) : undefined;
                  const line = documentValue.createElement("p");
                  line.dataset.testid = `management-inventory-equipped-${characterId}-${slot}`;
                  line.textContent = `${characterName}·${MANAGEMENT_SLOT_LABELS[slot]}：${instanceId === null ? "空" : base ? managementEquipmentName(base) : "INVALID_CONTENT"}`;
                  equippedList.appendChild(line);
                  if (instanceId !== null) {
                    addButton(
                      `management-inventory-unequip-${characterId}-${slot}`,
                      `卸下${characterName}·${MANAGEMENT_SLOT_LABELS[slot]}`,
                      () => this.managementAction(() => screen.confirmUnequip(characterId, slot)),
                      state.status === "loading",
                      equippedList,
                    );
                  }
                }
                }
                ui.appendChild(equippedList);
                if (state.error) {
                  const error = documentValue.createElement("p");
                  error.dataset.testid = "management-inventory-error";
                  error.textContent = state.error.code;
                  ui.appendChild(error);
                }
              }
            }
          } else if (page === "party") {
            const screen = this.ensurePartyScreen();
            const state = screen?.state;
            const slots = state?.draft.slots.map((id) => id && this.content ? managementCharacterName(this.content, id) : "空位").join(" / ") ?? "";
            const recruited = currentSave ? Object.values(currentSave.characters).filter((character) => character.recruited).length : 0;
            summary.textContent = `队伍：${slots}；已招募 ${recruited} · ${state?.status === "loading" ? "保存中" : "调整后请确认编队"}`;
            ui.appendChild(summary);
            if (screen && state) {
              for (let slot = 0; slot < 4; slot += 1) {
                const slotLine = documentValue.createElement("p");
                slotLine.dataset.testid = `management-party-slot-${slot}`;
                const position = slot < 2 ? "前排" : "后排";
                const memberId = state.draft.slots[slot];
                slotLine.className = "formation-slot";
                slotLine.textContent = `槽位 ${slot + 1}（${position}）：${memberId && this.content ? managementCharacterName(this.content, memberId) : "空位"}`;
                ui.appendChild(slotLine);
              }
              for (const [characterId, progress] of Object.entries(currentSave?.characters ?? {})) {
                if (progress.recruited !== true) continue;
                const characterName = this.content ? managementCharacterName(this.content, characterId) : characterId;
                const card = documentValue.createElement("section");
                card.className = "management-character-card";
                card.dataset.character = characterId;
                const heading = documentValue.createElement("h2");
                heading.textContent = `${characterName} · Lv.${progress.level}`;
                card.appendChild(heading);
                ui.appendChild(card);
                addButton(`management-party-select-${characterId}`, `选择 ${characterName}`, async () => { screen.selectCharacter(characterId); this.renderUi(); }, false, card);
                for (let slot = 0; slot < 4; slot += 1) {
                  // 四个槽位全部显式呈现；跨槽点击交由 PartyScreen 负责草稿内换位。
                  addButton(
                    `management-party-place-${characterId}-slot-${slot}`,
                    `${slot < 2 ? "前排" : "后排"} · 槽位 ${slot + 1}`,
                    async () => { screen.placeCharacter(characterId, slot); this.renderUi(); },
                    state.draft.slots[slot] === characterId,
                    card,
                  );
                }
                const slot = state.draft.slots.findIndex((value) => value === null);
                addButton(`management-party-place-${characterId}`, `编入 ${characterName}`, async () => { if (slot >= 0) { screen.placeCharacter(characterId, slot); this.renderUi(); } }, slot < 0 || state.draft.slots.includes(characterId), card);
              }
              for (let slot = 1; slot < 4; slot += 1) {
                addButton(`management-party-clear-${slot}`, `清空槽位 ${slot + 1}`, async () => { screen.clearSlot(slot); this.renderUi(); }, state.draft.slots[slot] === null);
              }
              addButton("management-party-confirm", "确认队伍", () => this.managementAction(() => screen.confirm()), false);
              addButton("management-party-cancel", "撤销队伍草稿", async () => { screen.cancel(); this.renderUi(); });
              if (state.error) {
                const error = documentValue.createElement("p");
                error.dataset.testid = "management-party-error";
                error.textContent = state.error.code;
                ui.appendChild(error);
              }
              const recruitment = root.recruitments.find((candidate) => currentSave?.characters[candidate.characterId]?.recruited !== true);
              if (recruitment) {
                addButton("management-party-evaluate-recruitment", "评估首个招募", async () => { screen.evaluateRecruitment(recruitment.id); this.renderUi(); });
                const recruitmentMatches = state.recruitment?.recruitmentId === recruitment.id;
                addButton("management-party-confirm-recruitment", "确认首个招募", () => this.managementAction(() => screen.confirmRecruitment(recruitment.id)), !recruitmentMatches);
                if (!recruitmentMatches) {
                  const recruitmentDisabledReason = documentValue.createElement("p");
                  recruitmentDisabledReason.dataset.testid = "management-party-recruitment-disabled-reason";
                  recruitmentDisabledReason.dataset.reason = "party.recruitment_evaluation_required";
                  recruitmentDisabledReason.textContent = "请先评估招募条件，再确认招募。";
                  ui.appendChild(recruitmentDisabledReason);
                }
              }
              if (state.recruitment) {
                const recruitmentLine = documentValue.createElement("p");
                recruitmentLine.dataset.testid = "management-party-recruitment-state";
                recruitmentLine.textContent = `招募：${this.content ? managementCharacterName(this.content, state.recruitment.characterId) : state.recruitment.characterId} · 金币 ${state.recruitment.goldCost}`;
                ui.appendChild(recruitmentLine);
              }
            }
          } else if (page === "skill") {
            const screen = this.ensureSkillScreen();
            const state = screen?.state;
            summary.textContent = `${state?.characterId && this.content ? managementCharacterName(this.content, state.characterId) : "请选择角色"} · 技能点 ${state?.skillPoints ?? 0} · 主动槽 ${state?.slots.map((id) => id ? this.battleSkillLabel(id) : "空").join(" / ") || "空"}`;
            ui.appendChild(summary);
            if (screen && state) {
              // 技能页按存档中已招募角色提供切换入口，角色状态仍由 SkillScreen 严格校验。
              const picker = documentValue.createElement("section");
              picker.className = "management-character-picker";
              ui.appendChild(picker);
              for (const [characterId, progress] of Object.entries(currentSave?.characters ?? {})) {
                if (progress.recruited !== true) continue;
                addButton(
                  `management-skill-character-${characterId}`,
                  this.content ? managementCharacterName(this.content, characterId) : characterId,
                  async () => { screen.selectCharacter(characterId); this.renderUi(); },
                  state.characterId === characterId,
                  picker,
                );
              }
              for (const skill of state.skills) {
                const level = state.skillLevels[skill.id] ?? 0;
                const disabled = state.disabledReasons.some((reason) => reason.skillId === skill.id);
                const card = documentValue.createElement("section");
                card.className = "management-skill-card";
                const heading = documentValue.createElement("h2");
                heading.textContent = `${this.battleSkillLabel(skill.id)} · Lv.${level}`;
                heading.className = "management-art-heading";
                appendArt(heading, skillIconUrl(skill.id));
                card.appendChild(heading);
                addButton(`management-skill-upgrade-${skill.id}`, "升级技能", () => this.managementAction(() => screen.upgrade(skill.id)), disabled, card);
                addButton(`management-skill-equip-${skill.id}`, "装备到主动槽", () => this.managementAction(() => screen.equip(skill.id, 0)), level < 1, card);
                ui.appendChild(card);
              }
              addButton("management-skill-unequip-0", "卸下主动槽 1", () => this.managementAction(() => screen.unequip(0)), state.slots[0] === null);
              addButton("management-skill-focus", "聚焦当前角色", () => this.managementAction(() => screen.setFocus(state.characterId)), false);
              const stoneId = currentSave?.characters[state.characterId]?.skillStoneInstanceId;
              if (stoneId) addButton("management-skill-attune", "重新调谐当前铭石", () => this.managementAction(() => screen.attuneStone(stoneId)), false);
            }
          } else if (page === "combo") {
            const screen = this.ensureComboScreen();
            const state = screen?.state;
            summary.textContent = `已发现羁绊 ${currentSave?.world.discoveredComboIds.length ?? 0} · 搭配装备与技能词条，解锁连锁效果`;
            ui.appendChild(summary);
            if (screen && state) {
              addButton("management-combo-refresh", "刷新 Combo 匹配", async () => {
                const result = screen.refresh();
                if (result.ok) this.comboBeforeMatch = result.value;
                this.renderUi();
              });
              addButton("management-combo-active", "查看已激活", async () => { screen.setSection("active"); this.renderUi(); });
              addButton("management-combo-reachable", "查看可达", async () => { screen.setSection("reachable"); this.renderUi(); });
              addButton("management-combo-codex", "查看图鉴", async () => { screen.setSection("codex"); this.renderUi(); });
              addButton("management-combo-preview", "预览新 Combo", async () => {
                if (this.comboBeforeMatch) screen.previewFromSave(this.comboBeforeMatch, this.saveValue!);
                this.renderUi();
              }, this.comboBeforeMatch === null);
              addButton("management-combo-commit", "确认发现 Combo", () => this.managementAction(() => screen.commitDiscovery(this.saveValue!, screen.state.preview ?? undefined)), state.preview === null);
              for (const entry of state.entries) {
                const line = documentValue.createElement("p");
                line.dataset.testid = `management-combo-entry-${entry.comboId}`;
                line.className = "management-combo-card";
                line.dataset.active = String(entry.active);
                line.textContent = `${this.battleComboLabel(entry.comboId)} · ${entry.active ? "已激活" : entry.reachable ? "即将解锁" : "尚未解锁"}`;
                appendArt(line, artIconUrl(`icon_${entry.comboId}`));
                ui.appendChild(line);
              }
            }
          } else {
            summary.textContent = `画质：${currentSave?.settings.qualityPreset === "battery" ? "省电" : "标准"} · 降低闪光：${currentSave?.settings.reducedFlashes ? "开启" : "关闭"}`;
            ui.appendChild(summary);
            const settingRows = [
              { id: "toggle-reduced-flashes", label: "降低闪光", description: "减弱战斗中的闪光效果，让长时间探索更舒适。", checked: currentSave?.settings.reducedFlashes === true, action: () => this.updateSettings((settings) => { settings.reducedFlashes = !settings.reducedFlashes; }) },
              { id: "set-battery", label: "省电画质", description: "降低渲染负担，适合移动设备与长时间游玩。", checked: currentSave?.settings.qualityPreset === "battery", action: () => this.updateSettings((settings) => { settings.qualityPreset = settings.qualityPreset === "battery" ? "standard" : "battery"; }) },
            ];
            for (const setting of settingRows) {
              const row = documentValue.createElement("section");
              row.className = "settings-row";
              const copy = documentValue.createElement("div");
              const heading = documentValue.createElement("h2");
              heading.textContent = setting.label;
              const description = documentValue.createElement("span");
              description.className = "settings-description";
              description.textContent = setting.description;
              copy.appendChild(heading);
              copy.appendChild(description);
              row.appendChild(copy);
              const toggle = addButton(setting.id, setting.checked ? "已开启" : "已关闭", setting.action, false, row);
              toggle.setAttribute("role", "switch");
              toggle.setAttribute("aria-label", setting.label);
              toggle.setAttribute("aria-checked", String(setting.checked));
              ui.appendChild(row);
            }
          }
          if (page !== "inventory" && page !== "party" && page !== "skill" && page !== "combo" && !ui.children.length) ui.appendChild(summary);
          // 内容与返回栏必须是两个 flex 区域；绝对定位会遮挡技能、队伍等滚动按钮。
          const managementContent = documentValue.createElement("main");
          managementContent.dataset.testid = "management-scroll-content";
          managementContent.className = "management-scroll-content";
          // 标题、分页导航与返回栏保持固定，只有业务内容滚动；不重绑任何事务回调。
          for (const child of Array.from(ui.children)) {
            if (child !== header && child !== status) managementContent.appendChild(child);
          }
          ui.replaceChildren(status, header);
          if (page !== "menu") ui.appendChild(navigation);
          ui.appendChild(managementContent);
          const managementFooter = documentValue.createElement("footer");
          managementFooter.dataset.testid = "management-footer";
          managementFooter.className = "management-footer";
          const footerNote = documentValue.createElement("span");
          footerNote.className = "footer-note";
          footerNote.textContent = page === "party" ? "调整站位后，记得确认队伍" : "灰炉镇 · 远征准备";
          managementFooter.appendChild(footerNote);
          addButton("return-town", "返回城镇", async () => { this.managementPage = null; this.renderUi(); }, false, managementFooter);
          ui.appendChild(managementFooter);
          // Saving or selecting replaces DOM nodes: retain scroll and keyboard position.
          if (previousPage === page) {
            managementContent.scrollTop = previousScroll;
            if (focusedId) {
              const replacement = Array.from(ui.querySelectorAll<HTMLButtonElement>("button"))
                .find((button) => button.dataset.testid === focusedId && !button.disabled);
              replacement?.focus({ preventScroll: true });
            }
          } else if (hadUiFocus) {
            managementTitle.tabIndex = -1;
            managementTitle.focus({ preventScroll: true });
          }
          return;
        }

        if (currentSave?.expedition && !currentSave.battle) {
          addButton("continue-exploration", "继续当前远征", () => this.continueGame());
          addButton("return-town", "结束远征并返回城镇", () => this.returnToTown());
        }
        if (this.npcRouteMessage) {
          const npcStatus = documentValue.createElement("p");
          npcStatus.dataset.testid = "npc-route-status";
          npcStatus.textContent = this.npcRouteMessage;
          ui.appendChild(npcStatus);
        }
        if (this.townScene?.dialogue.isOpen || this.npcRouteMessage) {
          addButton("close-npc-panel", "关闭 NPC 面板", async () => { this.closeNpcPanel(); });
        }
        if (this.merchantPanelOpen && currentSave) {
          const panel = documentValue.createElement("section");
          panel.dataset.testid = "merchant-panel";
          const heading = documentValue.createElement("p");
          heading.textContent = `商店金币：${currentSave.gold}`;
          panel.appendChild(heading);
          for (const offer of currentSave.shop.offers) {
            const offerLine = documentValue.createElement("p");
            offerLine.dataset.testid = `merchant-offer-${offer.offerId}`;
            const itemText = offer.kind === "stackableItem"
              ? `${offer.itemId} ×${offer.quantity}`
              : offer.kind === "equipment"
                ? `${offer.equipment.instanceId}（${offer.equipment.baseId}）`
                : `${offer.skillStone.instanceId}`;
            const disabledReason = offer.sold
              ? "shop.offer_sold"
              : currentSave.gold < offer.goldPrice
                ? "shop.insufficient_gold"
                : null;
            offerLine.textContent = `${itemText} · ${offer.goldPrice}金币${offer.sold ? " · 已售" : ""}`;
            panel.appendChild(offerLine);
            addButton(
              `merchant-buy-${offer.offerId}`,
              "购买",
              () => this.buyMerchantOffer(offer.offerId),
              disabledReason !== null || this.merchantBuyInFlight !== null
                || this.stateValue !== "town" || currentSave.expedition !== null || currentSave.battle !== null,
              panel,
            );
            if (disabledReason !== null) {
              const reason = documentValue.createElement("p");
              reason.dataset.testid = `merchant-buy-disabled-${offer.offerId}`;
              reason.textContent = disabledReason;
              panel.appendChild(reason);
            }
          }
          ui.appendChild(panel);
          if (this.merchantError) {
            const error = documentValue.createElement("p");
            error.dataset.testid = "merchant-error";
            error.textContent = this.merchantError;
            ui.appendChild(error);
          }
        }
        const entries = buildFloorEntries(root.floors as unknown as Parameters<typeof buildFloorEntries>[0], world);
        const canDepart = currentSave?.expedition === null && currentSave?.battle === null;
        for (const entry of entries) {
          for (const mode of entry.modes) {
            const isDefault = entry.floor.id === "floor_01" && mode === "exploration";
            const testId = isDefault ? "enter-floor" : `enter-floor-${entry.floor.id}-${mode}`;
            const label = mode === "exploration"
              ? `进入第${entry.floor.floorNumber}层`
              : mode === "shortFarm"
                ? `短程刷取·第${entry.floor.floorNumber}层`
                : `Boss重试·第${entry.floor.floorNumber}层`;
            addButton(testId, label, () => this.enterFloor(entry.floor.id, mode), !canDepart);
          }
        }

        const echoState = buildAbyssEchoState(world, root.abyssEchoes);
        if (echoState.kind === "success") {
          for (const entry of echoState.entries) {
            const floor = root.floors.find((candidate) => candidate.id === entry.echo.floorId);
            if (!floor || floor.floorNumber > world.highestUnlockedFloor) continue;
            addButton(
              `enter-abyss-echo-${entry.echo.id}`,
              `回响·${entry.echo.id}`,
              () => this.enterFloor(floor.id, "abyssEcho", entry.echo.id),
              entry.locked,
            );
          }
        }

        const management: readonly ["inventory" | "party" | "skill" | "combo" | "settings", string][] = [
          ["inventory", "背包"],
          ["party", "队伍"],
          ["skill", "技能"],
          ["combo", "Combo"],
          ["settings", "设置"],
        ];
        for (const [route, label] of management) {
          addButton(`management-${route}`, label, () => this.routeManagementPage(route), !canDepart);
        }

        const npcLabels: Record<string, string> = {
          tavern: "酒馆", blacksmith: "铁匠", skillMentor: "技能导师", merchant: "商人",
          inn: "旅店", cartographer: "制图师", abyssWatcher: "深渊观测者",
        };
        for (const npc of root.npcs) {
          addButton(`npc-${npc.id}`, npcLabels[npc.function] ?? npc.id, () => this.handleNpc(npc.id));
        }
      } else {
        // Node fake/旧适配器没有正式 ContentRoot 时仍保留首层兼容入口。
        addButton("enter-floor", "进入第1层", () => this.enterFloor("floor_01"));
      }
    } else if (this.stateValue === "exploration") {
      const positionHud = documentValue.createElement("p");
      positionHud.dataset.testid = "exploration-position";
      this.explorationPositionHud = positionHud;
      ui.appendChild(positionHud);
      const explorationMessage = documentValue.createElement("p");
      explorationMessage.dataset.testid = "exploration-message";
      explorationMessage.textContent = this.explorationMessage ?? "探索消息：暂无";
      ui.appendChild(explorationMessage);
      this.updateExplorationPositionHud();
      this.appendExplorationMoveControls(documentValue, ui);
      addButton("interact", "交互", async () => { this.input.inputState.press("interact"); });
      const autoEncounterBusy = this.fieldItemInFlight !== null || this.autoEncounterInFlight !== null;
      addButton("auto-encounter", "自动前往下一遭遇", () => this.triggerEncounter(), autoEncounterBusy);
      if (this.autoEncounterError !== null) {
        const error = documentValue.createElement("p");
        error.dataset.testid = "auto-encounter-error";
        error.textContent = `自动遭遇失败：${this.autoEncounterError}`;
        ui.appendChild(error);
      }
      const equipmentContent = this.managementEquipmentContent();
      const fieldPotionTarget = this.saveValue && equipmentContent
        ? this.resolveFieldPotionTarget(this.saveValue, equipmentContent)
        : null;
      const potionCount = this.saveValue?.inventory.stackables.item_minor_potion ?? 0;
      const canUseFieldPotion = this.fieldItemInFlight === null && fieldPotionTarget?.ok === true;
      addButton("field-potion", `野外药水（${Math.max(0, potionCount)}）`, () => this.useFieldPotion(), !canUseFieldPotion);
      if (this.fieldItemError) {
        const error = documentValue.createElement("p");
        error.dataset.testid = "field-potion-error";
        error.textContent = this.fieldItemError;
        ui.appendChild(error);
      }
    } else if (this.stateValue === "battle") {
      const commandBusy = this.battleCommandInFlight !== null;
      addButton("basic-attack", "普攻", () => this.useBasicAttack(), commandBusy);
      const battle = this.saveValue?.battle;
      const actor = battle?.currentUnitId ? battle.units.find((unit) => unit.unitId === battle.currentUnitId) : undefined;
      const canUseBattleCommand = !commandBusy && battle?.phase === "AWAIT_COMMAND" && actor?.faction === "party";
      addButton("defend", "防御", () => this.useDefend(), !canUseBattleCommand);
      addButton("retreat", "撤退", () => this.useRetreat(), !canUseBattleCommand);
      const potionCount = this.saveValue?.inventory.stackables.item_minor_potion ?? 0;
      const canUsePotion = !commandBusy && battle?.phase === "AWAIT_COMMAND" && actor?.faction === "party" && potionCount > 0;
      addButton("minor-potion", `使用药水（${Math.max(0, potionCount)}）`, () => this.useMinorPotion(), !canUsePotion);
      const progress = actor?.faction === "party" ? this.saveValue?.characters[actor.definitionId] : undefined;
      const character = actor?.faction === "party" && this.content ? this.content.getCharacter(actor.definitionId) : null;
      const equippedSkillId = progress?.equippedActiveSkillIds.find((id): id is string => id !== null);
      const activeSkill = equippedSkillId && this.content ? this.content.getSkill(equippedSkillId) : null;
      const activeLevel = equippedSkillId && progress ? progress.skillLevels[equippedSkillId] ?? 1 : 1;
      const canUseActive = !commandBusy && Boolean(battle?.phase === "AWAIT_COMMAND" && actor?.faction === "party" && activeSkill?.ok && equippedSkillId && (actor.cooldowns[equippedSkillId] ?? 0) === 0 && actor.energy >= activeSkill.value.energyCostByLevel[Math.max(0, Math.min(4, activeLevel - 1))]);
      addButton("equipped-skill", "技能", () => this.useEquippedSkill(), !canUseActive);
      const ultimateId = character?.ok ? character.value.ultimateSkillId : null;
      const ultimateSkill = ultimateId && this.content ? this.content.getSkill(ultimateId) : null;
      const canUseUltimate = !commandBusy && Boolean(battle?.phase === "AWAIT_COMMAND" && actor?.faction === "party" && ultimateSkill?.ok && actor.energy >= 100);
      const canOpenSkillDrawer = !commandBusy
        && battle?.phase === "AWAIT_COMMAND"
        && actor?.faction === "party"
        && Boolean(activeSkill?.ok || ultimateSkill?.ok);
      addButton("ultimate-skill", "终极", () => this.useUltimateSkill(), !canUseUltimate);
      this.syncBattleHudAction("basic", canUseBattleCommand, canUseBattleCommand ? null : "battle.waiting_for_actor");
      this.syncBattleHudAction("skill", canOpenSkillDrawer, canOpenSkillDrawer ? null : "battle.skill_locked");
      this.syncBattleHudAction("defend", canUseBattleCommand, canUseBattleCommand ? null : "battle.waiting_for_actor");
      this.syncBattleHudAction("item", canUsePotion, canUsePotion ? null : "battle.item_unavailable");
      this.syncBattleHudAction("more", !commandBusy, commandBusy ? "battle.animation_locked" : null);
      this.syncBattleHudAction("active_1", canUseActive, canUseActive ? null : "battle.skill_locked");
      this.syncBattleHudAction("active_2", false, "battle.skill_slot_unavailable");
      this.syncBattleHudAction("ultimate", canUseUltimate, canUseUltimate ? null : "battle.ultimate_locked");
      this.syncBattleHudAction("retreat", canUseBattleCommand, canUseBattleCommand ? null : "battle.waiting_for_actor");
      this.syncBattleHudAction("log", false, "battle.log_unavailable");
      this.battleScene?.refreshFromStore();
      } else if (this.stateValue === "reward") {
      const title = documentValue.createElement("h1");
      title.className = "reward-title";
      title.textContent = "战斗胜利";
      ui.appendChild(title);
      const subtitle = documentValue.createElement("p");
      subtitle.className = "reward-subtitle";
      subtitle.textContent = "远征战利品 · 领取后继续冒险";
      ui.appendChild(subtitle);
      // 只投影已保存的奖励事务，不在展示阶段重掷掉落或提前领取。
      const reward = this.saveValue?.battle?.reward;
      if (reward) {
        const summary = documentValue.createElement("div");
        summary.className = "reward-currencies";
        summary.dataset.testid = "reward-currencies";
        summary.textContent = `金币 +${reward.gold} · 经验 +${reward.xp}`;
        ui.appendChild(summary);
        const loot = documentValue.createElement("section");
        loot.className = "reward-loot";
        loot.dataset.testid = "reward-loot";
        const addLoot = (name: string, detail: string, quality: string): void => {
          const card = documentValue.createElement("article");
          card.className = "reward-item";
          card.dataset.quality = quality;
          const heading = documentValue.createElement("h2");
          heading.textContent = name;
          const line = documentValue.createElement("p");
          line.textContent = detail;
          card.appendChild(heading);
          card.appendChild(line);
          loot.appendChild(card);
        };
        for (const equipment of reward.equipment) {
          const base = this.content?.getRoot().equipmentBases.find((entry) => entry.id === equipment.baseId);
          addLoot(base ? managementEquipmentName(base) : equipment.baseId, `${MANAGEMENT_QUALITY_LABELS[equipment.quality]} · 装等 ${equipment.itemLevel} · ${equipment.affixes.length} 条词条`, equipment.quality);
        }
        for (const [itemId, quantity] of Object.entries(reward.stackables)) {
          const item = this.content?.getItem(itemId);
          addLoot(item?.ok ? managementLocale(item.value.nameKey, itemId) : itemId, `数量 ×${quantity}`, "common");
        }
        for (const stone of reward.skillStones) addLoot("技能铭石", `品质 ${MANAGEMENT_QUALITY_LABELS[stone.quality]}`, stone.quality);
        if (loot.children.length === 0) addLoot("远征收获", "本次获得金币与经验，继续挑战可收集装备", "common");
        ui.appendChild(loot);
      }
      addButton("claim-reward", this.rewardClaimInFlight ? "正在保存战利品…" : "领取战利品", () => this.claimRewardFromUi(), this.rewardClaimInFlight !== null);
      if (this.rewardError) {
        const error = documentValue.createElement("p");
        error.dataset.testid = "reward-error";
        error.textContent = this.rewardError;
        ui.appendChild(error);
      }
    }
    this.appendTownModalSemanticControls(documentValue, ui);
    this.applyTitleSemanticLayout();
  }

  /** Renderer 的 pause/resume 语义状态变化需要同步透明 DOM；防止回调重入 renderUi。 */
  private handleTownModalSemanticControlsChanged(): void {
    if (this.townModalSemanticRefreshInFlight) return;
    this.townModalSemanticRefreshInFlight = true;
    try {
      if (this.stateValue === "town" && this.townModalRenderer) this.renderUi();
    } finally {
      this.townModalSemanticRefreshInFlight = false;
    }
  }

  /** 透明 DOM 只镜像当前 Pixi modal 的逻辑矩形，业务命令仍来自同一 immutable command。 */
  private appendTownModalSemanticControls(documentValue: Document, ui: HTMLElement): void {
    if (this.stateValue !== "town" || !this.townModalRenderer) return;
    const viewport = this.viewportValue;
    const renderer = this.townModalRenderer;
    for (const control of renderer.semanticControls) {
      const button = documentValue.createElement("button");
      button.type = "button";
      button.dataset.testid = control.testId;
      button.setAttribute("aria-label", control.ariaLabel);
      button.disabled = control.disabled;
      button.className = "town-modal-semantic";
      button.style.left = `${control.rect.x * viewport.scale}px`;
      button.style.top = `${control.rect.y * viewport.scale}px`;
      button.style.width = `${Math.max(48, control.rect.width * viewport.scale)}px`;
      button.style.height = `${Math.max(48, control.rect.height * viewport.scale)}px`;
      const listener = (): void => {
        // 旧 DOM 节点可能在一次 renderUi 后仍被外部保存；必须重新确认 renderer
        // 身份与当前 controls，不能让 stale command 绕过暂停/面板会话门禁。
        if (renderer !== this.townModalRenderer || !renderer.semanticControls.includes(control) || control.disabled) return;
        void this.handleTownModalCommand(control.command);
      };
      button.addEventListener("click", listener);
      this.uiUnbinds.push(() => button.removeEventListener("click", listener));
      ui.appendChild(button);
    }
  }

  private clearUi(): void {
    this.resetHeldMoveInput();
    this.autoEncounterError = null;
    this.autoEncounterFailureDiagnostics = null;
    for (const unbind of this.uiUnbinds.splice(0)) unbind();
    this.explorationPositionHud = null;
    this.flowUi?.remove();
    this.flowUi = null;
    this.managementPage = null;
    this.managementRouteDiagnostic = null;
    this.npcRouteMessage = null;
    this.merchantPanelOpen = false;
    this.merchantPanelToken += 1;
    this.merchantBuyInFlight = null;
    this.merchantBuyOfferId = null;
    this.merchantError = null;
    this.rewardClaimInFlight = null;
    this.rewardError = null;
    this.flowErrorDetail = null;
  }

  private statusText(): string {
    switch (this.stateValue) {
      case "title": return "标题：选择开始或继续";
      case "town": return "城镇：准备出发";
      case "exploration": return "野外：寻找第一个小怪";
      case "battle": return "战斗：轮到我方时使用普攻或使用药水";
      case "reward": return "战斗胜利：领取奖励";
      case "error": return "当前操作失败，请重试";
      default: return "正在加载";
    }
  }

  private safeExceptionMessage(error: unknown): string {
    return error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
  }

  /** 统一投影运行时错误；详情只允许来自受控 reason 或异常 message。 */
  private setFlowError(detail: string): void {
    this.flowErrorDetail = detail.length > 0 ? detail : "UNKNOWN_EXCEPTION";
    this.setState("error");
  }

  /** 战斗推进的领域错误附带当前阶段和固定步号，便于真实浏览器直接定位。 */
  private setBattleFlowError(reason: string, phase: BattleSnapshotV1["phase"] | null, step: number): void {
    // advanceBattleToAwait 只记录原因；由调用方在确认推进未到合法阶段后切 error，
    // 避免低层推进函数在转场中抢先覆盖场景状态。
    this.flowErrorDetail = `${reason} phase=${phase ?? "null"} step=${step}`;
  }

  private setState(state: GameFlowState): void {
    if (state !== "exploration" && this.autoEncounterSession && this.encounterInFlight === null) this.failAutoEncounterSession();
    if (state !== "exploration") {
      this.resetHeldMoveInput();
      this.autoEncounterError = null;
      this.autoEncounterFailureDiagnostics = null;
    }
    if (state !== "error") this.flowErrorDetail = null;
    else if (this.flowErrorDetail === null) this.flowErrorDetail = "UNKNOWN_EXCEPTION";
    this.stateValue = state;
    this.options.onStateChange?.(state);
    this.renderUi();
  }
}

type SaveCoordinatorRepository = {
  save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>>;
};
