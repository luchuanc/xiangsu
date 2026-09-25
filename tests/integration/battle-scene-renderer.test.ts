import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    return setTimeout(() => callback(Date.now()), 16) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
});

import { Container, Rectangle, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import type { BattleDomainEventV1, BattleSnapshotV1, BattleUnitStateV1, StatBlock } from "../../src/content/contracts";
import { verticalSliceAssetManifest } from "../../src/content/data/assets.manifest";
import { createPixiSceneRoot } from "../../src/app/PixiSceneRoot";
import type { PixiSceneRoot } from "../../src/app/PixiSceneRoot";
import { calculateViewport } from "../../src/app/ViewportService";
import { BattleHud } from "../../src/scenes/battle/BattleHud";
import { BattleView } from "../../src/scenes/battle/BattleView";
import { BattleSceneRenderer } from "../../src/ui/rendering/BattleSceneRenderer";
import { BattleSceneView } from "../../src/scenes/battle/BattleSceneView";
import type { PixiRenderAssetSource } from "../../src/ui/rendering/PixiAssetResolver";
import type { BattleArtResources } from "../../src/ui/rendering/BattleArtResources";

const stats: StatBlock = {
  maxHp: 100,
  attack: 20,
  defense: 10,
  speed: 20,
  critRateBps: 0,
  critDamageBps: 15000,
  effectHitBps: 0,
  effectResistBps: 0,
};

function unit(
  faction: "party" | "enemy",
  index: number,
  currentHp = 100,
): BattleUnitStateV1 {
  return {
    unitId: `${faction}:${index}`,
    definitionId: faction === "party" ? `char_${index}` : `enemy_${index}`,
    faction,
    slot: index,
    level: 1,
    prePercentStats: { ...stats },
    staticPercentByStatBps: { ...stats },
    stats: { ...stats, speed: faction === "party" ? 20 - index : 16 - index },
    currentHp,
    energy: faction === "party" ? 30 + index * 10 : 0,
    cooldowns: {},
    statuses: [],
    eligibleRound: 1,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function snapshot(overrides: Partial<BattleSnapshotV1> = {}): BattleSnapshotV1 {
  const units = [
    ...Array.from({ length: 4 }, (_, index) => unit("party", index)),
    ...Array.from({ length: 6 }, (_, index) => unit("enemy", index)),
  ];
  return {
    battleId: "battle_renderer",
    expeditionId: "exp_renderer",
    battleRevision: 1,
    encounterId: "encounter_test",
    encounterObjectId: "object_test",
    phase: "AWAIT_COMMAND",
    outcome: "ongoing",
    round: 3,
    units,
    initiativeQueueUnitIds: units.slice().reverse().map((value) => value.unitId),
    currentUnitId: "party:2",
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: {
      damage: [],
      partyDamageTaken: 0,
      partyHealingDone: 0,
      partyShieldGranted: 0,
      knockouts: [],
      comboTriggerCounts: {},
      bossEnrageCast: false,
      maxChainDepth: 0,
      triggerBudgetExhaustedCount: 0,
    },
    reward: null,
    returnMapId: "map_floor_01",
    returnSafePosition: { x: 16, y: 16 },
    ...overrides,
  };
}

function textValues(node: Container): string[] {
  const values: string[] = [];
  for (const child of node.children) {
    const candidate = child as Container & { text?: unknown };
    if (typeof candidate.text === "string") values.push(candidate.text);
    if (candidate.children.length > 0) values.push(...textValues(candidate));
  }
  return values;
}

function textNodes(node: Container): Array<Container & { text: string }> {
  const values: Array<Container & { text: string }> = [];
  for (const child of node.children) {
    const candidate = child as Container & { text?: unknown };
    if (typeof candidate.text === "string") values.push(candidate as Container & { text: string });
    if (candidate.children.length > 0) values.push(...textNodes(candidate));
  }
  return values;
}

function overlaps(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height;
}

function pointerEvent(): FederatedPointerEvent {
  return { stopPropagation: vi.fn() } as unknown as FederatedPointerEvent;
}

function battleEvent(type: BattleDomainEventV1["type"], overrides: Record<string, unknown> = {}): BattleDomainEventV1 {
  return {
    type,
    eventId: `event_${type}`,
    sequence: 1,
    battleId: "battle_renderer",
    round: 3,
    rootActionId: "root_renderer",
    rootActionDefinitionId: "skill_test",
    chainDepth: 0,
    triggerSource: null,
    visualSkillId: null,
    contextSkillKind: null,
    effect: null,
    ...overrides,
  } as BattleDomainEventV1;
}

const TEST_BATTLE_SPRITE_IDS: Readonly<Record<string, string>> = Object.freeze({
  char_0: "sprite_battle_char_wanderer",
  char_1: "sprite_battle_char_iron_guard",
  char_2: "sprite_battle_char_ember_mage",
  char_3: "sprite_battle_char_priest",
  enemy_0: "sprite_battle_enemy_grass_slime",
  enemy_1: "sprite_battle_enemy_thorn_rat",
  enemy_2: "sprite_battle_enemy_fang_wolf",
  enemy_3: "sprite_battle_enemy_goblin_scout",
  enemy_4: "sprite_battle_enemy_stonehide_boar",
  enemy_5: "sprite_battle_boss_horned_king",
});

function testBattleAssets(): PixiRenderAssetSource {
  const entries = new Map(verticalSliceAssetManifest.assets.map((entry) => [entry.id, entry]));
  const textures = new Map(
    verticalSliceAssetManifest.assets
      .filter((entry) => entry.kind === "battleActorSheet")
      .map((entry) => [entry.id, new Texture({ source: Texture.WHITE.source })]),
  );
  return {
    requireEntry: (assetId) => {
      const entry = entries.get(assetId);
      if (!entry) throw new Error(`TEST_BATTLE_ENTRY_MISSING:${assetId}`);
      return entry;
    },
    requireTexture: (assetId) => {
      const texture = textures.get(assetId);
      if (!texture) throw new Error(`TEST_BATTLE_TEXTURE_MISSING:${assetId}`);
      return texture;
    },
    requireAtlasFrame: (atlasId, frameId) => {
      if (atlasId !== "atlas_battle_fx" || !frameId.startsWith("fx_")) throw new Error(`TEST_BATTLE_FRAME_INVALID:${atlasId}/${frameId}`);
      return Texture.WHITE;
    },
  };
}

function testBattleSpriteId(unitValue: import("../../src/scenes/battle/BattleView").BattleUnitViewModel): string {
  const assetId = TEST_BATTLE_SPRITE_IDS[unitValue.unit.definitionId];
  if (!assetId) throw new Error(`TEST_BATTLE_SPRITE_ID_MISSING:${unitValue.unit.definitionId}`);
  return assetId;
}

function rendererOptions(root: PixiSceneRoot, hud: BattleHud, viewport: ReturnType<typeof calculateViewport>): {
  root: PixiSceneRoot;
  hud: BattleHud;
  viewport: ReturnType<typeof calculateViewport>;
  unitName: (unitValue: import("../../src/scenes/battle/BattleView").BattleUnitViewModel) => string;
  skillLabel: (skillId: string) => string;
  comboLabel: (comboId: string) => string;
  assets: PixiRenderAssetSource;
  battleSpriteId: typeof testBattleSpriteId;
} {
  return {
    root,
    hud,
    viewport,
    unitName: (unitValue) => unitValue.unit.definitionId,
    skillLabel: (skillId) => skillId,
    comboLabel: (comboId) => comboId,
    assets: testBattleAssets(),
    battleSpriteId: testBattleSpriteId,
  };
}

describe("BattleSceneRenderer / BattleSceneView", () => {
  it("按 BattleView 的 4v6 槽位绘制左右队伍、回合和速度顺序", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setSafeRect(viewport.safeRect);
    const model = new BattleView({ snapshot: snapshot() }).project();
    const renderer = new BattleSceneRenderer({
      ...rendererOptions(root, hud, viewport),
      onAction: vi.fn(),
    });

    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });

    expect(renderer.partyNodes).toHaveLength(4);
    expect(renderer.enemyNodes).toHaveLength(6);
    expect(renderer.partyNodes.map((node) => node.position.x)).toEqual([144, 144, 224, 224]);
    expect(renderer.enemyNodes.map((node) => node.position.x)).toEqual([496, 496, 416, 416, 576, 576]);
    expect(renderer.partyNodes.map((node) => node.position.y)).toEqual([150, 240, 150, 240]);
    expect(renderer.enemyNodes.map((node) => node.position.y)).toEqual([150, 240, 150, 240, 150, 240]);
    renderer.partyNodes.forEach((node) => {
      expect(node.sprite.scale.x).toBeGreaterThanOrEqual(1.5);
      expect(node.group.children.indexOf(node.sprite)).toBeGreaterThan(0);
      expect(node.cardBounds.y - node.position.y).toBeGreaterThanOrEqual(5);
    });
    expect(renderer.enemyNodes[5]!.sprite.scale.x).toBeGreaterThanOrEqual(1.2);
    expect(renderer.enemyNodes.every((node) => node.cardBounds.y - node.position.y >= 5)).toBe(true);
    const hudTexts = textValues(root.hud);
    const actorTexts = textValues(root.actors);
    expect(hudTexts).toEqual(expect.arrayContaining(["行动顺序"]));
    expect(hudTexts.some((value) => value.includes("第 3 回合"))).toBe(true);
    expect(actorTexts).toEqual(expect.arrayContaining(["enemy_5", "char_2"]));
    expect(root.mapBack.children.length).toBeGreaterThan(0);
    expect(root.actors.children).toHaveLength(10);
    for (const collection of [renderer.partyNodes, renderer.enemyNodes]) {
      for (let index = 0; index < collection.length; index += 1) {
        for (let next = index + 1; next < collection.length; next += 1) {
          expect(overlaps(collection[index]!.cardBounds, collection[next]!.cardBounds)).toBe(false);
        }
      }
    }
    renderer.destroy();
    expect(root.mapBack.children).toHaveLength(0);
    expect(root.actors.children).toHaveLength(0);
    expect(root.hud.children).toHaveLength(0);
  });

  it("按内容定义的 battleSpriteId 裁剪正式横向图集，存活循环且倒下停在 down 最终帧", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setViewport(viewport);
    const units = snapshot().units.map((value) => value.unitId === "enemy:5" ? { ...value, currentHp: 0 } : value);
    const model = new BattleView({ snapshot: snapshot({ units }) }).project();
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    renderer.prepare({ model, hud: hud.getLayout()! });

    const alive = renderer.partyNodes[0]!;
    const fallenBoss = renderer.enemyNodes.find((node) => node.unitId === "enemy:5")!;
    expect(alive.assetId).toBe("sprite_battle_char_wanderer");
    expect(alive.sprite.loop).toBe(true);
    expect(alive.sprite.animationSpeed).toBeCloseTo(6 / 60);
    expect(alive.sprite.anchor.x).toBe(0.5);
    expect(alive.sprite.anchor.y).toBeCloseTo(42 / 48);
    expect(fallenBoss.assetId).toBe("sprite_battle_boss_horned_king");
    expect(fallenBoss.sprite.loop).toBe(false);
    expect(fallenBoss.sprite.currentFrame).toBe(5);
    expect(fallenBoss.sprite.anchor.x).toBe(0.5);
    expect(fallenBoss.sprite.anchor.y).toBeCloseTo(58 / 64);
    renderer.destroy();
  });

  it("只由已提交领域事件切换 attack/skill/hit/down/idle clip，不从按钮预播", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setViewport(viewport);
    const model = new BattleView({ snapshot: snapshot() }).project();
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });

    const party = renderer.partyNodes[0]!;
    const enemy = renderer.enemyNodes[0]!;
    expect(party.sprite.texture.frame.x).toBe(0);
    renderer.animateEvent(battleEvent("ACTION_STARTED", { actorUnitId: party.unitId, actionKind: "basic", targetUnitIds: [enemy.unitId] }));
    expect(party.sprite.texture.frame.x).toBe(4 * 48);
    expect(party.sprite.playing).toBe(true);
    renderer.animateEvent(battleEvent("ACTION_STARTED", { actorUnitId: party.unitId, actionKind: "active", targetUnitIds: [enemy.unitId] }));
    expect(party.sprite.texture.frame.x).toBe(10 * 48);
    renderer.animateEvent(battleEvent("DAMAGE_RESOLVED", { sourceUnitId: party.unitId, targetUnitId: enemy.unitId, damageKind: "periodic" }));
    expect(enemy.sprite.texture.frame.x).toBe(0);
    renderer.animateEvent(battleEvent("DAMAGE_RESOLVED", { sourceUnitId: party.unitId, targetUnitId: enemy.unitId, damageKind: "direct" }));
    expect(enemy.sprite.texture.frame.x).toBe(18 * 48);
    renderer.animateEvent(battleEvent("UNIT_DEFEATED", { sourceUnitId: party.unitId, unitId: enemy.unitId }));
    // down 事件先播放过程帧，完成回调后才停在 manifest 声明的最终帧。
    expect(enemy.sprite.texture.frame.x).toBe(21 * 48);
    expect(enemy.sprite.playing).toBe(true);
    enemy.sprite.onComplete?.();
    expect(enemy.sprite.texture.frame.x).toBe((21 + 6 - 1) * 48);
    expect(enemy.sprite.currentFrame).toBe(5);
    renderer.animateEvent(battleEvent("UNIT_REVIVED", { sourceUnitId: party.unitId, unitId: enemy.unitId }));
    expect(enemy.sprite.texture.frame.x).toBe(0);
    renderer.destroy();
  });

  it("技能/Combo/意图反馈严格消费注入文案，Combo 按 battle/root/event/owner/id 去重", () => {
    vi.useFakeTimers();
    try {
      const root = createPixiSceneRoot();
      const hud = new BattleHud();
      const viewport = calculateViewport({ width: 640, height: 360 });
      hud.setViewport(viewport);
      const model = new BattleView({ snapshot: snapshot() }).project();
      const renderer = new BattleSceneRenderer({
        ...rendererOptions(root, hud, viewport),
        skillLabel: (skillId) => `技能名:${skillId}`,
        comboLabel: (comboId) => `Combo名:${comboId}`,
        onAction: vi.fn(),
      });
      const frame = { model, hud: hud.getLayout()! };
      renderer.prepare(frame);
      renderer.enter(frame);
      const party = renderer.partyNodes[0]!;
      const enemy = renderer.enemyNodes[0]!;

      renderer.animateEvent(battleEvent("ACTION_STARTED", {
        actorUnitId: party.unitId,
        actionKind: "active",
        targetUnitIds: [enemy.unitId],
        visualSkillId: "skill_visual_exact",
      }));
      expect(textValues(root.hud)).toContain("技能 · 技能名:skill_visual_exact");
      const skillBannerText = textNodes(root.hud).find((node) => node.text === "技能 · 技能名:skill_visual_exact");
      expect(skillBannerText?.parent?.x).toBeGreaterThanOrEqual(viewport.safeRect.x + 320);
      expect((skillBannerText?.parent?.y ?? 0) + 26).toBeLessThanOrEqual(viewport.safeRect.y + 36);
      expect(renderer.layer.children.at(-1)?.label).toBe("battle-actions");
      const beforeBasic = textValues(root.hud).filter((value) => value.startsWith("技能 · ")).length;
      renderer.animateEvent(battleEvent("ACTION_STARTED", {
        actorUnitId: party.unitId,
        actionKind: "basic",
        targetUnitIds: [enemy.unitId],
        visualSkillId: "skill_basic_should_not_banner",
      }));
      expect(textValues(root.hud).filter((value) => value.startsWith("技能 · ")).length).toBe(beforeBasic);

      const combo = battleEvent("COMBO_TRIGGERED", {
        eventId: "combo-event-1",
        rootActionId: "combo-root-1",
        ownerKey: "owner-hidden",
        comboId: "combo_exact",
      });
      renderer.animateEvent(combo);
      renderer.animateEvent(combo);
      expect(textValues(root.hud).filter((value) => value === "COMBO · Combo名:combo_exact")).toHaveLength(1);
      renderer.animateEvent(battleEvent("COMBO_TRIGGERED", {
        eventId: "combo-event-2",
        rootActionId: "combo-root-1",
        ownerKey: "owner-hidden",
        comboId: "combo_exact",
      }));
      expect(textValues(root.hud).filter((value) => value === "COMBO · Combo名:combo_exact")).toHaveLength(1);
      renderer.animateEvent(battleEvent("COMBO_TRIGGERED", {
        eventId: "combo-event-3",
        rootActionId: "combo-root-2",
        ownerKey: "owner-hidden",
        comboId: "combo_exact",
      }));
      expect(textValues(root.hud).filter((value) => value === "COMBO · Combo名:combo_exact")).toHaveLength(2);
      expect(textValues(root.hud)).not.toContain("owner-hidden");

      renderer.animateEvent(battleEvent("INTENT_DECLARED", {
        intentId: "intent-1",
        sourceUnitId: enemy.unitId,
        skillId: "skill_boss_exact",
      }));
      expect(textValues(root.hud)).toContain("蓄力 · 技能名:skill_boss_exact");
      renderer.animateEvent(battleEvent("INTENT_RELEASED", {
        intentId: "intent-1",
        sourceUnitId: enemy.unitId,
        skillId: "skill_boss_exact",
      }));
      expect(textValues(root.hud)).not.toContain("蓄力 · 技能名:skill_boss_exact");

      renderer.destroy();

      const reducedRoot = createPixiSceneRoot();
      const reducedHud = new BattleHud();
      reducedHud.setViewport(viewport);
      const reduced = new BattleSceneRenderer({
        ...rendererOptions(reducedRoot, reducedHud, viewport),
        reducedFlashes: true,
        skillLabel: (skillId) => `技能名:${skillId}`,
        comboLabel: (comboId) => `Combo名:${comboId}`,
        onAction: vi.fn(),
      });
      reduced.prepare({ model, hud: reducedHud.getLayout()! });
      reduced.enter({ model, hud: reducedHud.getLayout()! });
      reduced.animateEvent(battleEvent("COMBO_TRIGGERED", {
        eventId: "reduced-combo-event",
        rootActionId: "reduced-combo-root",
        ownerKey: "owner-reduced",
        comboId: "combo_reduced",
      }));
      expect(textValues(reducedRoot.hud)).toContain("COMBO · Combo名:combo_reduced");
      vi.advanceTimersByTime(399);
      expect(textValues(reducedRoot.hud)).toContain("COMBO · Combo名:combo_reduced");
      vi.advanceTimersByTime(1);
      expect(textValues(reducedRoot.hud)).not.toContain("COMBO · Combo名:combo_reduced");
      reduced.animateEvent(battleEvent("INTENT_DECLARED", {
        intentId: "reduced-intent",
        sourceUnitId: enemy.unitId,
        skillId: "skill_reduced",
      }));
      expect(textValues(reducedRoot.hud)).toContain("蓄力 · 技能名:skill_reduced");
      reduced.pause();
      expect(textValues(reducedRoot.hud)).not.toContain("蓄力 · 技能名:skill_reduced");
      reduced.destroy();
      expect(reducedRoot.hud.children).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("命中反馈按目标方向位移并输出浮字，暂停会清理位移/染色/临时文本", () => {
    vi.useFakeTimers();
    try {
      const root = createPixiSceneRoot();
      const hud = new BattleHud();
      const viewport = calculateViewport({ width: 640, height: 360 });
      hud.setViewport(viewport);
      const model = new BattleView({ snapshot: snapshot() }).project();
      const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
      renderer.prepare({ model, hud: hud.getLayout()! });
      renderer.enter({ model, hud: hud.getLayout()! });

      const party = renderer.partyNodes[0]!;
      const enemy = renderer.enemyNodes[0]!;
      const enemyX = enemy.group.x;
      renderer.animateEvent(battleEvent("ACTION_STARTED", { actorUnitId: party.unitId, actionKind: "basic", targetUnitIds: [enemy.unitId] }));
      expect(party.group.x).toBe(party.position.x + 8);
      vi.advanceTimersByTime(160);
      expect(party.group.x).toBe(party.position.x);

      renderer.animateEvent(battleEvent("DAMAGE_RESOLVED", {
        sourceUnitId: party.unitId,
        targetUnitId: enemy.unitId,
        damageKind: "direct",
        shieldDamage: 4,
        hpDamage: 12,
        hitResult: "critical",
      }));
      expect(enemy.group.x).toBe(enemyX + 6);
      expect(enemy.sprite.tint).not.toBe(0xffffff);
      expect(textValues(root.worldFx)).toContain("暴击 -16");
      const criticalText = textNodes(root.worldFx).find((node) => node.text === "暴击 -16");
      expect((criticalText as unknown as Text | undefined)?.style.fontSize).toBeGreaterThan(14);
      renderer.pause();
      expect(enemy.group.x).toBe(enemyX);
      expect(enemy.sprite.tint).toBe(0xffffff);
      expect(root.worldFx.children).toHaveLength(0);
      renderer.destroy();

      const reducedRoot = createPixiSceneRoot();
      const reducedHud = new BattleHud();
      reducedHud.setViewport(viewport);
      const reduced = new BattleSceneRenderer({ ...rendererOptions(reducedRoot, reducedHud, viewport), reducedFlashes: true, onAction: vi.fn() });
      reduced.prepare({ model, hud: reducedHud.getLayout()! });
      reduced.enter({ model, hud: reducedHud.getLayout()! });
      const reducedEnemy = reduced.enemyNodes[0]!;
      reduced.animateEvent(battleEvent("DAMAGE_RESOLVED", {
        sourceUnitId: party.unitId,
        targetUnitId: reducedEnemy.unitId,
        damageKind: "direct",
        shieldDamage: 0,
        hpDamage: 5,
        hitResult: "nonCritical",
      }));
      expect(reducedEnemy.sprite.tint).toBe(0xffffff);
      reduced.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("治疗/护盾特效遵守双倍速度，暂停与销毁撤销后续帧", () => {
    vi.useFakeTimers();
    try {
      const root = createPixiSceneRoot();
      const hud = new BattleHud();
      const viewport = calculateViewport({ width: 640, height: 360 });
      hud.setViewport(viewport);
      const model = new BattleView({ snapshot: snapshot() }).project();
      const options = rendererOptions(root, hud, viewport);
      const frameRequest = vi.spyOn(options.assets, "requireAtlasFrame");
      const renderer = new BattleSceneRenderer({ ...options, animationSpeed: 2, onAction: vi.fn() });
      renderer.prepare({ model, hud: hud.getLayout()! });
      renderer.enter({ model, hud: hud.getLayout()! });
      const targetUnitId = renderer.partyNodes[0]!.unitId;
      renderer.animateEvent(battleEvent("HEAL_RESOLVED", { targetUnitId, healed: 20 }));
      renderer.animateEvent(battleEvent("SHIELD_GRANTED", { targetUnitId, granted: 30 }));
      expect(frameRequest).toHaveBeenCalledWith("atlas_battle_fx", "fx_heal_00");
      expect(frameRequest).toHaveBeenCalledWith("atlas_battle_fx", "fx_shield_05");
      const effects = () => root.worldFx.children.filter((child) => child.label?.startsWith("skill-fx-"));
      expect(effects()).toHaveLength(2);
      vi.advanceTimersByTime(209);
      expect(effects()).toHaveLength(2);
      vi.advanceTimersByTime(2);
      expect(effects()).toHaveLength(0);
      renderer.animateEvent(battleEvent("STATUS_CHANGED", { targetUnitId, change: "applied" }));
      expect(effects()).toHaveLength(1);
      renderer.pause();
      vi.advanceTimersByTime(1_000);
      expect(root.worldFx.children).toHaveLength(0);
      renderer.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("当前角色移出剩余速度队列后仍显示真实行动者，不投影成等待状态", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setViewport(viewport);
    const currentUnitId = "party:2";
    const value = snapshot({
      currentUnitId,
      initiativeQueueUnitIds: snapshot().initiativeQueueUnitIds.filter((unitId) => unitId !== currentUnitId),
    });
    const model = new BattleView({ snapshot: value }).project();
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });

    const texts = textValues(root.hud);
    expect(texts).toContain("当前行动：char_2  ·  速度 18");
    expect(texts).not.toContain("等待行动顺序推进");
    renderer.destroy();
  });

  it("底部 Pixi 按钮复用 BattleHud 可用性并派发既有动作回调", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setSafeRect(viewport.safeRect);
    hud.setActionAvailability("active_2", false, "battle.skill_locked");
    const onAction = vi.fn();
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction });
    const model = new BattleView({ snapshot: snapshot() }).project();
    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });

    renderer.primaryButtons.get("basic")?.emit("pointertap", pointerEvent());
    expect(onAction).toHaveBeenCalledWith("basic");
    renderer.primaryButtons.get("skill")?.emit("pointertap", pointerEvent());
    expect(onAction).toHaveBeenCalledWith("skill");
    renderer.primaryButtons.get("more")?.emit("pointertap", pointerEvent());
    expect(onAction).toHaveBeenCalledWith("more");
    hud.openSecondary("skill");
    renderer.update({ model, hud: hud.getLayout()! });
    expect(renderer.secondaryButtons.get("active_2")?.eventMode).toBe("none");

    renderer.pause();
    expect(root.hud.visible).toBe(true);
    expect(renderer.layer.visible).toBe(false);
    renderer.resume({ model, hud: hud.getLayout()! });
    expect(renderer.layer.visible).toBe(true);
    renderer.destroy();
  });

  it("BattleSceneView 在 viewport、暂停、恢复和销毁时同步 renderer 生命周期", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setSafeRect(viewport.safeRect);
    const view = new BattleSceneView({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    const model = new BattleView({ snapshot: snapshot() }).project();
    view.prepare({ model, hud: hud.getLayout()! });
    view.enter({ model, hud: hud.getLayout()! });
    const inset = calculateViewport({ width: 640, height: 360 }, { left: 16, right: 12, top: 4, bottom: 8 });
    view.setViewport(inset);
    expect(hud.getLayout()?.safeRect).toEqual(inset.safeRect);
    const nodes = textNodes(root.hud);
    const header = nodes.find((node) => node.text.includes("回合制战斗"));
    const timeline = nodes.find((node) => node.text === "行动顺序");
    expect(header?.x).toBeGreaterThanOrEqual(inset.safeRect.x);
    expect(header?.y).toBeGreaterThanOrEqual(inset.safeRect.y);
    expect(timeline?.x).toBeGreaterThanOrEqual(inset.safeRect.x);
    expect(timeline?.y).toBeGreaterThanOrEqual(inset.safeRect.y);
    const narrow = calculateViewport({ width: 568, height: 320 });
    view.setViewport(narrow);
    const narrowBasic = view.renderer.primaryButtons.get("basic");
    expect(narrowBasic?.hitArea).toBeInstanceOf(Rectangle);
    expect((narrowBasic?.hitArea as Rectangle).width * narrow.scale).toBeGreaterThanOrEqual(48);
    const wide = calculateViewport({ width: 844, height: 390 });
    view.setViewport(wide);
    const wideBasic = view.renderer.primaryButtons.get("basic");
    const wideSkill = view.renderer.primaryButtons.get("skill");
    expect(wideBasic).not.toBe(narrowBasic);
    expect(wideBasic?.hitArea).toBeInstanceOf(Rectangle);
    expect((wideBasic?.hitArea as Rectangle).width * wide.scale).toBeGreaterThanOrEqual(48);
    const wideGap = (wideSkill!.x - wideBasic!.x - (wideBasic!.hitArea as Rectangle).width) * wide.scale;
    expect(wideGap).toBeGreaterThanOrEqual(8);
    view.pause();
    view.resume({ model, hud: hud.getLayout()! });
    view.destroy();
    expect(root.mapBack.children).toHaveLength(0);
  });

  it("568×320 contain 下按钮与间隔仍满足 48/8 CSS 像素门槛", () => {
    const viewport = calculateViewport({ width: 568, height: 320 });
    const hud = new BattleHud();
    hud.setViewport(viewport);
    const layout = hud.getLayout()!;
    expect(layout.primary[0]!.width * viewport.scale).toBeGreaterThanOrEqual(48);
    expect(layout.primary[0]!.height * viewport.scale).toBeGreaterThanOrEqual(48);
    const cssGap = (layout.primary[1]!.x - layout.primary[0]!.x - layout.primary[0]!.width) * viewport.scale;
    expect(cssGap).toBeGreaterThanOrEqual(8);
    expect(layout.primary.every((action) => action.x >= layout.safeRect.x && action.x + action.width <= layout.safeRect.right)).toBe(true);
  });

  it("正式战斗按钮使用图标化古铜金边框，技能抽屉替换底部行并保留返回入口", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setViewport(viewport);
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    const model = new BattleView({ snapshot: snapshot() }).project();
    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });

    const basic = renderer.primaryButtons.get("basic")!;
    expect(basic.labelText.text).toBe("普攻");
    expect(basic.children.some((child) => child.label === "button-icon-sword")).toBe(true);
    expect(basic.children.some((child) => child.label === "button-face")).toBe(true);
    expect((basic.hitArea as Rectangle).width).toBe(48);

    hud.openSecondary("skill");
    renderer.update({ model, hud: hud.getLayout()! });
    expect(renderer.primaryButtons.size).toBe(0);
    expect(renderer.secondaryButtons.size).toBe(3);
    expect(textValues(root.hud)).toContain("返回");
    const visibleBottomButtons = [...renderer.secondaryButtons.values()];
    expect(visibleBottomButtons.every((button) => button.y >= viewport.safeRect.bottom - 48 - 8)).toBe(true);
    expect(renderer.secondaryButtons.get("active_1")!.x).toBeGreaterThan(renderer.secondaryButtons.get("active_2")!.x - 64);
    renderer.destroy();
  });

  it("单帧 BattleArtResources 接管角色与背景，动作事件保留位移且销毁不释放共享纹理", () => {
    const root = createPixiSceneRoot();
    const hud = new BattleHud();
    const viewport = calculateViewport({ width: 640, height: 360 });
    hud.setViewport(viewport);
    const singleActor = new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 384, 512) });
    const background = new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 640, 360) });
    const art: BattleArtResources = { background, actors: new Map([["sprite_battle_char_wanderer", singleActor]]) };
    const renderer = new BattleSceneRenderer({ ...rendererOptions(root, hud, viewport), onAction: vi.fn() });
    renderer.setArtResources(art);
    const model = new BattleView({ snapshot: snapshot() }).project();
    renderer.prepare({ model, hud: hud.getLayout()! });
    renderer.enter({ model, hud: hud.getLayout()! });
    const actor = renderer.partyNodes[0]!;
    expect(actor.sprite.textures).toHaveLength(1);
    expect(actor.sprite.textures[0]).toBe(singleActor);
    expect(actor.sprite.scale.x).toBeCloseTo(Math.min(80 / singleActor.width, 92 / singleActor.height), 3);
    expect(actor.sprite.anchor.y).toBeCloseTo(0.9);
    const enemy = renderer.enemyNodes[0]!;
    renderer.animateEvent(battleEvent("ACTION_STARTED", { actorUnitId: actor.unitId, actionKind: "basic", targetUnitIds: [enemy.unitId] }));
    expect(actor.group.x).toBe(actor.position.x + 8);
    renderer.destroy();
    expect(singleActor.destroyed).toBe(false);
    expect(background.destroyed).toBe(false);
  });
});
