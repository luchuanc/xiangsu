import type { ConsumableItemDefinition, EconomyDefinition, EquipmentInstance, EquipmentSlot, GameSaveV1, MaterialItemDefinition, ReforgePreviewV1, SkillStoneInstance } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";
import type { DisassembleResult, EquipmentService } from "../../domain/inventory/EquipmentService";
import type { FieldItemService, FieldItemUseResult } from "../../domain/inventory/FieldItemService";
import type { OpenReforgeResult, ReforgeService } from "../../domain/inventory/ReforgeService";
import { MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

export type InventoryTab = "equipment" | "skillStone" | "consumable" | "material";
export type InventoryItemKind = "equipment" | "skillStone" | "stackable";
export type InventoryItemAction = "equip" | "move" | "disassemble" | "use" | "lock" | "unlock" | "reforge";

type EquipmentServiceLike = Pick<EquipmentService, "equip" | "unequip" | "disassemble"> & Partial<Pick<EquipmentService, "disassembleEquipment">>;
type FieldItemServiceLike = Pick<FieldItemService, "preview" | "use">;
type ReforgeServiceLike = Pick<ReforgeService, "preview" | "open" | "confirm">;
type StackableDefinition = Pick<ConsumableItemDefinition, "category" | "useContexts"> | Pick<MaterialItemDefinition, "category">;

export interface InventoryScreenOptions {
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly scene?: "town" | "expedition" | "battle";
  readonly itemDefinitions?: Readonly<Record<string, StackableDefinition>>;
  readonly economy?: Readonly<EconomyDefinition>;
  readonly equipmentService?: EquipmentServiceLike;
  readonly fieldItemService?: FieldItemServiceLike;
  readonly reforgeService?: ReforgeServiceLike;
  readonly persist?: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  readonly staticMaxHp?: (save: GameSaveV1, characterId: string) => DomainResult<number>;
  readonly onStoreReplaced?: (save: Readonly<GameSaveV1>) => void;
}

export interface InventoryItemView {
  readonly id: string;
  readonly kind: InventoryItemKind;
  readonly tab: InventoryTab;
  readonly overflow: boolean;
  readonly locked: boolean;
  readonly equipped: boolean;
  readonly quantity: number;
  readonly canEquip: boolean;
  readonly actions: readonly InventoryItemAction[];
  readonly disabledReasonKey?: string | null;
}

export interface InventoryCapacityView {
  readonly equipment: number;
  readonly equipmentMax: 120;
  readonly skillStone: number;
  readonly skillStoneMax: 80;
  readonly overflow: number;
  readonly overflowMax: 30;
}

export interface InventoryEquipDraft {
  readonly instanceId: string;
  readonly characterId: string;
  readonly slot: EquipmentSlot | null;
}

export interface InventoryFieldItemDraft {
  readonly itemId: string;
  readonly targetCharacterId: string;
}

export interface InventoryScreenState {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly tab: InventoryTab;
  readonly items: readonly InventoryItemView[];
  readonly selected: InventoryItemView | null;
  readonly capacity: InventoryCapacityView;
  readonly draft: InventoryEquipDraft | InventoryFieldItemDraft | null;
  readonly reforgePreview: ReforgePreviewV1 | null;
  readonly reforgeConfirming: number | null;
}

type InventoryCommitInFlight =
  | { readonly kind: "save"; readonly promise: Promise<DomainResult<GameSaveV1>> }
  | { readonly kind: "reforge"; readonly promise: Promise<DomainResult<ReforgePreviewV1>> };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function saveFailure(): DomainResult<never> {
  return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
}

function itemTab(kind: InventoryItemKind, itemId: string, definitions?: Readonly<Record<string, StackableDefinition>>): InventoryTab {
  if (kind === "equipment") return "equipment";
  if (kind === "skillStone") return "skillStone";
  return definitions?.[itemId]?.category === "material" ? "material" : "consumable";
}

function isEquipped(save: Readonly<GameSaveV1>, instanceId: string): boolean {
  return Object.values(save.characters).some((progress) => Object.values(progress.equipmentBySlot).includes(instanceId));
}

/** 背包页只投影存档；装备/药水/重铸提交仍委托既有领域服务。 */
export class InventoryScreen {
  private readonly options: InventoryScreenOptions;
  private tabValue: InventoryTab = "equipment";
  private selectedId: string | null = null;
  private draftValue: InventoryEquipDraft | InventoryFieldItemDraft | null = null;
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;
  private reforgePreviewValue: ReforgePreviewV1 | null = null;
  private reforgeConfirmingValue: 0 | 1 | 2 | null = null;
  private requestReforgeValue: DomainResult<true> | null = null;
  private commitInFlight: InventoryCommitInFlight | null = null;

  public constructor(options: InventoryScreenOptions) {
    this.options = options;
  }

  public get state(): InventoryScreenState {
    const items = this.projectItems();
    const selected = items.find((item) => item.id === this.selectedId) ?? null;
    const status = this.statusValue === "success" && items.length === 0 ? "empty" : this.statusValue;
    return Object.freeze({
      status,
      error: this.errorValue,
      layout: MANAGEMENT_UI_METRICS,
      tab: this.tabValue,
      items: Object.freeze(items),
      selected,
      capacity: this.capacity(),
      draft: this.draftValue ? Object.freeze(clone(this.draftValue)) : null,
      reforgePreview: this.reforgePreviewValue,
      reforgeConfirming: this.reforgeConfirmingValue,
    });
  }

  public setTab(tab: InventoryTab): void {
    this.tabValue = tab;
    this.clearError();
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public showEmpty(): void {
    this.statusValue = "empty";
    this.errorValue = null;
  }

  public showDisabled(reasonKey: string): void {
    this.statusValue = "disabled";
    this.errorValue = Object.freeze({ code: reasonKey, details: null });
  }

  public selectItem(instanceOrItemId: string): DomainResult<InventoryItemView> {
    const item = this.projectItems().find((value) => value.id === instanceOrItemId);
    if (!item) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: instanceOrItemId, itemId: instanceOrItemId })));
    this.selectedId = instanceOrItemId;
    this.clearError();
    return success(item);
  }

  public previewEquip(characterId: string, slot?: EquipmentSlot): DomainResult<InventoryEquipDraft> {
    const item = this.selectedItem();
    if (!item || item.kind !== "equipment") return this.fail(invalid("inventory.selected", "equipment_required"));
    if (item.overflow) return this.fail(failure(createDomainError("INVENTORY_FULL", { kind: "equipment", requiredSlots: 1, availableSlots: 0 })));
    const draft = { instanceId: item.id, characterId, slot: slot ?? null } satisfies InventoryEquipDraft;
    this.draftValue = draft;
    this.clearError();
    return success(clone(draft));
  }

  public async confirmEquip(): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.equipmentService || !this.options.persist) return this.fail(saveFailure());
    if (!this.draftValue || !("instanceId" in this.draftValue)) return this.fail(invalid("inventory.draft", "equip_required"));
    const save = clone(this.options.currentSave());
    const equipmentService = this.options.equipmentService;
    const persist = this.options.persist;
    const draft = this.draftValue;
    return this.awaitEquipmentResult(() => equipmentService.equip(save, {
      instanceId: draft.instanceId,
      characterId: draft.characterId,
      ...(draft.slot === null ? {} : { slot: draft.slot }),
    }, {
      expectedRevision: save.revision,
      save: persist,
      ...(this.options.staticMaxHp ? { staticMaxHp: this.options.staticMaxHp } : {}),
    }));
  }

  public async confirmUnequip(characterId: string, slot: EquipmentSlot): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.equipmentService || !this.options.persist) return this.fail(saveFailure());
    const save = clone(this.options.currentSave());
    const equipmentService = this.options.equipmentService;
    const persist = this.options.persist;
    return this.awaitEquipmentResult(() => equipmentService.unequip(save, characterId, slot, {
      expectedRevision: save.revision,
      save: persist,
      ...(this.options.staticMaxHp ? { staticMaxHp: this.options.staticMaxHp } : {}),
    }));
  }

  public async toggleLock(): Promise<DomainResult<GameSaveV1>> {
    const item = this.selectedItem();
    if (!item || (item.kind !== "equipment" && item.kind !== "skillStone")) return this.fail(invalid("inventory.selected", "instance_required"));
    const save = clone(this.options.currentSave());
    const collection = item.kind === "equipment"
      ? [...save.inventory.equipment, ...save.inventory.overflowEquipment]
      : [...save.inventory.skillStones, ...save.inventory.overflowSkillStones];
    const target = collection.find((value) => value.instanceId === item.id);
    if (!target) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: item.id, itemId: null })));
    target.locked = !target.locked;
    return this.commitSave(save);
  }

  public async disassemble(): Promise<DomainResult<GameSaveV1>> {
    const item = this.selectedItem();
    if (!item || (item.kind !== "equipment" && item.kind !== "skillStone")) return this.fail(invalid("inventory.selected", "instance_required"));
    const save = clone(this.options.currentSave());
    if (!item.overflow && this.options.equipmentService && item.kind === "equipment" && this.options.persist) {
      const equipmentService = this.options.equipmentService;
      const persist = this.options.persist;
      return this.awaitDisassembleResult(() => equipmentService.disassembleEquipment
        ? equipmentService.disassembleEquipment(save, item.id, { expectedRevision: save.revision, save: persist })
        : equipmentService.disassemble(save, item.id, { expectedRevision: save.revision, save: persist }));
    }
    return this.disassembleOverflow(save, item);
  }

  public async moveOverflowToInventory(): Promise<DomainResult<GameSaveV1>> {
    const item = this.selectedItem();
    if (!item || !item.overflow || (item.kind !== "equipment" && item.kind !== "skillStone")) return this.fail(invalid("inventory.selected", "overflow_instance_required"));
    const save = clone(this.options.currentSave());
    const source = item.kind === "equipment" ? save.inventory.overflowEquipment : save.inventory.overflowSkillStones;
    const target = item.kind === "equipment" ? save.inventory.equipment : save.inventory.skillStones;
    const index = source.findIndex((value) => value.instanceId === item.id);
    const capacity = item.kind === "equipment" ? 120 : 80;
    if (index < 0) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: item.id, itemId: null })));
    if (target.length >= capacity) return this.fail(failure(createDomainError("INVENTORY_FULL", { kind: item.kind, requiredSlots: 1, availableSlots: 0 })));
    if (item.kind === "equipment") {
      save.inventory.equipment.push(save.inventory.overflowEquipment[index]!);
      save.inventory.overflowEquipment.splice(index, 1);
    } else {
      save.inventory.skillStones.push(save.inventory.overflowSkillStones[index]!);
      save.inventory.overflowSkillStones.splice(index, 1);
    }
    return this.commitSave(save);
  }

  public previewFieldItem(itemId: string, targetCharacterId: string): DomainResult<{ powerBps: number; maxHp: number; healed: number }> {
    if (this.options.scene === "battle") return this.fail(failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId, reason: "BATTLE_ACTIVE" })));
    if (!this.options.fieldItemService) return this.fail(invalid("fieldItemService", "required"));
    this.draftValue = { itemId, targetCharacterId };
    const save = clone(this.options.currentSave());
    const result = this.options.fieldItemService.preview(save, { expectedRevision: save.revision, itemId, targetCharacterId }, this.options.staticMaxHp);
    if (!result.ok) { this.setError(result.error); return result; }
    this.clearError();
    return result;
  }

  public async useFieldItem(): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.fieldItemService || !this.options.persist) return this.fail(saveFailure());
    if (!this.draftValue || !("itemId" in this.draftValue)) return this.fail(invalid("inventory.draft", "field_item_required"));
    if (this.options.scene === "battle") return this.fail(failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: this.draftValue.itemId, reason: "BATTLE_ACTIVE" })));
    const save = clone(this.options.currentSave());
    const fieldItemService = this.options.fieldItemService;
    const persist = this.options.persist;
    const draft = this.draftValue;
    return this.awaitFieldResult(() => fieldItemService.use(save, { expectedRevision: save.revision, itemId: draft.itemId, targetCharacterId: draft.targetCharacterId }, { save: persist, ...(this.options.staticMaxHp ? { staticMaxHp: this.options.staticMaxHp } : {}) }));
  }

  public battleItemState(itemId: string): { enabled: false; reasonKey: "inventory.battle_item_command_only" } {
    void itemId;
    return Object.freeze({ enabled: false, reasonKey: "inventory.battle_item_command_only" });
  }

  public previewReforge(requestedIndex: number): DomainResult<ReforgePreviewV1> {
    const item = this.selectedItem();
    if (!item || item.kind !== "equipment" || item.overflow) return this.fail(invalid("inventory.selected", "reforge_equipment_required"));
    if (!this.options.reforgeService) return this.fail(invalid("reforgeService", "required"));
    const save = clone(this.options.currentSave());
    const result = this.options.reforgeService.preview(save, { expectedSaveRevision: save.revision, itemKind: "equipment", instanceId: item.id, requestedIndex });
    if (result.ok) { this.reforgePreviewValue = result.value; this.clearError(); }
    else this.setError(result.error);
    return result;
  }

  public async openReforge(requestedIndex: number): Promise<DomainResult<ReforgePreviewV1>> {
    const item = this.selectedItem();
    if (!item || item.kind !== "equipment" || item.overflow) return this.fail(invalid("inventory.selected", "reforge_equipment_required"));
    if (!this.options.reforgeService || !this.options.persist) return this.fail(saveFailure());
    const save = clone(this.options.currentSave());
    const reforgeService = this.options.reforgeService;
    const persist = this.options.persist;
    return this.awaitReforgeResult(() => reforgeService.open(save, { expectedSaveRevision: save.revision, itemKind: "equipment", instanceId: item.id, requestedIndex }, { save: persist }));
  }

  /** 第一次点击只锁定候选；同一 tick 的重复点击复用同一结果，不会扣料。 */
  public requestReforge(candidateIndex: 0 | 1 | 2): DomainResult<true> {
    if (!this.reforgePreviewValue) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: 0, actualReforgeCount: 0 })));
    if (!this.reforgePreviewValue.candidates.some((candidate) => candidate.candidateIndex === candidateIndex)) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: this.reforgePreviewValue.reforgeCount, actualReforgeCount: this.reforgePreviewValue.reforgeCount })));
    this.reforgeConfirmingValue = candidateIndex;
    this.requestReforgeValue ??= success(true);
    return this.requestReforgeValue;
  }

  public confirmReforge(): Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1> {
    if (this.reforgeConfirmingValue === null || this.reforgePreviewValue === null) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: 0, actualReforgeCount: 0 })));
    if (!this.options.reforgeService || !this.options.persist) return this.fail(saveFailure());
    const save = clone(this.options.currentSave());
    const preview = this.reforgePreviewValue;
    const candidateIndex = this.reforgeConfirmingValue;
    if (candidateIndex === null) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview.reforgeCount, actualReforgeCount: preview.reforgeCount })));
    const reforgeService = this.options.reforgeService;
    const persist = this.options.persist;
    return this.awaitGameSave(() => reforgeService.confirm(save, {
      expectedSaveRevision: save.revision,
      itemKind: preview.itemKind,
      instanceId: preview.instanceId,
      expectedLockedIndex: preview.lockedIndex,
      expectedReforgeCount: preview.reforgeCount,
      candidateIndex,
    }, { save: persist }), () => { this.reforgePreviewValue = null; this.reforgeConfirmingValue = null; this.requestReforgeValue = null; });
  }

  public previewBatchDisassemble(instanceIds: readonly string[]): readonly string[] {
    const save = this.options.currentSave();
    const allowed = new Set<string>();
    for (const id of instanceIds) {
      const instance = [...save.inventory.equipment, ...save.inventory.overflowEquipment].find((value) => value.instanceId === id);
      if (!instance || instance.locked || isEquipped(save, id)) continue;
      allowed.add(id);
    }
    return Object.freeze([...allowed]);
  }

  private selectedItem(): InventoryItemView | null {
    return this.projectItems().find((item) => item.id === this.selectedId) ?? null;
  }

  private projectItems(): InventoryItemView[] {
    const save = this.options.currentSave();
    const items: InventoryItemView[] = [];
    const addInstance = (value: EquipmentInstance | SkillStoneInstance, kind: "equipment" | "skillStone", overflow: boolean): void => {
      const tab = itemTab(kind, value.instanceId, this.options.itemDefinitions);
      if (tab !== this.tabValue && !(this.tabValue === "equipment" && kind === "equipment") && !(this.tabValue === "skillStone" && kind === "skillStone")) return;
      const equipped = kind === "equipment" && isEquipped(save, value.instanceId);
      const actions: InventoryItemAction[] = [];
      if (!overflow) actions.push("equip");
      else actions.push("move");
      actions.push("disassemble", value.locked ? "unlock" : "lock");
      if (!overflow && kind === "equipment") actions.push("reforge");
      items.push({ id: value.instanceId, kind, tab, overflow, locked: value.locked, equipped, quantity: 1, canEquip: kind === "equipment" && !overflow, actions: Object.freeze(actions) });
    };
    for (const value of save.inventory.equipment) addInstance(value, "equipment", false);
    for (const value of save.inventory.skillStones) addInstance(value, "skillStone", false);
    for (const [itemId, quantity] of Object.entries(save.inventory.stackables)) {
      if (quantity <= 0) continue;
      const tab = itemTab("stackable", itemId, this.options.itemDefinitions);
      if (tab !== this.tabValue) continue;
      const definition = this.options.itemDefinitions?.[itemId];
      const canUse = this.options.scene !== "battle"
        && definition?.category === "consumable"
        && (definition.useContexts?.includes("field") ?? false);
      const battleItem = this.options.scene === "battle"
        && definition?.category === "consumable"
        && (definition.useContexts?.includes("battle") ?? false);
      items.push({ id: itemId, kind: "stackable", tab, overflow: false, locked: false, equipped: false, quantity, canEquip: false, actions: Object.freeze(canUse ? ["use"] : []), disabledReasonKey: battleItem ? "inventory.battle_item_command_only" : null });
    }
    for (const value of save.inventory.overflowEquipment) addInstance(value, "equipment", true);
    for (const value of save.inventory.overflowSkillStones) addInstance(value, "skillStone", true);
    return items;
  }

  private capacity(): InventoryCapacityView {
    const inventory = this.options.currentSave().inventory;
    return Object.freeze({ equipment: inventory.equipment.length, equipmentMax: 120, skillStone: inventory.skillStones.length, skillStoneMax: 80, overflow: inventory.overflowEquipment.length + inventory.overflowSkillStones.length, overflowMax: 30 });
  }

  private async disassembleOverflow(save: GameSaveV1, item: InventoryItemView): Promise<DomainResult<GameSaveV1>> {
    const source = item.kind === "equipment" ? save.inventory.overflowEquipment : save.inventory.overflowSkillStones;
    const index = source.findIndex((value) => value.instanceId === item.id);
    if (index < 0) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: item.id, itemId: null })));
    const target = source[index]!;
    if (target.locked) return this.fail(failure(createDomainError("ITEM_LOCKED", { instanceId: item.id })));
    if (item.kind === "equipment" && isEquipped(save, item.id)) return this.fail(failure(createDomainError("ITEM_EQUIPPED", { instanceId: item.id })));
    if (!this.options.economy) return this.fail(invalid("economy", "getter_required"));
    const materialId = item.kind === "equipment" ? this.options.economy.equipmentDisassembleMaterialItemId : this.options.economy.skillStoneDisassembleMaterialItemId;
    const yieldQuantity = item.kind === "equipment"
      ? this.options.economy.equipmentDisassembleYieldByQuality[target.quality]
      : this.options.economy.skillStoneDisassembleYieldByQuality[target.quality as "magic" | "rare" | "epic" | "abyss"];
    const owned = save.inventory.stackables[materialId] ?? 0;
    if (owned > 9999 - yieldQuantity) return this.fail(failure(createDomainError("STACKABLE_CAP_EXCEEDED", { itemId: materialId, cap: 9999, owned, requested: yieldQuantity })));
    source.splice(index, 1);
    save.inventory.stackables[materialId] = owned + yieldQuantity;
    return this.commitSave(save);
  }

  private async awaitEquipmentResult(start: () => Promise<DomainResult<GameSaveV1>>): Promise<DomainResult<GameSaveV1>> {
    return this.awaitGameSave(start, () => { this.draftValue = null; });
  }

  private async awaitDisassembleResult(start: () => Promise<DomainResult<DisassembleResult>>): Promise<DomainResult<GameSaveV1>> {
    return this.awaitMappedSave(start, (value) => value.save, () => { this.draftValue = null; });
  }

  private async awaitFieldResult(start: () => Promise<DomainResult<FieldItemUseResult>>): Promise<DomainResult<GameSaveV1>> {
    return this.awaitMappedSave(start, (value) => value.save, () => { this.draftValue = null; });
  }

  private async awaitReforgeResult(start: () => Promise<DomainResult<OpenReforgeResult>>): Promise<DomainResult<ReforgePreviewV1>> {
    const inFlight = this.commitInFlight;
    if (inFlight !== null) {
      if (inFlight.kind === "reforge") return inFlight.promise;
      return Promise.resolve(this.fail(saveFailure()));
    }
    let resolveOperation!: (result: DomainResult<ReforgePreviewV1>) => void;
    const operation = new Promise<DomainResult<ReforgePreviewV1>>((resolve) => { resolveOperation = resolve; });
    this.commitInFlight = { kind: "reforge", promise: operation };
    void (async () => {
      try {
        const value = await start();
        if (!value.ok) { resolveOperation(this.fail(failure(value.error))); return; }
        this.reforgePreviewValue = value.value.preview;
        this.applySave(value.value.save);
        this.clearError();
        resolveOperation(success(value.value.preview));
      } catch {
        resolveOperation(this.fail(saveFailure()));
      }
    })();
    void operation.then(() => {
      if (this.commitInFlight?.kind === "reforge" && this.commitInFlight.promise === operation) this.commitInFlight = null;
    });
    return operation;
  }

  private awaitGameSave(start: () => Promise<DomainResult<GameSaveV1>>, onSuccess: () => void = () => undefined): Promise<DomainResult<GameSaveV1>> {
    return this.awaitMappedSave(start, (value) => value, onSuccess);
  }

  /** 显式适配各领域结果中的保存快照，禁止通过未知 payload 猜测字段。 */
  private awaitMappedSave<T>(start: () => Promise<DomainResult<T>>, getSave: (value: T) => GameSaveV1, onSuccess: () => void = () => undefined): Promise<DomainResult<GameSaveV1>> {
    const inFlight = this.commitInFlight;
    if (inFlight !== null) {
      if (inFlight.kind === "save") return inFlight.promise;
      return Promise.resolve(this.fail(saveFailure()));
    }
    let resolveOperation!: (result: DomainResult<GameSaveV1>) => void;
    const operation = new Promise<DomainResult<GameSaveV1>>((resolve) => { resolveOperation = resolve; });
    this.commitInFlight = { kind: "save", promise: operation };
    void (async () => {
      try {
        const value = await start();
        if (!value.ok) { resolveOperation(this.fail(failure(value.error))); return; }
        const save = getSave(value.value);
        this.applySave(save);
        onSuccess();
        resolveOperation(success(save));
      } catch {
        resolveOperation(this.fail(saveFailure()));
      }
    })();
    void operation.then(() => {
      if (this.commitInFlight?.kind === "save" && this.commitInFlight.promise === operation) this.commitInFlight = null;
    });
    return operation;
  }

  private async commitSave(save: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.persist) return this.fail(saveFailure());
    const persist = this.options.persist;
    return this.awaitGameSave(() => Promise.resolve().then(() => persist(save.revision, save)), () => { this.draftValue = null; });
  }

  private applySave(save: GameSaveV1): void {
    this.statusValue = "success";
    this.errorValue = null;
    this.options.onStoreReplaced?.(save);
  }

  private clearError(): void {
    this.statusValue = "success";
    this.errorValue = null;
  }

  private setError(error: { code: string; details: unknown }): void {
    this.statusValue = "error";
    this.errorValue = Object.freeze({ code: error.code, details: structuredClone(error.details) });
  }

  private fail<T>(result: DomainResult<T>): DomainResult<T> {
    if (!result.ok) this.setError(result.error);
    return result;
  }
}
