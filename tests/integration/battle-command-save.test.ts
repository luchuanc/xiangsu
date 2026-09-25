import { describe, expect, it } from "vitest";

import { fixtureContentRoot } from "../../src/content/data";
import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import { ContentCatalog } from "../../src/content/Catalog";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { SaveCoordinator, type SaveRepositoryWriter } from "../../src/app/SaveCoordinator";
import { GameStore } from "../../src/app/GameStore";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { failure, createDomainError, success, type DomainResult } from "../../src/domain/common/DomainResult";
import type { BattleDomainEventV1, BattleSnapshotV1, BattleUnitStateV1, CharacterDefinition, ComboDefinition, ConsumableItemDefinition, ContentRootV1, EnemyDefinition, EncounterDefinition, EquipmentAffixDefinition, EquipmentInstance, GameSaveV1, SkillDefinition, StatBlock, StackableItemDefinition } from "../../src/content/contracts";
import { BattleCommandGateway } from "../../src/app/BattleCommandGateway";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { decideEnemyAction } from "../../src/domain/battle/EnemyAi";

class Repository implements SaveRepositoryWriter {
  public fail = false;
  public calls: Array<{ expectedRevision: number; save: GameSaveV1 }> = [];
  public async save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    this.calls.push({ expectedRevision, save: structuredClone(nextSave) });
    if (this.fail) return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    return success({ ...structuredClone(nextSave), revision: expectedRevision + 1 });
  }
}

class RaceStore extends GameStore {
  private reads = 0;
  public constructor(initial: GameSaveV1, private readonly changed: GameSaveV1) {
    super(initial);
  }

  public override getSnapshot(): ReturnType<GameStore["getSnapshot"]> {
    this.reads += 1;
    return this.reads === 1 ? super.getSnapshot() : structuredClone(this.changed) as ReturnType<GameStore["getSnapshot"]>;
  }
}

describe("BattleCommandGateway save boundary", () => {
  it("SaveCoordinator failure does not publish events or mutate Store", async () => {
    const initial = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
    const store = new GameStore(initial);
    const repository = new Repository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const candidate = coordinator.createCandidate("battle", { ...initial, gold: initial.gold + 1 }, { events: [{ type: "ACTION_STARTED" }], command: { type: "USE_BASIC" } });
    const result = await coordinator.submit(candidate);
    expect(result.ok).toBe(false);
    expect(result.events).toEqual([]);
    expect(store.getSnapshot()).toEqual(initial);
    expect(coordinator.pendingCandidates).toHaveLength(1);
  });

  it("retries the same candidate without publishing events or consuming RNG twice", async () => {
    const initial = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
    const stat: StatBlock = { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0], id: "skill_gateway_basic", kind: "basic", owner: { kind: "character", characterId: "char_wanderer" },
      targetRule: "singleEnemy", requiresFrontAccess: false,
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const character: CharacterDefinition = { ...fixtureContentRoot.characters[0], id: "char_wanderer", basicSkillId: basic.id };
    const enemy: EnemyDefinition = { id: "enemy_gateway", nameKey: "enemy", level: 1, stats: stat, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent", skillIds: [], aiRules: [], spriteId: "enemy" };
    const encounter: EncounterDefinition = { id: "enc_gateway", kind: "normal", fieldSpriteId: "enc", enemyIdsBySlot: [enemy.id], xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_none", canRetreat: true, modifierIds: [] };
    const unit = (unitId: string, faction: "party" | "enemy", hp: number): BattleUnitStateV1 => ({ unitId, definitionId: faction === "party" ? character.id : enemy.id, faction, slot: 0, level: 1, prePercentStats: { ...stat }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { ...stat }, currentHp: hp, energy: 0, cooldowns: { [basic.id]: 0 }, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] });
    const battle: BattleSnapshotV1 = { battleId: "battle_gateway", expeditionId: "exp_gateway", battleRevision: 0, encounterId: encounter.id, encounterObjectId: "object_gateway", phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units: [unit("party:0", "party", 100), unit("enemy:0", "enemy", 100)], initiativeQueueUnitIds: [], currentUnitId: "party:0", pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 }, reward: null, returnMapId: "map_gateway", returnSafePosition: { x: 0, y: 0 } };
    initial.battle = battle;
    const store = new GameStore(initial);
    const repository = new Repository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const content = {
      getCharacter: (id: string) => id === character.id ? success(character) : failure(createDomainError("INVALID_CONTENT", { path: "character", issueKey: "missing" })),
      getSkill: (id: string) => id === basic.id ? success(basic) : failure(createDomainError("INVALID_CONTENT", { path: "skill", issueKey: "missing" })),
      getEnemy: (id: string) => id === enemy.id ? success(enemy) : failure(createDomainError("INVALID_CONTENT", { path: "enemy", issueKey: "missing" })),
      getEncounter: (id: string) => id === encounter.id ? success(encounter) : failure(createDomainError("INVALID_CONTENT", { path: "encounter", issueKey: "missing" })),
    };
    let eventIndex = 0;
    const gateway = new BattleCommandGateway({ store, coordinator, content, nextId: (kind) => `${kind}_gateway_${eventIndex++}` });
    const command = { type: "USE_BASIC" as const, expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] };
    const before = store.getSnapshot();
    const failed = await gateway.execute(command);
    expect(failed.ok).toBe(false);
    expect(failed.events).toEqual([]);
    expect(store.getSnapshot()).toEqual(before);
    if (failed.ok || !failed.candidateId) throw new Error("expected a retryable candidate");
    expect(store.getSnapshot().battle?.rngState).toEqual([1, 2, 3, 4]);

    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("expected retry success");
    expect(retried.events.length).toBeGreaterThan(0);
    expect(store.getSnapshot().battle?.battleRevision).toBe(1);
    expect(store.getSnapshot().battle?.rngState).not.toEqual([1, 2, 3, 4]);
    expect(repository.calls).toHaveLength(2);
    // 旧快照没有被 gateway 的临时 RNG 直接写入。
    expect(before.battle?.rngState).toEqual([1, 2, 3, 4]);

    const defaultStoreA = new GameStore(initial);
    const defaultRepositoryA = new Repository();
    const defaultCoordinatorA = new SaveCoordinator({ store: defaultStoreA, repository: defaultRepositoryA, idFactory: new SequentialIdFactory() });
    const defaultA = await new BattleCommandGateway({ store: defaultStoreA, coordinator: defaultCoordinatorA, content }).execute(command);
    const defaultStoreB = new GameStore(initial);
    const defaultRepositoryB = new Repository();
    const defaultCoordinatorB = new SaveCoordinator({ store: defaultStoreB, repository: defaultRepositoryB, idFactory: new SequentialIdFactory() });
    const defaultB = await new BattleCommandGateway({ store: defaultStoreB, coordinator: defaultCoordinatorB, content }).execute(command);
    expect(defaultA.ok).toBe(true);
    expect(defaultB.ok).toBe(true);
    if (defaultA.ok && defaultB.ok) {
      const productionIdPattern = /^(root|event)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(defaultA.value.events[0]?.rootActionId).toMatch(productionIdPattern);
      expect(defaultA.value.events[0]?.eventId).toMatch(productionIdPattern);
      expect(defaultA.value.events[0]?.rootActionId).not.toBe(defaultB.value.events[0]?.rootActionId);
      expect(defaultA.value.events.map((event) => event.eventId)).not.toEqual(defaultB.value.events.map((event) => event.eventId));
    }

    const changed = structuredClone(initial);
    if (!changed.battle) throw new Error("expected battle fixture");
    changed.battle = { ...changed.battle, battleRevision: changed.battle.battleRevision + 1 };
    const raceStore = new RaceStore(initial, changed);
    const raceRepository = new Repository();
    const raceCoordinator = new SaveCoordinator({ store: raceStore, repository: raceRepository, idFactory: new SequentialIdFactory() });
    const stale = await new BattleCommandGateway({ store: raceStore, coordinator: raceCoordinator, content, nextId: (kind) => `${kind}_race` }).execute(command);
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_BATTLE_REVISION" }, events: [] });
    expect(raceRepository.calls).toHaveLength(0);

    const battleItem: ConsumableItemDefinition = {
      id: "item_gateway_battle_energy",
      nameKey: "item.gateway.battle_energy",
      category: "consumable",
      maxStack: 99,
      baseGoldValue: 1,
      iconId: "item_gateway_battle_energy",
      useContexts: ["battle"],
      targetRule: "self",
      effects: [{ kind: "changeEnergy", targetRule: "self", amount: 5 }],
    };
    const itemContent = {
      ...content,
      getItem: (id: string) => id === battleItem.id
        ? success(battleItem)
        : failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: id })),
    };
    const itemInitial = structuredClone(initial);
    itemInitial.inventory.stackables[battleItem.id] = 1;
    const itemStore = new GameStore(itemInitial);
    const itemRepository = new Repository();
    const itemCoordinator = new SaveCoordinator({ store: itemStore, repository: itemRepository, idFactory: new SequentialIdFactory() });
    const itemResult = await new BattleCommandGateway({ store: itemStore, coordinator: itemCoordinator, content: itemContent, nextId: (kind) => `${kind}_item_success` }).execute({
      type: "USE_ITEM",
      expectedBattleRevision: 0,
      actorUnitId: "party:0",
      itemId: battleItem.id,
      targetUnitIds: [],
    });
    expect(itemResult.ok).toBe(true);
    if (!itemResult.ok) throw new Error("expected battle item save success");
    expect(itemResult.save.inventory.stackables[battleItem.id]).toBe(0);
    expect(itemResult.save.battle?.successfulItemUses).toBe(1);

    const failedItemStore = new GameStore(itemInitial);
    const failedItemRepository = new Repository();
    failedItemRepository.fail = true;
    const failedItemCoordinator = new SaveCoordinator({ store: failedItemStore, repository: failedItemRepository, idFactory: new SequentialIdFactory() });
    const failedItem = await new BattleCommandGateway({ store: failedItemStore, coordinator: failedItemCoordinator, content: itemContent, nextId: (kind) => `${kind}_item_failure` }).execute({
      type: "USE_ITEM",
      expectedBattleRevision: 0,
      actorUnitId: "party:0",
      itemId: battleItem.id,
      targetUnitIds: [],
    });
    expect(failedItem).toMatchObject({ ok: false, events: [] });
    expect(failedItemStore.getSnapshot().inventory.stackables[battleItem.id]).toBe(1);
    expect(failedItemStore.getSnapshot().battle?.successfulItemUses).toBe(0);

    void (content as { getItem?: (id: string) => DomainResult<Readonly<StackableItemDefinition>> });
    void SeededRng;
  });

  it("保存失败重试复用同一动态 loadout 视图，不重新读取装备词条", async () => {
    const initial = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
    const stat: StatBlock = { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0], id: "skill_gateway_loadout_basic", kind: "basic", owner: { kind: "character", characterId: "char_wanderer" },
      targetRule: "singleEnemy", requiresFrontAccess: false,
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const passive: SkillDefinition = { ...fixtureContentRoot.skills[6], id: "skill_gateway_loadout_passive", owner: { kind: "character", characterId: "char_wanderer" }, passiveModifiers: [] };
    const character: CharacterDefinition = { ...fixtureContentRoot.characters[0], basicSkillId: basic.id, passiveSkillId: passive.id };
    const enemy: EnemyDefinition = { id: "enemy_gateway_loadout", nameKey: "enemy", level: 1, stats: stat, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent", skillIds: [], aiRules: [], spriteId: "enemy" };
    const encounter: EncounterDefinition = { id: "enc_gateway_loadout", kind: "normal", fieldSpriteId: "enc", enemyIdsBySlot: [enemy.id], xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_none", canRetreat: true, modifierIds: [] };
    const unit = (unitId: string, faction: "party" | "enemy", hp: number): BattleUnitStateV1 => ({ unitId, definitionId: faction === "party" ? character.id : enemy.id, faction, slot: 0, level: 1, prePercentStats: { ...stat }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { ...stat }, currentHp: hp, energy: 0, cooldowns: { [basic.id]: 0 }, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] });
    initial.characters[character.id] = { ...initial.characters[character.id], characterId: character.id, equipmentBySlot: { ...initial.characters[character.id].equipmentBySlot } };
    const equipment: EquipmentInstance = {
      instanceId: "eq_gateway_loadout",
      baseId: "eq_gateway_base",
      itemLevel: 1,
      quality: "common",
      craftGrade: "ordinary",
      affixes: [{ affixId: "affix_gateway_loadout", tier: 1, roll: 10_000, craftEmpowered: false, reforged: false }],
      abyssAffix: null,
      locked: false,
      acquiredAt: "2026-08-24T00:00:00.000Z",
      sourceTransactionId: "tx_gateway_loadout",
      reforgeLockedIndex: null,
      reforgeCount: 0,
    };
    initial.characters[character.id].equipmentBySlot.weapon = equipment.instanceId;
    initial.inventory.equipment.push(equipment);
    initial.battle = { battleId: "battle_gateway_loadout", expeditionId: "exp_gateway_loadout", battleRevision: 0, encounterId: encounter.id, encounterObjectId: "object_gateway_loadout", phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units: [unit("party:0", "party", 100), unit("enemy:0", "enemy", 100)], initiativeQueueUnitIds: [], currentUnitId: "party:0", pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 }, reward: null, returnMapId: "map_gateway_loadout", returnSafePosition: { x: 0, y: 0 } };
    let equipmentGetterCalls = 0;
    let rollScaleBps = 10_000;
    const affix = (): EquipmentAffixDefinition => ({ id: "affix_gateway_loadout", nameKey: "affix.gateway", descriptionKey: "affix.gateway", category: "damageType", pool: "normal", allowedSlots: ["weapon"], allowedWeaponTypes: ["sword"], minItemLevel: 1, allowedQualities: ["common"], exclusiveGroup: null, stackRule: "add", weight: 1, goldValue: 1, canBeCraftEmpowered: false, tiers: [{ tier: 1, minItemLevel: 1, rollMin: 0, rollMax: 10_000 }], modifiers: [{ kind: "damageBonus", element: "all", rollScaleBps }], tags: [] });
    const content = {
      getCharacter: (id: string) => id === character.id ? success(character) : failure(createDomainError("INVALID_CONTENT", { path: "character", issueKey: "missing" })),
      getSkill: (id: string) => id === basic.id ? success(basic) : id === passive.id ? success(passive) : failure(createDomainError("INVALID_CONTENT", { path: "skill", issueKey: "missing" })),
      getEnemy: (id: string) => id === enemy.id ? success(enemy) : failure(createDomainError("INVALID_CONTENT", { path: "enemy", issueKey: "missing" })),
      getEncounter: (id: string) => id === encounter.id ? success(encounter) : failure(createDomainError("INVALID_CONTENT", { path: "encounter", issueKey: "missing" })),
      getEquipmentAffix: (id: string) => { equipmentGetterCalls += 1; return id === "affix_gateway_loadout" ? success(affix()) : failure(createDomainError("INVALID_CONTENT", { path: "equipmentAffix", issueKey: "missing" })); },
    };
    const store = new GameStore(initial);
    const repository = new Repository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const gateway = new BattleCommandGateway({ store, coordinator, content, nextId: (kind) => `${kind}_gateway_loadout` });
    const command = { type: "USE_BASIC" as const, expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] };
    const failed = await gateway.execute(command);
    expect(failed.ok).toBe(false);
    if (failed.ok || !failed.candidateId) throw new Error("expected retryable loadout candidate");
    const failedDamage = failed.candidateId && coordinator.pendingCandidates[0]?.events.find((event): event is BattleDomainEventV1 => typeof event === "object" && event !== null && (event as { readonly type?: unknown }).type === "DAMAGE_RESOLVED");
    const callsAfterBuild = equipmentGetterCalls;
    expect(callsAfterBuild).toBeGreaterThan(0);
    rollScaleBps = 0;
    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    const retriedDamage = retried.events.find((event) => event.type === "DAMAGE_RESOLVED");
    expect(retriedDamage).toEqual(failedDamage);
    expect(equipmentGetterCalls).toBe(callsAfterBuild);
  });

  it("Gateway 使用正式 root 匹配 Combo，保存失败重试复用同一根行动事件", async () => {
    const root = structuredClone(abyssEchoContentRoot) as ContentRootV1;
    const baseCharacter = root.characters.find((value) => value.id === root.protagonistCharacterId);
    if (!baseCharacter) throw new Error("missing protagonist");
    const basicId = "skill_gateway_combo_basic";
    const basic: SkillDefinition = {
      ...root.skills.find((value) => value.id === baseCharacter.basicSkillId)!,
      id: basicId,
      owner: { kind: "character", characterId: baseCharacter.id },
      kind: "basic",
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const character: CharacterDefinition = { ...baseCharacter, basicSkillId: basicId };
    const innateTag = character.innateTags[0]?.tagId;
    if (!innateTag) throw new Error("missing innate tag");
    const combo: ComboDefinition = {
      ...root.combos[0],
      id: "combo_gateway_runtime",
      scope: "personal",
      requirements: [{ source: "innate", tagId: innateTag, count: 1 }],
      trigger: { event: "afterDirectHit", requiredSkillKinds: [], requiredHitResult: "any", requiredSourceHpAtMostBps: null, requiredTargetHpAtMostBps: null, requiredSourceStatusIds: [], requiredTargetStatusIds: [], consumeTargetStatus: null },
      effects: [{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }],
      budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    };
    root.characters = root.characters.map((value) => value.id === character.id ? character : value);
    root.skills = [...root.skills, basic];
    root.combos = [...root.combos, combo];
    const initial = createNewGameSave(root, "2026-08-26T00:00:00.000Z", { newGameSeed: 2, idFactory: new SequentialIdFactory() });
    const enemy: EnemyDefinition = { id: "enemy_gateway_combo", nameKey: "enemy.gateway.combo", level: 1, stats: { maxHp: 1_000, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 }, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basicId, basicTargetStrategy: "frontFirstOpponent", skillIds: [], aiRules: [], spriteId: "enemy" };
    const encounter: EncounterDefinition = { id: "enc_gateway_combo", kind: "normal", fieldSpriteId: "enc", enemyIdsBySlot: [enemy.id], xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_none", canRetreat: true, modifierIds: [] };
    const stat: StatBlock = { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };
    const partyUnit: BattleUnitStateV1 = { unitId: "party:0", definitionId: character.id, faction: "party", slot: 0, level: 1, prePercentStats: { ...stat }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { ...stat }, currentHp: 100, energy: 0, cooldowns: { [basicId]: 0 }, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] };
    const enemyUnit: BattleUnitStateV1 = { ...partyUnit, unitId: "enemy:0", definitionId: enemy.id, faction: "enemy", stats: { ...enemy.stats }, prePercentStats: { ...enemy.stats }, currentHp: enemy.stats.maxHp, cooldowns: {} };
    initial.expedition = { expeditionId: "exp_gateway_combo", expeditionSeed: 2, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_town", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-08-26T00:00:00.000Z" };
    initial.battle = { battleId: "battle_gateway_combo", expeditionId: "exp_gateway_combo", battleRevision: 0, encounterId: encounter.id, encounterObjectId: "object_gateway_combo", phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units: [partyUnit, enemyUnit], initiativeQueueUnitIds: [], currentUnitId: partyUnit.unitId, pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 }, reward: null, returnMapId: "map_town", returnSafePosition: { x: 0, y: 0 } };
    const byId = <T extends { id: string }>(values: readonly T[], id: string): DomainResult<Readonly<T>> => {
      const value = values.find((entry) => entry.id === id);
      return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: id, issueKey: "missing" }));
    };
    const content = {
      getRoot: () => root,
      getCharacter: (id: string) => byId(root.characters, id),
      getSkill: (id: string) => byId(root.skills, id),
      getEnemy: (id: string) => id === enemy.id ? success(enemy) : failure(createDomainError("INVALID_CONTENT", { path: id, issueKey: "missing" })),
      getEncounter: (id: string) => id === encounter.id ? success(encounter) : failure(createDomainError("INVALID_CONTENT", { path: id, issueKey: "missing" })),
      getEquipmentBase: (id: string) => byId(root.equipmentBases, id),
      getEquipmentAffix: (id: string) => byId(root.equipmentAffixes, id),
      getSkillAffix: (id: string) => byId(root.skillAffixes, id),
      getCombo: (id: string) => byId(root.combos, id),
    };
    const store = new GameStore(initial);
    const repository = new Repository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    let id = 0;
    const gateway = new BattleCommandGateway({ store, coordinator, content, nextId: (kind) => `${kind}_gateway_combo_${id++}` });
    const command = { type: "USE_BASIC" as const, expectedBattleRevision: 0, actorUnitId: partyUnit.unitId, targetUnitIds: [enemyUnit.unitId] };
    const before = store.getSnapshot();
    const failed = await gateway.execute(command);
    expect(failed).toMatchObject({ ok: false, events: [] });
    expect(store.getSnapshot()).toEqual(before);
    if (failed.ok || !failed.candidateId) throw new Error("expected retryable combo candidate");
    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.events.map((event) => event.type)).toContain("COMBO_TRIGGERED");
    expect(retried.events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(2);
    expect(retried.value.snapshot.firedComboKeys.some((key) => key.includes("combo_gateway_runtime"))).toBe(true);
    expect(retried.value.snapshot.metrics.comboTriggerCounts.combo_gateway_runtime).toBe(1);
  });

  it("控制跳过复用正式 Combo adapter，并在保存失败后原子重试同一候选", async () => {
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    if (!catalogResult.ok) throw new Error("正式内容目录创建失败");
    const catalog = catalogResult.value;
    const protagonistId = abyssEchoContentRoot.protagonistCharacterId;
    const enemyResult = catalog.getEnemy("enemy_goblin_scout");
    if (!enemyResult.ok) throw new Error("缺少控制跳过敌人");
    const enemy = enemyResult.value;
    const stat: StatBlock = { maxHp: 100, attack: 100, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };
    const partyUnit: BattleUnitStateV1 = {
      unitId: "party:0", definitionId: protagonistId, faction: "party", slot: 0, level: 1,
      prePercentStats: { ...stat }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
      stats: { ...stat }, currentHp: 100, energy: 0, cooldowns: {}, statuses: [{
        stackId: "freeze:gateway", statusId: "status_freeze", sourceUnitId: "enemy:0", remainingOwnerTurns: 1,
        skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: enemy.stats.attack, shieldRemaining: 0,
      }], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
    };
    const enemyUnit: BattleUnitStateV1 = {
      ...partyUnit, unitId: "enemy:0", definitionId: enemy.id, faction: "enemy", slot: 1,
      prePercentStats: { ...enemy.stats }, stats: { ...enemy.stats }, currentHp: enemy.stats.maxHp, statuses: [],
    };
    const initial = createNewGameSave(abyssEchoContentRoot, "2026-08-28T00:00:00.000Z", { newGameSeed: 3, idFactory: new SequentialIdFactory() });
    initial.battle = {
      battleId: "battle_control_skip_gateway", expeditionId: "exp_control_skip_gateway", battleRevision: 0,
      encounterId: "encounter_floor_01_normal_a", encounterObjectId: "object_control_skip_gateway", phase: "RESOLVE_ACTION", outcome: "ongoing", round: 1,
      units: [partyUnit, enemyUnit], initiativeQueueUnitIds: [], currentUnitId: partyUnit.unitId,
      pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4],
      firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
      reward: null, returnMapId: "map_town", returnSafePosition: { x: 0, y: 0 },
    };
    let rootCalls = 0;
    const content = {
      getRoot: () => { rootCalls += 1; return catalog.getRoot(); },
      getCharacter: catalog.getCharacter.bind(catalog), getSkill: catalog.getSkill.bind(catalog), getStatus: catalog.getStatus.bind(catalog),
      getEnemy: catalog.getEnemy.bind(catalog), getEquipmentBase: catalog.getEquipmentBase.bind(catalog), getEquipmentAffix: catalog.getEquipmentAffix.bind(catalog),
      getSkillAffix: catalog.getSkillAffix.bind(catalog), getCombo: catalog.getCombo.bind(catalog),
    } as unknown as ConstructorParameters<typeof BattleCommandGateway>[0]["content"];
    const store = new GameStore(initial);
    const repository = new Repository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    let id = 0;
    const gateway = new BattleCommandGateway({ store, coordinator, content, nextId: (kind) => `${kind}_control_skip_${id++}` });
    const before = store.getSnapshot();
    const failed = await gateway.executeControlSkip();
    expect(failed).toMatchObject({ ok: false, events: [] });
    expect(store.getSnapshot()).toEqual(before);
    expect(rootCalls).toBeGreaterThan(0);
    if (failed.ok || !failed.candidateId) throw new Error("expected retryable control skip candidate");
    const candidateEvents = coordinator.pendingCandidates[0]?.events;
    expect(candidateEvents).toBeDefined();
    expect(candidateEvents?.map((event) => (event as BattleDomainEventV1).type)).toContain("TURN_SKIPPED");
    expect(candidateEvents?.every((event, index) => (event as BattleDomainEventV1).sequence === index)).toBe(true);
    expect(store.getSnapshot().battle?.battleRevision).toBe(0);
    expect(store.getSnapshot().battle?.rngState).toEqual([1, 2, 3, 4]);

    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.events).toEqual(candidateEvents);
    expect(retried.value.snapshot.battleRevision).toBe(1);
    expect(retried.value.snapshot.phase).toBe("TURN_END");
    expect(retried.value.snapshot.units[0]?.statuses).toEqual([]);
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[0]?.expectedRevision).toBe(repository.calls[1]?.expectedRevision);
  });

  it("敌方多效果技能击倒目标后仍提交完整 AI 命令", async () => {
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    if (!catalogResult.ok) throw new Error("正式内容目录创建失败");
    const catalog = catalogResult.value;
    const enemyResult = catalog.getEnemy("enemy_goblin_scout");
    if (!enemyResult.ok) throw new Error("缺少敌方内容");
    const enemyDefinition = enemyResult.value as unknown as EnemyDefinition;
    const save = createNewGameSave(abyssEchoContentRoot, "2026-08-26T00:00:00.000Z", { newGameSeed: 1, idFactory: new SequentialIdFactory() });
    const partyStats = (maxHp: number): StatBlock => ({ maxHp, attack: 50, defense: 20, speed: 20, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 });
    const makePartyUnit = (unitId: string, definitionId: string, slot: number, currentHp: number, stats: StatBlock): BattleUnitStateV1 => ({
      unitId, definitionId, faction: "party", slot, level: 1,
      prePercentStats: { ...stats },
      staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
      stats, currentHp, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1,
      usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
    });
    const enemyStats = enemyResult.value.stats;
    const units: BattleUnitStateV1[] = [
      makePartyUnit("party:0", "char_wanderer", 0, 27, partyStats(600)),
      makePartyUnit("party:1", "char_iron_guard", 1, 582, partyStats(700)),
      makePartyUnit("party:2", "char_ranger", 2, 360, partyStats(500)),
      {
        unitId: "enemy:3", definitionId: "enemy_goblin_scout", faction: "enemy", slot: 3, level: enemyResult.value.level,
        prePercentStats: { ...enemyStats },
        staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
        stats: { ...enemyStats }, currentHp: enemyStats.maxHp, energy: 0,
        cooldowns: { skill_enemy_slow_hit: 0, skill_enemy_basic_ranged: 0 }, statuses: [], eligibleRound: 1,
        usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
      },
    ];
    const battle: BattleSnapshotV1 = {
      battleId: "battle_ai_repro", expeditionId: "exp_ai_repro", battleRevision: 3,
      encounterId: "encounter_floor_01_normal_b", encounterObjectId: "obj_f01_n02",
      phase: "AI_DECIDE", outcome: "ongoing", round: 2, units,
      initiativeQueueUnitIds: units.map((unit) => unit.unitId), currentUnitId: "enemy:3",
      pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable",
      rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {},
      metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
      reward: null, returnMapId: "map_floor_01", returnSafePosition: { x: 16, y: 16 },
    };
    save.battle = battle;
    save.expedition = {
      expeditionId: "exp_ai_repro", expeditionSeed: 1, mode: "exploration", abyssEchoId: null,
      floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 736, y: 736 }, safePosition: { x: 16, y: 16 },
      defeatedEncounterObjectIds: ["obj_f01_n02"], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false, startedAt: "2026-08-26T00:00:00.000Z",
    };
    const store = new GameStore(save);
    const repository = new Repository();
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const content = {
      getRoot: catalog.getRoot.bind(catalog),
      getCharacter: catalog.getCharacter.bind(catalog), getSkill: catalog.getSkill.bind(catalog),
      getEnemy: catalog.getEnemy.bind(catalog), getEncounter: catalog.getEncounter.bind(catalog),
      getItem: catalog.getItem.bind(catalog), getStatus: catalog.getStatus.bind(catalog),
      getSkillAffix: catalog.getSkillAffix.bind(catalog), getEquipmentAffix: catalog.getEquipmentAffix.bind(catalog),
      getEquipmentBase: catalog.getEquipmentBase.bind(catalog), getCombo: catalog.getCombo.bind(catalog),
      getDropTable: catalog.getDropTable.bind(catalog), getAbyssEcho: catalog.getAbyssEcho.bind(catalog),
    } as unknown as ConstructorParameters<typeof BattleCommandGateway>[0]["content"] & Parameters<typeof decideEnemyAction>[0]["content"];
    let id = 0;
    const gateway = new BattleCommandGateway({ store, coordinator, content, nextId: (kind) => `${kind}_ai_repro_${id++}` });
    const decision = decideEnemyAction({ snapshot: battle, actorUnitId: "enemy:3", enemy: enemyDefinition, content, rng: new SeededRng(battle.rngState) });
    expect(decision).toMatchObject({ ok: true, value: { command: { type: "USE_SKILL", skillId: "skill_enemy_slow_hit", targetUnitIds: ["party:0"] } } });
    if (!decision.ok) return;
    const result = await gateway.execute(decision.value.command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.units.find((unit) => unit.unitId === "party:0")?.currentHp).toBe(0);
    expect(result.value.snapshot.phase).toBe("TURN_END");
    expect(result.events.find((event) => event.type === "DAMAGE_RESOLVED")).toMatchObject({ hpBefore: 27, hpAfter: 0 });
  });
});
