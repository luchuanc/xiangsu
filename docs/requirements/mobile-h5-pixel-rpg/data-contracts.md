# 数据契约

## 文档状态

- 版本：DATA-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：字段名、判别联合、范围、引用和事务语义均为实现契约，不接受别名或猜测兼容

## 1. 总则

- 本文件冻结首版内容配置、运行时状态和存档的字段名与语义。
- 所有 ID 必须匹配 `^[a-z][a-z0-9_]*$`，区分大小写；首版只使用小写。ContentRoot 中带 `id` 的内容实体跨数组全局唯一；AssetBundle/资源 ID 属于独立 manifest 命名空间（因此 FloorId 与同名 floor bundle 可以同为 `floor_01`）；实例 ID 在单份存档的装备、铭石及溢出区跨集合全局唯一。
- 所有百分比使用整数 basis point，`10000 = 100%`。
- `expeditionSeed` 与 RNG 四元状态均为无符号 32 位整数；schema 必须限制在 `0～4294967295`。
- 时间戳使用 UTC ISO 8601 字符串；战斗和探索规则不读取本地时区。
- 配置校验采用 strict 模式：未知字段、字段缺失、未知枚举、重复 ID、无效引用均失败。
- 不读取字段别名，不从展示文案推导规则，不适配数组/对象两种结构。
- `Record<ID, ...>` 在读取存档时只接受内容目录中已知 ID；未知内容 ID 按迁移规则处理，首版无迁移时阻断加载。

## 2. 公共类型

```ts
export type CharacterId = string
export type SkillId = string
export type SkillFamilyId =
  | 'area'
  | 'basic'
  | 'bleed'
  | 'bow'
  | 'cleanse'
  | 'control'
  | 'detonate'
  | 'execute'
  | 'fire'
  | 'frost'
  | 'guard'
  | 'hammer'
  | 'heal'
  | 'holy'
  | 'mark'
  | 'multiHit'
  | 'passive'
  | 'projectile'
  | 'revive'
  | 'shield'
  | 'speed'
  | 'support'
  | 'sword'
  | 'taunt'
  | 'ultimate'
export type StatusId = string
export type EquipmentBaseId = string
export type EquipmentAffixId = string
export type AffixTriggerId = string
export type SkillAffixId = string
export type ComboId = string
export type EnemyId = string
export type EncounterId = string
export type EncounterModifierId = string
export type BossIntentId = string
export type AbyssEchoId = string
export type MapId = string
export type FloorId = string
export type NpcId = string
export type DialogueId = string
export type ItemId = string
export type QuestId = string
export type ShopId = string
export type RecruitmentId = string
export type DropTableId = string
export type AssetBundleId = string
export type InstanceId = string

export type BasisPoints = number

export interface Vector2 {
  x: number
  y: number
}

export interface StatBlock {
  maxHp: number
  attack: number
  defense: number
  speed: number
  critRateBps: BasisPoints
  critDamageBps: BasisPoints
  effectHitBps: BasisPoints
  effectResistBps: BasisPoints
}

export type Element =
  | 'physical'
  | 'fire'
  | 'frost'
  | 'lightning'
  | 'holy'
  | 'dark'
  | 'poison'
  | 'true'

export type TargetRule =
  | 'self'
  | 'singleAlly'
  | 'allAllies'
  | 'singleEnemy'
  | 'allEnemies'
  | 'randomEnemy'
  | 'deadAlly'

export type StackRule = 'add' | 'max' | 'unique' | 'replace'

export type ComboTagId =
  | 'area'
  | 'back'
  | 'basicAttack'
  | 'bleed'
  | 'burn'
  | 'chain'
  | 'chase'
  | 'cleanse'
  | 'control'
  | 'counter'
  | 'crit'
  | 'dark'
  | 'detonate'
  | 'element'
  | 'execute'
  | 'fire'
  | 'focus'
  | 'front'
  | 'frost'
  | 'guard'
  | 'heal'
  | 'healthy'
  | 'holy'
  | 'mark'
  | 'might'
  | 'physical'
  | 'poison'
  | 'shield'
  | 'shock'
  | 'speed'
  | 'support'
  | 'taunt'
  | 'ultimate'
  | 'vitality'

export interface TagContribution {
  tagId: ComboTagId
  count: number
}
```

`TagContribution.count` 与 `ComboRequirement.count` 必须为正整数；当前冻结内容只使用 1 或 2。所有 `number` 在 schema 中进一步限定为有限整数；除坐标外不接受小数。

所有概率统一调用 `rollBps(chanceBps)`：`0` 固定失败且不消费 RNG，`10000` 固定成功且不消费 RNG，其余值调用一次 `nextIntInclusive(1,10000)` 并在结果 `<= chanceBps` 时成功。所有存在于流程中的闭区间整数使用 `nextIntInclusive(min,max)`，即使 `min=max` 也消费一次 RNG；只有整个步骤不适用时才不调用。稳定加权抽取调用 `nextIntInclusive(1,sumWeights)`，按配置原数组顺序返回第一个累计权重不小于抽值的候选，只有一个正权重候选也消费一次。暴击、状态、触发、掉落、深渊升格和技能词条概率均使用这套语义，不得分别实现 `<`/`<=` 变体。

## 3. 内容根与引用完整性

```ts
export interface ContentRootV1 {
  schemaVersion: 1
  contentVersion: 'content-1.2.0'
  protagonistCharacterId: CharacterId
  characters: CharacterDefinition[]
  skills: SkillDefinition[]
  statuses: StatusDefinition[]
  equipmentBases: EquipmentBaseDefinition[]
  equipmentAffixes: EquipmentAffixDefinition[]
  affixTriggers: AffixTriggerDefinition[]
  skillAffixes: SkillAffixDefinition[]
  combos: ComboDefinition[]
  enemies: EnemyDefinition[]
  encounters: EncounterDefinition[]
  encounterModifiers: EncounterModifierDefinition[]
  bossIntents: BossIntentDefinition[]
  abyssEchoes: AbyssEchoDefinition[]
  floors: FloorDefinition[]
  maps: MapDefinition[]
  npcs: NpcDefinition[]
  dialogues: DialogueDefinition[]
  quests: QuestDefinition[]
  recruitments: RecruitmentDefinition[]
  shops: ShopDefinition[]
  items: StackableItemDefinition[]
  dropTables: DropTableDefinition[]
  economy: EconomyDefinition
}
```

启动校验必须检查：

1. 每个数组内部 ID 唯一，且 ContentRoot 全部带 id 的内容实体跨数组也不得重名；外部 AssetCatalog 不混入该集合。
2. 所有引用 ID 存在且类型正确。
3. 概率/权重为非负整数，概率不超过 10000，权重组总和大于 0。
4. 每个技能的 5 级数值数组长度严格为 5。
5. 地图 layer 长度等于 `widthTiles × heightTiles`。
6. 掉落表能为每个要求的品质找到合法词条池。
7. Combo 配方非空，触发预算合法。
8. `protagonistCharacterId` 必须存在且只有该角色可作为主角必选判断来源。
9. 每个非主角角色恰好有一条招募定义；任务、商店、NPC 和词条触发引用全部存在。
10. 首版精确数量必须为：角色 6、技能 97、状态 18、装备底材 60、普通/深渊装备词条 40/8、装备触发 15、普通/深渊技能词条 20/4、Combo 18、普通/精英敌人 25、Boss 10、Boss 意图 10、遭遇 50、遭遇修正 8、深渊回响 10、楼层 10、地图 11、NPC/对话 7/7、任务 1、招募 5、商店 1、堆叠物 5、掉落表 50。多或少都返回 `INVALID_CONTENT`。
11. 所有 TagContribution 与 ComboRequirement.tagId 必须属于上列 34 个 `ComboTagId`，且 `localization-spec.md` 必须恰好存在对应 `tag.<tagId>` 中文键；禁止自由字符串、大小写别名或从 ID 拆词显示。
12. 所有 SkillDefinition.familyIds 与 SkillAffixTarget.familyId 必须属于上列 25 个 `SkillFamilyId`，且恰好存在对应 `skill_family.<familyId>` 中文键；目标格式化按 LOC-1.2 的 skill/family/allSkills 三分支，不显示 familyId。

### 3.1 构建期元数据唯一展开

REQ-1.2 确认后的首版内容根固定使用 `schemaVersion=1`、`contentVersion='content-1.2.0'`。确认前不产出运行时内容；冻结表任一业务字段变更必须先提升表格版本和 `contentVersion`，不能继续复用该字面量。

冻结表未重复书写的展示键与资源 ID 只能按下表纯函数展开。这里的 `<id>` 是包含原前缀的完整 ID；例如 `skill_wanderer_strike` 的动画 ID 是 `anim_skill_wanderer_strike`。构建器不得读取中文名称猜测 ID，也不得在资源缺失时换用通用资源。

| 内容类型 | nameKey | descriptionKey | sprite/icon/animation |
| --- | --- | --- | --- |
| CharacterDefinition | `character.<id>.name` | 不存在 | `fieldSpriteId=sprite_field_<id>`；`battleSpriteId=sprite_battle_<id>` |
| SkillDefinition | `skill.<id>.name` | `skill.<id>.description` | `animationId=anim_<id>` |
| StatusDefinition | `status.<id>.name` | 不存在 | `iconId=icon_<id>` |
| EquipmentBaseDefinition | `equipment.<id>.name` | 不存在 | `spriteId=sprite_<id>` |
| EquipmentAffixDefinition | `equipment_affix.<id>.name` | `equipment_affix.<id>.description` | 不存在 |
| SkillAffixDefinition | `skill_affix.<id>.name` | `skill_affix.<id>.description` | 不存在 |
| ComboDefinition | `combo.<id>.name` | `combo.<id>.description` | `iconId=icon_<id>` |
| EnemyDefinition | `enemy.<id>.name` | 不存在 | `spriteId=sprite_battle_<id>` |
| EncounterDefinition | 不存在 | 不存在 | `fieldSpriteId=sprite_field_<id>` |
| EncounterModifierDefinition | `encounter_modifier.<id>.name` | `encounter_modifier.<id>.description` | 不存在 |
| AbyssEchoDefinition | `abyss_echo.<id>.name` | `abyss_echo.<id>.description` | 不存在；复用对应 Boss 资源 |
| FloorDefinition | `floor.<id>.name` | 不存在 | 不存在 |
| MapDefinition | 城镇 `map.map_town.name`；野外显式复用其 FloorDefinition.nameKey | 不存在 | tileset 见 ASSET-1.2 |

NPC、任务、物品和对话键由各自冻结表显式给出或按表内单独写明的规则展开。全部生成键必须存在于 `localization-spec.md` 的 `zh-CN` 清单，全部资源 ID 必须存在于 `asset-spec.md` 的对应 `Assets` bundle；缺失即 `INVALID_CONTENT`，不显示 raw ID 或使用通用缺图。技能与词条详情中的业务数值从结构化配置格式化，文案文件不得反向覆盖数值。

## 4. 角色与技能

```ts
export interface CharacterDefinition {
  id: CharacterId
  nameKey: string
  role: 'fighter' | 'tank' | 'ranger' | 'mage' | 'support'
  allowedWeaponTypes: WeaponType[]
  baseStats: StatBlock
  growthPerLevel: StatBlock
  innateTags: TagContribution[]
  basicSkillId: SkillId
  activeSkillIds: [SkillId, SkillId, SkillId, SkillId]
  ultimateSkillId: SkillId
  passiveSkillId: SkillId
  fieldSpriteId: string
  battleSpriteId: string
}

export type WeaponType = 'sword' | 'hammer' | 'bow' | 'staff' | 'focus' | 'relic'

export interface SkillDefinition {
  id: SkillId
  nameKey: string
  descriptionKey: string
  owner: SkillOwner
  familyIds: SkillFamilyId[]
  kind: 'basic' | 'active' | 'ultimate' | 'passive' | 'effect'
  unlockLevel: number
  maxLevel: 1 | 5
  targetRule: TargetRule
  requiresFrontAccess: boolean
  cooldownTurnsByLevel: [number, number, number, number, number]
  energyCostByLevel: [number, number, number, number, number]
  baseEnergyGainByLevel: [number, number, number, number, number]
  effectsByLevel: [EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[]]
  passiveModifiers: PassiveModifierSpec[]
  tags: TagContribution[]
  animationId: string
}

export type SkillOwner =
  | { kind: 'character'; characterId: CharacterId }
  | { kind: 'enemy'; enemyId: EnemyId }
  | { kind: 'systemEffect' }

export type PassiveModifierSpec =
  | { kind: 'flatStat'; stat: keyof StatBlock; value: number }
  | { kind: 'percentStat'; stat: keyof StatBlock; valueBps: BasisPoints }
  | { kind: 'damageBonus'; element: Element | 'all'; valueBps: BasisPoints }
  | { kind: 'healingBonus'; valueBps: BasisPoints }
  | { kind: 'shieldBonus'; valueBps: BasisPoints }

export type EffectSpec =
  | DamageEffectSpec
  | HealEffectSpec
  | ShieldEffectSpec
  | ApplyStatusEffectSpec
  | DispelEffectSpec
  | ConsumeStatusEffectSpec
  | EnergyEffectSpec
  | CooldownEffectSpec
  | SummonEffectSpec
  | GrantExtraTurnEffectSpec
  | ReviveEffectSpec

export interface DamageEffectSpec {
  kind: 'damage'
  targetRule: TargetRule
  element: Element
  powerBps: BasisPoints
  flatPower: number
  canCrit: boolean
  ignoreDefenseBps: BasisPoints
  flatIgnoreDefense: number
  hitCount: number
  retargetEachHit: boolean
  conditionalMultipliers: DamageConditionMultiplier[]
}

export interface DamageConditionMultiplier {
  condition: DamageCondition
  multiplierBps: BasisPoints
}

export type DamageCondition =
  | { kind: 'sourceHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'targetHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'sourceHasStatus'; statusId: StatusId }
  | { kind: 'targetHasStatus'; statusId: StatusId }
  | { kind: 'targetStatusStacksAtLeast'; statusId: StatusId; stacks: number }

export interface HealEffectSpec {
  kind: 'heal'
  targetRule: TargetRule
  scalingStat: 'attack' | 'maxHp'
  powerBps: BasisPoints
  flatPower: number
  canCrit: boolean
}

export interface ShieldEffectSpec {
  kind: 'shield'
  targetRule: TargetRule
  scalingStat: 'attack' | 'maxHp'
  powerBps: BasisPoints
  flatPower: number
  statusId: StatusId
  durationOwnerTurns: number
}

export interface ApplyStatusEffectSpec {
  kind: 'applyStatus'
  targetRule: TargetRule
  statusId: StatusId
  baseChanceBps: BasisPoints
  stacks: number
  durationOwnerTurns: number
}

export interface DispelEffectSpec {
  kind: 'dispel'
  targetRule: TargetRule
  polarity: 'buff' | 'debuff'
  count: number
}

export interface ConsumeStatusEffectSpec {
  kind: 'consumeStatus'
  targetRule: TargetRule
  statusId: StatusId
  stacks: number
}

export interface EnergyEffectSpec {
  kind: 'changeEnergy'
  targetRule: TargetRule
  amount: number
}

export interface CooldownEffectSpec {
  kind: 'changeCooldown'
  targetRule: TargetRule
  skillId: SkillId
  amountTurns: number
}

export interface SummonEffectSpec {
  kind: 'summon'
  enemyId: EnemyId
  preferredSlots: number[]
  maxAliveCopies: number
}

export interface GrantExtraTurnEffectSpec {
  kind: 'grantExtraTurn'
  targetRule: 'self'
}

export interface ReviveEffectSpec {
  kind: 'revive'
  targetRule: 'deadAlly'
  restoreMaxHpBps: BasisPoints
}
```

- HealEffect 的 `scalingStat='attack'` 读取效果来源的 attack，`scalingStat='maxHp'` 读取每个治疗目标自己的 maxHp；ShieldEffect 的两种 scalingStat 均读取效果来源。实现不得用同一个未标明归属的 `sourceStat` 兼容两者。
- 被动技能 `maxLevel` 必须为 1，冷却/能量数组仍填 5 个 0，以保持结构唯一。
- `effect` 技能 `maxLevel` 必须为 1，不能出现在角色主动槽或敌人普通决策列表中。
- 只有 `kind: passive` 可拥有非空 `passiveModifiers`，且其 `effectsByLevel` 固定为五个空数组；其余技能的 `passiveModifiers` 必须为空。
- 首版 `EffectSpec` 不提供通用“技能调用技能”分支；全部追加技能只由技能词条 `addFollowUp/statusLink` 产生，并按 `skill-affix-tables.md` 的唯一流程进入统一队列，禁止内容表另造递归入口。
- `SummonEffectSpec.preferredSlots` 只能包含 0～5 且不得重复；填槽、数量、初始化与行动资格严格按 `game-design.md` 6.6。
- TargetRule 对应的命令目标数量、自动目标、前后排和 taunt 规则严格按 `game-design.md` 6.5；不得接受单体多 ID、全体客户端枚举或空单体作为兼容输入。
- 角色技能的 owner、kind、unlockLevel、familyIds、tags、target/front、冷却与效果以 `skills-table.md` 第 2～8 节逐行展开。
- 系统 effect 技能固定 `owner={kind:'systemEffect'}`、`kind='effect'`、`unlockLevel=1`、`maxLevel=1`、`familyIds=[]`、`tags=[]`、`requiresFrontAccess=false`、冷却/能量/基础能量五格全 0、`passiveModifiers=[]`。
- 敌方通用模板固定 `owner={kind:'systemEffect'}`、`unlockLevel=1`、`maxLevel=1`、`familyIds=[]`、`tags=[]`、能量/基础能量五格全 0、`passiveModifiers=[]`；kind、target、front 和 CD 只按 `skills-table.md` 第 10 节展开。
- Boss 专属技能固定 `owner={kind:'enemy',enemyId:<所属 Boss>}`、`kind='active'`、`unlockLevel=1`、`maxLevel=1`、`familyIds=[]`、`tags=[]`、能量/基础能量五格全 0、`passiveModifiers=[]`；target、front、CD 和 effects 只按 `skills-table.md` 第 12 节展开，只有明确写 `/front` 才令 `requiresFrontAccess=true`。以上三类 maxLevel=1 技能均把第 1 格 effects/CD 复制为完整五格。

## 5. 状态

```ts
export interface StatusDefinition {
  id: StatusId
  nameKey: string
  polarity: 'buff' | 'debuff'
  maxStacks: number
  refreshRule: 'replaceDuration' | 'independentStacks'
  triggerTiming: 'turnStart' | 'afterAction' | 'turnEnd' | 'none'
  effect: StatusEffect
  canDispel: boolean
  immunityTag: string | null
  iconId: string
}

export type StatusEffect =
  | { kind: 'periodicDamage'; element: Element; snapshotPowerBps: BasisPoints }
  | { kind: 'statModifier'; stat: keyof StatBlock; flat: number; percentBps: BasisPoints }
  | { kind: 'skipTurn' }
  | { kind: 'taunt' }
  | { kind: 'shield' }
  | { kind: 'guard'; directDamageReductionBps: BasisPoints }
```

运行时独立层必须保存来源和攻击快照，不能只保存总层数：

```ts
export interface RuntimeStatusStack {
  stackId: string
  statusId: StatusId
  sourceUnitId: string
  remainingOwnerTurns: number
  skipNextOwnerTurnEndDecrement: boolean
  sourceAttackSnapshot: number
  shieldRemaining: number
}
```

非护盾状态的 `shieldRemaining` 必须为 0。
buff 的 ApplyStatusEffectSpec.baseChanceBps 必须为 10000；debuff 才允许 0～10000 并进入效果命中/抵抗。`immunityTag=null` 永不匹配 EnemyDefinition.immunityTags。
首版只实现冻结内容实际使用的 replaceDuration/independentStacks，不保留未使用的 addDuration 分支；刷新、cap、ConsumeStatus 与 Dispel 的确定性顺序以 `game-design.md` 6.4 为准。
`skipNextOwnerTurnEndDecrement` 只描述“状态在持有者当前正在进行的回合内、且不是 DRAIN_PRE_ACTION 新建”，不能用 round 编号或“本轮是否行动过”猜测；beforeAction buff 因已强化当前行动固定为 false，其他精确判断见 `game-design.md` 6.4。

## 6. 装备与装备词条

```ts
export type EquipmentSlot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'accessory'
export type EquipmentQuality = 'common' | 'magic' | 'rare' | 'epic' | 'abyss'
export type CraftGrade = 'ordinary' | 'tempered' | 'exalted'

export interface EquipmentBaseDefinition {
  id: EquipmentBaseId
  nameKey: string
  slot: EquipmentSlot
  weaponType: WeaponType | null
  minItemLevel: number
  maxItemLevel: number
  baseStat: keyof StatBlock
  baseValueAtMinLevel: number
  growthPerItemLevel: number
  baseGoldValue: number
  goldValuePerItemLevel: number
  spriteId: string
}

export interface EquipmentAffixDefinition {
  id: EquipmentAffixId
  nameKey: string
  descriptionKey: string
  category: 'baseStat' | 'damageType' | 'conditional' | 'trigger' | 'skillAmp' | 'mechanic'
  pool: 'normal' | 'abyss'
  allowedSlots: EquipmentSlot[]
  allowedWeaponTypes: WeaponType[]
  minItemLevel: number
  allowedQualities: EquipmentQuality[]
  exclusiveGroup: string | null
  stackRule: StackRule
  weight: number
  goldValue: number
  canBeCraftEmpowered: boolean
  tiers: AffixTierDefinition[]
  modifiers: ModifierSpec[]
  tags: TagContribution[]
}

export interface AffixTierDefinition {
  tier: 1 | 2 | 3 | 4 | 5
  minItemLevel: number
  rollMin: number
  rollMax: number
}

export type ModifierSpec =
  | { kind: 'flatStat'; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: 'percentStat'; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: 'damageBonus'; element: Element | 'all'; rollScaleBps: BasisPoints }
  | { kind: 'healingBonus'; rollScaleBps: BasisPoints }
  | { kind: 'shieldBonus'; rollScaleBps: BasisPoints }
  | { kind: 'finalDamageMultiplier'; rollScaleBps: BasisPoints }
  | { kind: 'conditionalDamageBonus'; condition: AffixCondition; element: Element | 'all'; rollScaleBps: BasisPoints }
  | { kind: 'conditionalPercentStat'; condition: AffixCondition; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: 'trigger'; triggerId: AffixTriggerId }
  | { kind: 'skillPower'; skillId: SkillId; rollScaleBps: BasisPoints }
  | { kind: 'replaceBasicSkill'; skillId: SkillId }
  | { kind: 'replaceDamageElement'; from: Element | 'all'; to: Element }

export type AffixCondition =
  | { kind: 'selfHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'selfHpAtLeastBps'; valueBps: BasisPoints }
  | { kind: 'targetHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'targetHpAtLeastBps'; valueBps: BasisPoints }
  | { kind: 'selfHasStatus'; statusId: StatusId }
  | { kind: 'targetHasStatus'; statusId: StatusId }
  | { kind: 'formationRow'; row: 'front' | 'back' }
  | { kind: 'roundAtMost'; round: number }
```

`rollScaleBps` 表示将实例 roll 转换为实际数值的倍率；实例只保存一个原始整数 roll。
当 `craftEmpowered = true` 时，先计算 `effectiveRoll = floor(roll × 12500 / 10000)`，再应用 `rollScaleBps`；存档中的 `roll` 永不被覆盖为强化后数值。

```ts
export interface EquipmentAffixRoll {
  affixId: EquipmentAffixId
  tier: 1 | 2 | 3 | 4 | 5
  roll: number
  craftEmpowered: boolean
  reforged: boolean
}

export interface EquipmentInstance {
  instanceId: InstanceId
  baseId: EquipmentBaseId
  itemLevel: number
  quality: EquipmentQuality
  craftGrade: CraftGrade
  affixes: EquipmentAffixRoll[]
  abyssAffix: EquipmentAffixRoll | null
  locked: boolean
  acquiredAt: string
  sourceTransactionId: string
  reforgeLockedIndex: number | null
  reforgeCount: number
}
```

- `abyssAffix` 只有 `quality: abyss` 时非空。
- `allowedSlots` 不含 weapon 时 `allowedWeaponTypes` 必须为空；包含 weapon 时空数组表示全部武器，非空数组只允许列出的类型。
- 普通 `affixes` 只能引用 `pool: normal`；`abyssAffix` 只能引用 `pool: abyss`。深渊池词条必须 `allowedQualities` 包含且仅包含 `abyss`。
- `reforgeLockedIndex` 指向 `affixes`，不能指向 `abyssAffix`。
- `reforgeCount` 为 0～2147483647 整数；每次确认重铸恰好加 1，预览、取消、失败均不增加。
- `craftEmpowered: true` 的数量必须与 `craftGrade` 的 0/1/2 一致。
- `canBeCraftEmpowered=false` 必须覆盖所有普通 trigger/skillAmp/mechanic 词条与全部 abyss 词条；固定 tempered/exalted 的“先抽强化候选、再补足剩余词条”顺序以 `game-design.md` 8.1 为唯一真源，不能先随机满词条后降级 craftGrade。
- 角色 loadout 级 exclusiveGroup 冲突、stackRule 聚合、稳定 tie-break 与被 max 抑制来源是否仍贡献 Combo 标签，全部以 `game-design.md` 8.4 为唯一真源；生成时的“同件内不重复”不能代替提交时跨六件装备/铭石校验。

## 7. 技能铭石与技能词条

```ts
export type SkillStoneQuality = 'magic' | 'rare' | 'epic' | 'abyss'
export type SkillAffixKind = 'amplify' | 'repeat' | 'followUp' | 'morph' | 'statusLink' | 'resource'

export type SkillAffixTarget =
  | { kind: 'skill'; skillId: SkillId }
  | { kind: 'family'; familyId: SkillFamilyId }
  | { kind: 'allSkills' }

export interface SkillAffixDefinition {
  id: SkillAffixId
  nameKey: string
  descriptionKey: string
  kind: SkillAffixKind
  pool: 'normal' | 'abyss'
  target: SkillAffixTarget
  minItemLevel: number
  allowedQualities: SkillStoneQuality[]
  exclusiveGroup: string | null
  stackRule: StackRule
  weight: number
  goldValue: number
  rollMin: number
  rollMax: number
  operation: SkillAffixOperation
  tags: TagContribution[]
}

export type SkillAffixOperation =
  | { kind: 'addPowerBps' }
  | { kind: 'addRepeatChanceBps'; extraHits: number }
  | { kind: 'addFollowUp'; effectSkillId: SkillId; chanceScaleBps: BasisPoints }
  | { kind: 'replaceTargetRule'; targetRule: TargetRule }
  | { kind: 'replaceDamageElement'; element: Element }
  | { kind: 'statusLink'; requiredStatusId: StatusId; effectSkillId: SkillId; chanceScaleBps: BasisPoints }
  | { kind: 'overhealToShield'; conversionScaleBps: BasisPoints; maxTargetHpBps: BasisPoints; durationOwnerTurns: number }
  | { kind: 'changeEnergy'; amountScaleBps: BasisPoints }
  | { kind: 'changeCooldown'; turns: number }

export interface SkillAffixRoll {
  skillAffixId: SkillAffixId
  roll: number
  reforged: boolean
}

export interface SkillStoneInstance {
  instanceId: InstanceId
  attunedCharacterId: CharacterId
  itemLevel: number
  quality: SkillStoneQuality
  affixes: SkillAffixRoll[]
  abyssAffix: SkillAffixRoll | null
  locked: boolean
  acquiredAt: string
  sourceTransactionId: string
  reforgeLockedIndex: number | null
  reforgeCount: number
}
```

- 铭石普通 `affixes` 数量为魔法 1、稀有 2、史诗 3、深渊 3；深渊另有 `abyssAffix`，总数 4。
- 铭石只允许装备到 `attunedCharacterId` 对应角色；生成时从当前已招募角色按 ID 升序形成候选并始终消费一次 loot/shop RNG 等权抽值。只有远征第一笔精英铭石可按存档专注字段覆盖抽值结果；UI 不能修改已经生成实例的调谐角色。
- 铭石普通 `affixes` 只能引用 `pool: normal`；`abyssAffix` 只能引用 `pool: abyss`。
- 技能词条没有锻造强化字段，所有技能词条运算中的 `effectiveRoll` 固定等于 `SkillAffixRoll.roll`；不得套用装备的 12500 bps craftEmpowered 倍率。
- `target` 是判别联合，不能同时保存 `skillId` 和 `familyId`。
- 具体 skill/family 词条只有在目标属于调谐角色时可进入生成池；`allSkills` 表示调谐角色的全部技能，不是全队技能。
- `replaceTargetRule` 和 `addFollowUp` 必须有非空 `exclusiveGroup`。
- `addPowerBps` 把 `effectiveRoll` 加到目标技能所有 damage/heal/shield 的 powerBps；不改变状态概率或固定值。
- `addRepeatChanceBps` 的最终追加概率为按 stackRule 汇总后的 roll，触发时只给目标技能的第一个 DamageEffect 增加 `extraHits`，不重复状态/治疗等后续 effect。
- `addFollowUp`/`statusLink` 的概率为 `floor(effectiveRoll × chanceScaleBps / 10000)`；追加 effect skill 进入统一触发队列，链深度 +1。
- `overhealToShield` 的转化率为 `floor(effectiveRoll × conversionScaleBps / 10000)`，单次护盾上限为被治疗目标最大生命的 `maxTargetHpBps`，生成 `status_shield` 并使用定义内的 `durationOwnerTurns`。
- `changeEnergy` 的整数变化为 `floor(effectiveRoll × amountScaleBps / 10000)`；`changeCooldown.turns` 为固定整数且冷却最少为 0。
- 铭石的 `reforgeLockedIndex/reforgeCount` 与装备同义，且只能指向普通 `affixes`。

### 7.1 重铸预览与确认

```ts
export type ReforgeItemKind = 'equipment' | 'skillStone'

export type ReforgeCandidateV1 =
  | { candidateIndex: 0 | 1 | 2; kind: 'equipment'; roll: EquipmentAffixRoll }
  | { candidateIndex: 0 | 1 | 2; kind: 'skillStone'; roll: SkillAffixRoll }

export interface ReforgePreviewV1 {
  contentVersion: 'content-1.2.0'
  itemKind: ReforgeItemKind
  instanceId: InstanceId
  lockedIndex: number
  reforgeCount: number
  costItemId: 'item_forge_shard' | 'item_inscription_dust'
  costQuantity: number
  candidates: ReforgeCandidateV1[]
}

export interface OpenReforgePreviewCommandV1 {
  expectedSaveRevision: number
  itemKind: ReforgeItemKind
  instanceId: InstanceId
  requestedIndex: number
}

export interface ConfirmReforgeCommandV1 {
  expectedSaveRevision: number
  itemKind: ReforgeItemKind
  instanceId: InstanceId
  expectedLockedIndex: number
  expectedReforgeCount: number
  candidateIndex: 0 | 1 | 2
}
```

- 首次 Open 命令若 `reforgeLockedIndex=null`，在一次存档事务中把 requestedIndex 固化并返回预览；已有锁定槽时 requestedIndex 必须相同。打开操作不扣材料、不增加 reforgeCount。
- 预览 seed 为对精确 UTF-8 namespace `reforge:<itemKind>:<contentVersion>:<instanceId>:<lockedIndex>:<reforgeCount>` 执行 FNV-1a 32，再按 RPG-003 的 SplitMix32+xoshiro128** 初始化；不读取或推进任何其他 RNG。
- `candidates` 长度为 `min(3,合法且不同 ID 的候选数)`，candidateIndex 从 0 连续递增。Confirm 重新派生并核对 expected 字段与 candidateIndex；任一不一致返回 `REFORGE_PREVIEW_STALE` 且不扣料。

## 8. Combo

```ts
export interface ComboRequirement {
  tagId: ComboTagId
  count: number
  source: 'any' | 'innate' | 'equipmentAffix' | 'equippedSkill' | 'skillAffix'
}

export interface TriggerBudget {
  maxPerRootAction: number
  maxPerRound: number
  maxPerBattle: number
}

export interface ComboDefinition {
  id: ComboId
  nameKey: string
  descriptionKey: string
  scope: 'personal' | 'party'
  requirements: ComboRequirement[]
  trigger: TriggerSpec
  effects: EffectSpec[]
  budget: TriggerBudget
  iconId: string
}

export interface TriggerSpec {
  event:
    | 'beforeAction'
    | 'afterDirectHit'
    | 'afterRootAction'
    | 'onDirectDamageTaken'
    | 'onHeal'
    | 'onOverheal'
    | 'onGainShield'
    | 'onDefeatUnit'
  requiredSkillKinds: TriggerSkillKindV1[]
  requiredHitResult: 'any' | 'critical' | 'nonCritical'
  requiredSourceHpAtMostBps: BasisPoints | null
  requiredTargetHpAtMostBps: BasisPoints | null
  requiredSourceStatusIds: StatusId[]
  requiredTargetStatusIds: StatusId[]
  consumeTargetStatus: { statusId: StatusId; stacks: number } | null
}
```

`requirements` 内同一 `{source, tagId}` 只能出现一次。匹配先扣除 source-specific 要求，再用剩余贡献满足 `source:any`；同一份标签贡献不能被两个要求重复消费。

`source='equippedSkill'` 的贡献集合按每名当前出战角色的 `CharacterProgressV1.activeSkillSlots[0]`、`activeSkillSlots[1]`、`CharacterDefinition.ultimateSkillId`、`passiveSkillId` 顺序生成，跳过 null 主动槽，并且只读取对应 `SkillDefinition.tags`。固定普攻和主动技能库中未装入槽位的技能不贡献；`SkillDefinition.familyIds` 仅供技能词条 target 适配，禁止被 matcher 当作标签或自动补入 `tags`。内容校验必须验证非空主动槽已解锁、属于该角色且两个槽不重复。

- content-1.2.0 中 `trigger.event='beforeAction'` 的定义必须恰好是 `combo_swift_formation` 与 `combo_triune_elements`，并逐字段等于 COMBO-1.2 冻结 effects/budget；装备触发和技能词条不得新增 beforeAction。两者在 BattlePhase.DRAIN_PRE_ACTION 排空后才执行根 effects，任何扩充都必须提升内容版本并重新评审是否可能提前终局。
- TriggerSpec 的 `source` 固定为拥有该 Combo/词条的 eventOwnerUnitId；party Combo 固定为产生事件的该阵营单位。`target` 固定为事件的主要对手或受益者；`onDirectDamageTaken` 中 source 是受击持有者、target 是攻击者。各事件 owner/target 的唯一映射见 `game-design.md` 9.4，不能从 effect.sourceUnitId 机械套用。
- `consumeTargetStatus` 非空时，目标层数不足则 TriggerSpec 不满足。只有条件、预算和（AffixTrigger 时）chance 全部通过后，才在事件入队的同一领域变更中精确消耗指定层数；失败或被预算拒绝均不消耗。
- `requiredSkillKinds=[]` 表示不限制技能 kind，不表示没有技能上下文；没有技能上下文的事件只有在数组为空时可匹配。

装备词条中的 `triggerId` 必须引用以下定义；机制转换必须具有非空 `exclusiveGroup`：

```ts
export interface AffixTriggerDefinition {
  id: AffixTriggerId
  trigger: TriggerSpec
  chance: { kind: 'fixed'; valueBps: BasisPoints } | { kind: 'affixRoll'; scaleBps: BasisPoints }
  effects: EffectSpec[]
  budget: TriggerBudget
}
```

`chance.kind='affixRoll'` 的最终概率固定为 `clamp(floor(effectiveRoll×scaleBps/10000),0,10000)`；其中 effectiveRoll 会读取装备词条的 craftEmpowered，但 final 内容校验又要求所有 trigger 词条 `canBeCraftEmpowered=false`，所以当前等于 raw roll。表格写“affixRoll×10000”就是 scaleBps=10000，不是再乘 10000 倍。

## 9. 敌人、遭遇与 AI

```ts
export interface EnemyDefinition {
  id: EnemyId
  nameKey: string
  level: number
  stats: StatBlock
  elementWeaknesses: Element[]
  elementResistances: Element[]
  immunityTags: string[]
  basicSkillId: SkillId
  basicTargetStrategy: EnemyTargetStrategy
  skillIds: SkillId[]
  aiRules: EnemyAiRule[]
  spriteId: string
}

export interface EnemyAiRule {
  priority: number
  conditions: AiCondition[]
  skillId: SkillId
  targetStrategy: EnemyTargetStrategy
  weight: number
}

export interface BossIntentDefinition {
  id: BossIntentId
  bossId: EnemyId
  skillId: SkillId
  targetStrategy: EnemyTargetStrategy
  delayLegalActions: 1
  counterKind: 'guard' | 'shield' | 'heal' | 'cleanse'
}

export type EnemyTargetStrategy = 'lowestHpOpponent' | 'highestAttackOpponent' | 'frontFirstOpponent' | 'randomValid' | 'lowestHpAlly' | 'self'

export type AiCondition =
  | { kind: 'always' }
  | { kind: 'selfHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'selfHasStatus'; statusId: StatusId }
  | { kind: 'selfMissingStatus'; statusId: StatusId }
  | { kind: 'anyAllyHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'anyOpponentHpAtMostBps'; valueBps: BasisPoints }
  | { kind: 'allyCountAtMost'; count: number }
  | { kind: 'opponentCountAtLeast'; count: number }
  | { kind: 'targetHasStatus'; statusId: StatusId }
  | { kind: 'targetMissingStatus'; statusId: StatusId }
  | { kind: 'targetStatusStacksAtMost'; statusId: StatusId; stacks: number }
  | { kind: 'opponentsMissingStatusCountAtLeast'; statusId: StatusId; count: number }
  | { kind: 'roundEquals'; round: number }
  | { kind: 'roundAtLeast'; round: number }

export interface EncounterDefinition {
  id: EncounterId
  kind: 'normal' | 'elite' | 'boss'
  fieldSpriteId: string
  enemyIdsBySlot: Array<EnemyId | null>
  xpReward: number
  goldRewardMin: number
  goldRewardMax: number
  dropTableId: DropTableId
  canRetreat: boolean
  modifierIds: EncounterModifierId[]
}

export interface EncounterModifierDefinition {
  id: EncounterModifierId
  nameKey: string
  descriptionKey: string
  rule:
    | { kind: 'timedStat'; faction: 'party' | 'enemy'; stat: 'attack' | 'defense' | 'speed'; valueBps: number; fromRound: number; throughRound: number }
    | { kind: 'battleStartShield'; faction: 'enemy'; maxHpBps: BasisPoints }
    | { kind: 'executeDamage'; faction: 'enemy'; targetHpAtMostBps: BasisPoints; damageBonusBps: BasisPoints }
    | { kind: 'escalatingStat'; faction: 'enemy'; stat: 'attack'; perRoundBps: BasisPoints; capBps: BasisPoints }
    | { kind: 'healingSuppression'; faction: 'party'; valueBps: BasisPoints }
}

export interface AbyssEchoDefinition {
  id: AbyssEchoId
  nameKey: string
  descriptionKey: string
  floorId: FloorId
  bossEncounterId: EncounterId
  enemyHpBps: BasisPoints
  enemyAttackBps: BasisPoints
  enemyDefenseBps: BasisPoints
  enemySpeedBps: BasisPoints
  enrageRoundDelta: -2 | -1
  itemUseLimit: 0 | 1 | 2
  objective: {
    maxRounds: number
    maxKnockouts: number
    requiredAnyComboTriggers: 0 | 1
  }
  bonusAbyssUpgradeChanceBps: BasisPoints
  firstClearForgeShards: number
  firstClearInscriptionDust: number
}
```

`enemyIdsBySlot` 长度严格为 6；`fieldSpriteId` 只按 3.1 展开并用于野外碰撞怪显示，不从队伍首个敌人或 kind 猜测；Boss 遭遇 `canRetreat` 必须为 false 且 `modifierIds=[]`。normal/elite 的 modifierIds 必须逐行等于 WORLD-1.2，不重复且全部存在。
每个敌人的 `basicSkillId` 是“敌方 fallback 槽”，允许引用 kind=basic 或 active 且 owner 为该敌人/systemEffect 的技能；`basicTargetStrategy` 由其冻结 template/Boss 表逐行写入，不从 requiresFrontAccess 或技能名推断。通过 fallback 槽执行时命令/action/contextSkillKind 一律视为 basic，不检查、不写入该 SkillDefinition 的 cooldown，仍完整使用其 target/effects；同一 active 模板被其他单位通过 aiRules 执行时仍是 active 并按自身 CD。`skillIds` 与 aiRules 均不得再包含本单位 basicSkillId。敌人其他技能同样只允许 enemy 自有或 systemEffect 模板。AI 规则没有可用候选时固定用 basicSkillId + basicTargetStrategy，fallback 也无合法目标才返回 `INVALID_CONTENT`，不跳过回合。
同一 `EnemyAiRule.conditions` 内全部条件均满足才进入候选；空数组非法，应使用单个 `always`。`anyAlly*` 包含自己；所有 count 只统计存活单位。

AI 决策顺序固定为：按 aiRules 原数组依次检查 skill 归属/冷却/资源 → 检查除 target* 外全部 conditions → 用 target* 条件过滤正式 TargetResolver 的合法候选集合 → 空集合则丢弃 rule → 在剩余 rule 取最大 priority → 按原数组顺序对同优先级 rule 做一次稳定加权抽取（一个候选也消费）→ 只为胜出 rule 应用 targetStrategy。确定性策略同值按 slot、unitId UTF-16 升序；`randomValid` 对 singleEnemy/singleAlly 才调用一次稳定等权抽取，一个候选也消费。未胜出/低优先级 rule 不选择目标、不消费 target RNG。

Boss 常规 AI 胜出后再查 `BossIntentDefinition.skillId`。首次命中时按 GAME-1.2 5.5 建立声明根行动；pending intent 存在时不做常规 AI 加权抽取。十条定义必须对 10 个 bossId/skillId 一一对应，skill owner、skillIds、AI targetStrategy 和 counterKind 均 strict 校验；enrage、phase 技能和普通/精英技能不得被引用。

EncounterModifierDefinition 的具体值必须逐字段等于 WORLD-1.2。timedStat 的 fromRound>=1、throughRound>=fromRound；start shield/execute/suppression 为 1～9999；escalating 的 perRound/cap 为正且 capBps>=perRoundBps。AbyssEchoDefinition 只引用 floor_06～floor_10 及该层 bossEncounterId，倍率范围 10000～15000、bonus 范围 0～5000、材料非负；10 个具体值不可由 floorNumber 公式生成。

targetHas/targetMissing/targetStatusStacks 条件只允许 targetRule=singleEnemy/singleAlly 的规则；self/all*/randomEnemy 配置这些条件为 INVALID_CONTENT。self/allAllies/allEnemies 的 targetStrategy 必须为 self，命令 targetUnitIds=[]；randomEnemy 必须为 randomValid，AI 不提前抽目标，命令仍为 []，由 ActionResolver 的 TargetResolver 恰好抽一次。singleEnemy 可使用四种 opponent 策略，singleAlly 只允许 lowestHpAlly/self（self 仅当自身是合法 ally）。全部规则失效时对 basicSkillId 按相同兼容矩阵使用 basicTargetStrategy，但不执行 rule weight 抽取。

Boss 胜利结算时，以 `RewardTransactionV1.source.kind='encounter'` 的 encounterId 查找唯一满足 `FloorDefinition.bossEncounterId` 的楼层。若该 Boss 尚未出现在 `WorldProgressV1.clearedBossEncounterIds`，则在同一个事务中把 `firstClearRewardTableId` 的 rolls 追加到遭遇常规掉落之后；奖励原子提交成功后才追加 cleared ID、解锁下一层或完成主线。重试沿用同一 transactionId 和已生成奖励，重复击败不再读取首通表。

`source.kind='abyssEcho'` 永远不读取 FloorDefinition.firstClearRewardTableId，也不修改楼层前缀；它按 echo 定义把对应 Boss 常规表的 eligible equipment roll 升格概率加 bonus，并在 clearedEchoIds 尚无 echoId 时追加两项固定材料。`bossRetry` 仍使用 source.kind='encounter'，所以未首通时可以正常完成首通；只是 expedition.mode 阻止其增加 echoCharges。

## 10. 地图、楼层与 NPC

```ts
export interface FloorDefinition {
  id: FloorId
  nameKey: string
  floorNumber: number
  mapId: MapId
  bossEncounterId: EncounterId
  assetBundleId: AssetBundleId
  minItemLevel: number
  maxItemLevel: number
  recommendedBossLevel: number
  recommendedItemLevel: number
  bossEnrageRound: number
  bossGateType: 'tutorial' | 'currentTier' | 'breakthrough'
  bossPhaseThresholdBps: BasisPoints[]
  shortRouteObjectIds: string[]
  isAbyss: boolean
  firstClearRewardTableId: DropTableId
}

export interface MapDefinition {
  id: MapId
  nameKey: string
  widthTiles: number
  heightTiles: number
  tileSize: 16
  assetBundleId: AssetBundleId
  spawnPoint: Vector2
  groundLayer: number[]
  decorBackLayer: number[]
  decorFrontLayer: number[]
  collisionLayer: Array<0 | 1>
  objects: MapObjectDefinition[]
}

export type MapObjectDefinition =
  | { kind: 'npc'; objectId: string; position: Vector2; npcId: NpcId; blocking: true }
  | { kind: 'encounter'; objectId: string; position: Vector2; encounterId: EncounterId; behavior: EncounterBehavior }
  | { kind: 'chest'; objectId: string; position: Vector2; dropTableId: DropTableId; frameId: 'object_chest_closed' }
  | { kind: 'portal'; objectId: string; position: Vector2; action: PortalAction; frameId: 'object_portal_floor' | 'object_portal_return' }

export interface EncounterBehavior {
  mode: 'patrol' | 'wander' | 'stationary'
  patrolPoints: Vector2[]
  wanderRadius: number
  detectionRadius: number
  leashRadius: number
  moveSpeed: number
}

export type PortalAction =
  | { kind: 'openFloorSelect' }
  | { kind: 'returnTown' }

export interface NpcDefinition {
  id: NpcId
  nameKey: string
  function: 'tavern' | 'blacksmith' | 'skillMentor' | 'merchant' | 'inn' | 'cartographer' | 'abyssWatcher'
  unlockCondition: UnlockCondition
  lockReasonKey: string
  dialogueId: DialogueId
  spriteId: string
}

export type UnlockCondition =
  | { kind: 'always' }
  | { kind: 'floorCleared'; floorNumber: number }
  | { kind: 'encounterCleared'; encounterId: EncounterId }

export interface DialogueDefinition {
  id: DialogueId
  pages: Array<{
    speakerNpcId: NpcId | null
    textKey: string
  }>
}

export interface QuestDefinition {
  id: QuestId
  nameKey: string
  descriptionKey: string
  unlockCondition: UnlockCondition
  completionCondition: UnlockCondition
}

export interface RecruitmentDefinition {
  id: RecruitmentId
  characterId: CharacterId
  condition: RecruitmentCondition
}

export type RecruitmentCondition =
  | { kind: 'questCompleted'; questId: QuestId }
  | { kind: 'gold'; goldCost: number; minimumClearedFloor: number }
  | { kind: 'firstClear'; floorNumber: number }

export interface ShopDefinition {
  id: ShopId
  npcId: NpcId
  tiers: ShopTierDefinition[]
}

export interface ShopTierDefinition {
  minHighestUnlockedFloor: number
  offerCount: number
  itemLevelMin: number
  itemLevelMax: number
  offerKindWeights: { stackableItem: number; equipment: number; skillStone: number }
  stackableItems: Array<{ itemId: ItemId; weight: number; quantityMin: number; quantityMax: number }>
  equipmentBasePools: EquipmentBasePoolGroupV1[]
  equipmentQualityWeights: Array<{ quality: EquipmentQuality; weight: number }>
  skillStoneQualityWeights: Array<{ quality: SkillStoneQuality; weight: number }>
}

export interface EquipmentBasePoolGroupV1 {
  slot: EquipmentSlot
  weight: number
  bases: Array<{ baseId: EquipmentBaseId; weight: number }>
}
```

地图层索引按 ASSET-1.2 固定解释：ground 的 0 是有效 tileset 第 0 格；两个 decor 层的 0 是空，正整数 n 读取 tileset 第 n-1 格。每个数组长度必须恰好为 `widthTiles*heightTiles`，ground 索引、decor 正索引均不得越界。

- `MapObjectDefinition.objectId` 在单张地图内唯一；position、spawnPoint 和所有 patrolPoints 都是整数逻辑像素且必须落在地图闭开边界 `[0,widthTiles*16)×[0,heightTiles*16)`。当前内容只允许 town 的唯一 `openFloorSelect + object_portal_floor` 和每张野外图的唯一 `returnTown + object_portal_return`，不存在运行时直连另一地图的 portal 分支。chest 的 frameId 固定为 object_chest_closed；这些 frame 必须存在于 core UI atlas，View 不从 action/kind 临时猜图。
- `EncounterBehavior` 按 mode 做 strict 组合校验：patrol 恰好 2 个不同点且 wanderRadius=0；wander 的 patrolPoints 为空且 wanderRadius=64；stationary 的 patrolPoints 为空且 wanderRadius=0。detection/leash/moveSpeed 及对象碰撞、固定步、预警、追击和 RNG 消费只按 WORLD-1.2 与 `game-design.md` 3.3，不增加视线、寻路或隐藏碰撞半径。
- 每个 `ShopDefinition.npcId` 必须引用 `function: merchant` 的 NPC。
- `RecruitmentCondition.gold.minimumClearedFloor` 范围为 0～10，0 表示无需层主首通；`goldCost` 可为 0，但招募仍必须通过一次 revision 校验和原子提交。
- `tiers` 按 `minHighestUnlockedFloor` 严格升序且首项为 1；刷新时只使用不大于当前最高解锁层的最后一档。
- 商店每个 offer 先按 `offerKindWeights` 抽类型。stackable 直接在对应池抽；装备/铭石先在 tier 闭区间均匀抽 itemLevel。装备随后按 itemLevel 过滤 equipmentBasePools 的各组 bases → 按组原顺序抽 slot → 在组内原顺序抽 base → 抽品质 → 生成词条/锻造特性；铭石随后抽调谐角色 → 抽品质 → 生成词条。任一正权重类型的候选池为空是内容错误。
- `equipmentBasePools` 必须按 weapon→helmet→armor→gloves→boots→accessory 恰好 6 组，组 `weight=100`；每组过滤当前 itemLevel 后至少有 1 个 base，组内条目 `weight=100`，且 base.slot 必须等于组 slot。选 slot 和选 base 是两次独立稳定加权抽取，即使组内只有 1 个 base 仍消费一次 RNG。
- `DialogueDefinition.pages` 至少一页；NPC 的 `dialogueId` 和每页非空 `speakerNpcId` 均必须通过引用校验。

## 11. 掉落表

```ts
export interface DropTableDefinition {
  id: DropTableId
  rolls: DropRollDefinition[]
}

export type DropRollDefinition =
  | {
      kind: 'stackableItem'
      itemId: ItemId
      chanceBps: BasisPoints
      quantityMin: number
      quantityMax: number
    }
  | {
      kind: 'stackableItemPool'
      itemPool: Array<{ itemId: ItemId; weight: number }>
      chanceBps: BasisPoints
      quantityMin: number
      quantityMax: number
    }
  | {
      kind: 'equipment'
      chanceBps: BasisPoints
      itemLevelMin: number
      itemLevelMax: number
      equipmentBasePools: EquipmentBasePoolGroupV1[]
      qualityWeights: Array<{ quality: EquipmentQuality; weight: number }>
      guaranteedMinQuality: EquipmentQuality | null
      abyssUpgradeChanceBps: BasisPoints
    }
  | {
      kind: 'skillStone'
      chanceBps: BasisPoints
      itemLevelMin: number
      itemLevelMax: number
      qualityWeights: Array<{ quality: SkillStoneQuality; weight: number }>
      guaranteedMinQuality: SkillStoneQuality | null
    }
  | {
      kind: 'fixedEquipment'
      chanceBps: BasisPoints
      baseId: EquipmentBaseId
      itemLevel: number
      quality: EquipmentQuality
      craftGrade: CraftGrade | 'weighted'
      fixedAbyssAffixId: EquipmentAffixId | null
    }

export type StackableItemDefinition = ConsumableItemDefinition | MaterialItemDefinition

export interface ConsumableItemDefinition {
  id: ItemId
  nameKey: string
  category: 'consumable'
  maxStack: 99
  baseGoldValue: number
  iconId: string
  useContexts: Array<'field' | 'battle'>
  targetRule: TargetRule
  effects: EffectSpec[]
}

export interface MaterialItemDefinition {
  id: ItemId
  nameKey: string
  category: 'material'
  maxStack: 99
  baseGoldValue: number
  iconId: string
}

export interface EconomyDefinition {
  equipmentSellRateBps: 2500
  shopBuyMarkupBps: 20000
  buybackLimit: 10
  innCostGold: 0
  craftGradeWeights: { ordinary: 70; tempered: 25; exalted: 5 }
  equipmentDisassembleYieldByQuality: Record<EquipmentQuality, number>
  skillStoneDisassembleYieldByQuality: Record<SkillStoneQuality, number>
  equipmentDisassembleMaterialItemId: ItemId
  skillStoneDisassembleMaterialItemId: ItemId
  stackableTotalCap: 9999
  equipmentReforgeBaseCost: 5
  equipmentReforgePerItemLevelCost: 1
  skillStoneReforgeBaseCost: 5
  skillStoneReforgePerTwoItemLevelsCost: 1
}

export type ShopOfferV1 =
  | { offerId: string; kind: 'stackableItem'; itemId: ItemId; quantity: number; goldPrice: number; sold: boolean }
  | { offerId: string; kind: 'equipment'; equipment: EquipmentInstance; goldPrice: number; sold: boolean }
  | { offerId: string; kind: 'skillStone'; skillStone: SkillStoneInstance; goldPrice: number; sold: boolean }

export interface ShopStateV1 {
  stockRevision: number
  generatedFromExpeditionId: string | null
  offers: ShopOfferV1[]
}

export type BuybackEntryV1 =
  | { sequence: number; kind: 'equipment'; equipment: EquipmentInstance; goldPrice: number }
  | { sequence: number; kind: 'skillStone'; skillStone: SkillStoneInstance; goldPrice: number }
  | { sequence: number; kind: 'stackableItem'; itemId: ItemId; quantity: number; goldPrice: number }
```

品质比较使用固定序表，不能按字符串比较。
`stackableItemPool` 先按 itemPool 原数组顺序建立稳定加权候选并抽一个 itemId，再抽 quantity；同一次 roll 只产出一种物品。equipment roll 先从 `itemLevelMin/itemLevelMax` 闭区间抽出一个 itemLevel，再按 ShopTier 同一 6 组/两次抽取规则过滤 `equipmentBasePools` 并选择底材；只要求这个已抽 itemLevel 落在所选底材有效范围内，不要求整个掉落/商店区间被单件底材覆盖。
equipment roll 先检查 `abyssUpgradeChanceBps`：成功则直接选 abyss；失败后把低于 `guaranteedMinQuality` 的项移除并从剩余 qualityWeights 抽取。该字段非 0 时 qualityWeights 的 abyss 权重必须为 0，避免重复计算；普通/额外 roll 固定填 0。
`fixedEquipment` 不进行 itemLevel/base/quality/fixedAbyssAffix 抽取：只为 normal affix 按品质生成；`craftGrade='weighted'` 时先正常生成普通词条，再按 EconomyDefinition 在合法锻造特性中重新归一化抽 grade 与目标；指定 tempered/exalted 时先预抽 1/2 条合法强化词条及各自 roll，再补足其余普通词条，不再抽 grade/目标。`quality='abyss'` 时 `fixedAbyssAffixId` 必须引用合法深渊词条，其他品质时必须为 null。所有细化 RNG 顺序以 `balance-tables.md` 5.6 为唯一真源。
新游戏事务创建 `stockRevision = 1`、`generatedFromExpeditionId = null` 的初始库存；之后库存随新远征创建在同一存档事务中刷新。读档只读取已保存的 `offers`，不得再次随机生成。本次运行会话最近 10 条 BuybackEntryV1 仅保存在 `ShopService` 内存中，sequence 单调递增；成功写入第 11 条时移除最小 sequence。回购成功后移除对应记录；失败不修改。回到标题或刷新页面后清空。

## 12. 玩家状态与存档

```ts
export interface CharacterProgressV1 {
  characterId: CharacterId
  recruited: boolean
  level: number
  xp: number
  currentHp: number
  skillPoints: number
  skillLevels: Record<SkillId, number>
  equippedActiveSkillIds: [SkillId | null, SkillId | null]
  equipmentBySlot: Record<EquipmentSlot, InstanceId | null>
  skillStoneInstanceId: InstanceId | null
}

export interface InventoryStateV1 {
  equipment: EquipmentInstance[]
  skillStones: SkillStoneInstance[]
  stackables: Record<ItemId, number>
  overflowEquipment: EquipmentInstance[]
  overflowSkillStones: SkillStoneInstance[]
}

export interface PartyStateV1 {
  slots: [CharacterId | null, CharacterId | null, CharacterId | null, CharacterId | null]
}

export interface WorldProgressV1 {
  highestUnlockedFloor: number
  clearedBossEncounterIds: EncounterId[]
  bossRetryUnlockedFloorIds: FloorId[]
  completedQuestIds: QuestId[]
  discoveredComboIds: ComboId[]
  discoveredEnemyIds: EnemyId[]
  echoCharges: number
  echoAttemptSequence: number
  clearedEchoIds: AbyssEchoId[]
  storyCompleted: boolean
}

export interface ExpeditionSnapshotV1 {
  expeditionId: string
  expeditionSeed: number
  mode: 'exploration' | 'shortFarm' | 'bossRetry' | 'abyssEcho'
  abyssEchoId: AbyssEchoId | null
  floorId: FloorId
  mapId: MapId
  playerPosition: Vector2
  safePosition: Vector2
  defeatedEncounterObjectIds: string[]
  openedChestObjectIds: string[]
  encounterProtectionStepsRemaining: number
  focusedEliteStoneConsumed: boolean
  startedAt: string
}

export interface BattleAssistStateV1 {
  enabled: boolean
  lastActionByCharacter: Record<CharacterId, { kind: 'basic' } | { kind: 'active'; skillId: SkillId } | null>
}

export interface GameSettingsV1 {
  qualityPreset: 'battery' | 'standard' | 'high'
  battleAnimationSpeed: 1 | 2
  musicVolume: number
  sfxVolume: number
  reducedFlashes: boolean
  reducedScreenShake: boolean
}

export interface GameSaveV1 {
  schemaVersion: 1
  contentVersion: 'content-1.2.0'
  saveId: 'slot_1'
  revision: number
  createdAt: string
  updatedAt: string
  gold: number
  skillStoneFocusCharacterId: CharacterId
  characters: Record<CharacterId, CharacterProgressV1>
  party: PartyStateV1
  inventory: InventoryStateV1
  shop: ShopStateV1
  world: WorldProgressV1
  expedition: ExpeditionSnapshotV1 | null
  battle: BattleSnapshotV1 | null
  battleAssist: BattleAssistStateV1
  settings: GameSettingsV1
  claimedRewardTransactionIds: string[]
}
```

- `revision` 每次成功事务加 1；保存失败不增加。
- `claimedRewardTransactionIds` 按成功提交时间保存无重复 transactionId，最多 100 个；第 101 个提交时先追加新 ID，再从数组头移除最旧项。命中任一仍保留 ID 的重试都返回 REWARD_ALREADY_CLAIMED，不重放奖励。
- `musicVolume`、`sfxVolume` 为 0～100 整数。
- 背包实例 ID 在装备、铭石、溢出及角色已装备引用中全局唯一。
- 已装备实例仍保存在 `inventory.equipment` / `inventory.skillStones` 中，角色只保存引用；120/80 容量包含已装备实例。溢出实例不能被角色引用。
- `inventory.stackables` 必须恰好包含全部已知 ItemId，每个值为 0～9999；StackableItemDefinition.maxStack=99 仅表示 UI 视觉单堆大小，不是存档总量上限。
- 新游戏必须为 ContentRoot 中每个角色创建一条 CharacterProgressV1：只有 `protagonistCharacterId` 的 `recruited = true`，其余为 false；初始队伍槽 0 为主角，其他为 null，`skillStoneFocusCharacterId=protagonistCharacterId`，`highestUnlockedFloor = 1`，远征/战斗为 null，商店按初始库存规则生成。
- 新游戏数值固定为：`gold=200`；所有角色 `level=1,xp=0,currentHp=StatCalculator 在无装备下计入固定被动后的 maxHp,skillPoints=0`；`skillLevels` 恰好包含该角色 4 个 activeSkillId 且值均为 0；两主动槽、六装备槽和铭石槽均为空。背包 equipment/skillStones/overflow 均为空，stackables 恰好包含全部 5 个已知 ItemId，只有 `item_minor_potion=3`，其余为 0。
- 新游戏 settings 固定为 `{qualityPreset:'standard',battleAnimationSpeed:1,musicVolume:80,sfxVolume:80,reducedFlashes:false,reducedScreenShake:false}`；`clearedBossEncounterIds/bossRetryUnlockedFloorIds/completedQuestIds/discoveredComboIds/discoveredEnemyIds/clearedEchoIds/claimedRewardTransactionIds` 均为空，`echoCharges=0,echoAttemptSequence=0,storyCompleted=false`；battleAssist 固定为 `enabled=false` 且 lastActionByCharacter 对 6 个 CharacterId 全为 null；`revision=1`，createdAt 与 updatedAt 使用同一个注入时间戳。
- `characters` 记录集合必须与当前内容角色集合完全一致；新增/删除角色只能通过明确 contentVersion 迁移，不能读档时临时补齐。
- `skillLevels` 的 key 集必须恰好等于该角色四个 activeSkillIds；值为 0～5 且不得高于角色等级解锁条件。`equippedActiveSkillIds` 的每个非空值必须属于该角色、当前 skillLevels>=1、当前等级已解锁，两个非空值不得重复；升级/装配/免费重置在一个事务中维护这些不变量，重置把归零技能从槽位自动写为 null。
- `clearedBossEncounterIds/completedQuestIds/discoveredComboIds/discoveredEnemyIds` 都是按首次发现顺序保存的无重复已知 ID 数组。创建战斗的同一存档事务把遭遇初始 enemyIdsBySlot 中首次出现的 EnemyId 依槽位顺序追加到 discoveredEnemyIds；`UNIT_SUMMONED` 所在根行动成功形成稳定快照时再追加召唤 enemyId。保存失败时不播放新图鉴提示，重试不得重复追加。
- `clearedBossEncounterIds` 必须恰好是楼层 1 开始的连续 Boss 前缀并按 floorNumber 升序；若前缀长度为 k，则 `highestUnlockedFloor=min(10,k+1)`，`storyCompleted` 当且仅当 k=10。completedQuestIds 只能包含已知任务且其冻结完成条件已经在某次原子结算中满足；读档不根据当前远征对象列表猜补历史任务。
- `bossRetryUnlockedFloorIds` 无重复并按首次接触顺序保存，只能引用“尚未首通或历史上曾在首通前接触”的已知楼层；UI 是否显示必须再检查对应 bossEncounterId 未在 clearedBossEncounterIds，不能靠清理历史数组猜状态。`echoCharges` 为 0～5，`echoAttemptSequence` 为非负安全整数；clearedEchoIds 无重复，只能在 storyCompleted=true 后出现并按首次成功顺序保存。
- 接触遭遇时，应用层先完成战斗 bundle detached prepare，再在一个 revision 事务中写最新 playerPosition/safePosition、BattleFactory 生成的 BattleSnapshot 与上述初始 discoveredEnemyIds；事务成功后才能 attach BattleScene。资源/保存失败时 battle 保持 null、三项探索状态不变，输入可解除冻结；禁止先存远征、后另建战斗。
- ExpeditionSnapshot 的 floorId/mapId 必须引用同一 FloorDefinition，且 floorNumber 不得高于 `highestUnlockedFloor`；playerPosition/safePosition 必须在对应地图内且脚底 AABB 不碰 collision。defeatedEncounterObjectIds/openedChestObjectIds 无重复，分别只引用该 mode 允许的 encounter/chest object，并按 MapDefinition.objects 原顺序保存。保护步数范围 0～180；新远征两位置都等于 spawnPoint、两列表为空、保护为 0。`mode='abyssEcho'` 时 abyssEchoId 必须引用同 floor/boss，其他 mode 固定 null；shortFarm 只允许 FloorDefinition.shortRouteObjectIds，bossRetry/abyssEcho 两列表必须为空且不 attach MapScene。
- 创建新远征要求 battle/expedition 均为 null、所选楼层已解锁、溢出仓为空且 PartyState 至少一名非空角色 currentHp>0；全员倒地返回 INVALID_PARTY.ALL_DEFEATED。确认 returnTown 只在 expedition!=null、battle==null 时接受，以 expectedRevision+expeditionId 防 stale，并在单一事务把 expedition 设为 null；它不改变 currentHp、库存、shop、world 或 claimed IDs。下一次创建远征才重新生成对象列表与刷新商店。
- exploration 对所有已解锁层开放；shortFarm 还要求该层 boss 已首通；bossRetry 还要求 floorId 已记录且 Boss 未首通；abyssEcho 要求 storyCompleted、echoCharges>0 和具体 echoId。只有创建 exploration/shortFarm 才按正常新远征刷新商店；bossRetry/abyssEcho 从开始到终局、失败重试和离线重载均不得改变 `shop.stockRevision/offers/generatedFromExpeditionId`。开始 bossRetry/abyssEcho 时在 detached prepare 成功后同事务直接创建 BattleSnapshot；任一步失败不得留下空壳 expedition。
- `battleAssist.lastActionByCharacter` key 集必须恰好等于 6 个角色；active skillId 必须属于该角色的四个 activeSkillIds，但允许之后被卸下，自动提交时再按当前 loadout 检查并降级。enabled 可在战斗稳定输入点切换；不满足 GAME-1.2 5.6 场景时保留偏好但不执行。
- `overflowEquipment.length + overflowSkillStones.length <= 30`；任一溢出数组非空时禁止创建新远征。
- 招募提交时，新角色写入主角当前 level、该等级累计 xp 下限、`level-1` 技能点和空 loadout，并按自身当前等级属性满生命；未招募角色的 xp/level 保持新游戏初值。该事务不得自动修改 PartyStateV1。
- `skillStoneFocusCharacterId` 必须引用 recruited=true 的角色，只能在城镇且无远征时由技能导师命令修改。创建远征时写入 `focusedEliteStoneConsumed=false`；该远征第一笔成功提交的 elite skillStone roll 强制使用 focus 角色并把该 flag 置 true，后续 elite/Boss/shop roll 按已招募角色等权抽取。奖励失败或撤退不消耗该保证。
- CharacterProgress.currentHp 必须是 0～当前静态 maxHp 的整数。等级提升、换装、胜利/撤退写回、战败 50% 和旅店满血的唯一更新公式见 `game-design.md` 4.2；读档发现越界时返回 INVALID_CONTENT/迁移阻断，不静默钳制。战斗或远征未结束时禁止换装、重铸、出售已装备实例或修改技能/铭石 loadout。

野外使用药水是独立存档命令，不伪装成战斗行动：

```ts
export interface UseFieldItemCommandV1 {
  expectedRevision: number
  itemId: ItemId
  targetCharacterId: CharacterId
}
```

命令只在 `expedition!=null && battle==null` 时接受；item 必须为 `category='consumable'` 且 useContexts 明确包含 field，目标必须是 PartyStateV1 当前非空槽中的 recruited 角色、`0<currentHp<staticMaxHp`。验证顺序固定为 expectedRevision → expedition 存在 → battle 为空 → item 存在且持有量>0 → field context → 目标存在/在队/存活/未满；前三种场景依次返回 `ITEM_USE_FORBIDDEN.NOT_IN_EXPEDITION/BATTLE_ACTIVE/WRONG_CONTEXT`，无库存返回 ITEM_NOT_OWNED，目标错误返回 INVALID_TARGET.UNKNOWN/DEAD/FULL_HP。首版 field item 必须只有单一 `HealEffect(scalingStat='maxHp',canCrit=false)`；不符合该内容形状由 ContentCatalog 在启动时判 INVALID_CONTENT，不进入运行时兼容分支。按目标当前静态 maxHp 计算并钳制缺失生命，不读取战斗状态、施法者或 healingBonus。一次 revision 事务同时扣 1 和写 currentHp；任何校验/保存失败都不扣物品，且不推进探索 fixed step、保护计数或 RNG。当前 `item_minor_potion/item_major_potion` 合法；净化药剂只有 battle context，因为战斗结束不持久化 debuff。

## 13. 战斗运行时与快照

```ts
export type BattlePhase =
  | 'INIT'
  | 'ROUND_START'
  | 'TURN_START'
  | 'AWAIT_COMMAND'
  | 'AI_DECIDE'
  | 'VALIDATE'
  | 'DRAIN_PRE_ACTION'
  | 'RESOLVE_ACTION'
  | 'DRAIN_TRIGGERS'
  | 'TURN_END'
  | 'ROUND_END'
  | 'VICTORY'
  | 'DEFEAT'
  | 'RETREAT'
  | 'REWARD_PENDING'
  | 'COMPLETE'

export interface BattleUnitStateV1 {
  unitId: string
  definitionId: CharacterId | EnemyId
  faction: 'party' | 'enemy'
  slot: number
  level: number
  prePercentStats: StatBlock
  staticPercentByStatBps: Record<keyof StatBlock, number>
  stats: StatBlock
  currentHp: number
  energy: number
  cooldowns: Record<SkillId, number>
  statuses: RuntimeStatusStack[]
  eligibleRound: number
  usedExtraTurnThisRound: boolean
  directHitEnergyRootActionIds: string[]
}

export interface PendingBattleEventV1 {
  eventId: string
  rootActionId: string
  rootActionDefinitionId: BattleActionDefinitionIdV1
  chainDepth: number
  sourceUnitId: string
  targetUnitIds: string[]
  effectIndex: number
  effect: EffectSpec
  triggerSource: TriggerSourceV1 | null
  visualSkillId: SkillId | null
  contextSkillKind: TriggerSkillKindV1 | null
}

export interface PendingBossIntentV1 {
  intentId: BossIntentId
  sourceUnitId: string
  skillId: SkillId
  targetStrategy: EnemyTargetStrategy
  declaredRound: number
}

export type BattleActionDefinitionIdV1 = SkillId | ItemId | 'action_defend' | 'action_retreat' | 'action_skip_control' | 'action_declare_intent'

export type TriggerSourceV1 =
  | { kind: 'combo'; comboId: ComboId; ownerKey: string }
  | { kind: 'equipmentAffix'; affixId: EquipmentAffixId; ownerUnitId: string; sourceInstanceId: InstanceId; sourceRollIndex: number | 'abyss' }
  | { kind: 'skillAffix'; skillAffixId: SkillAffixId; ownerUnitId: string; sourceInstanceId: InstanceId; sourceRollIndex: number | 'abyss' }
  | { kind: 'status'; statusId: StatusId; statusStackId: string; ownerUnitId: string }

export type TriggerSkillKindV1 = 'basic' | 'active' | 'ultimate' | 'effect'

export type BattleActionKindV1 = TriggerSkillKindV1 | 'defend' | 'item' | 'retreat' | 'skip' | 'intent'

export interface BattleEventBaseV1 {
  eventId: string
  sequence: number
  battleId: string
  round: number
  rootActionId: string | null
  rootActionDefinitionId: BattleActionDefinitionIdV1 | null
  chainDepth: number
  triggerSource: TriggerSourceV1 | null
  visualSkillId: SkillId | null
  contextSkillKind: TriggerSkillKindV1 | null
  effect: EffectSpec | null
}

export type BattleDomainEventV1 =
  | (BattleEventBaseV1 & {
      type: 'PHASE_CHANGED'
      from: BattlePhase
      to: BattlePhase
    })
  | (BattleEventBaseV1 & {
      type: 'ACTION_STARTED'
      actorUnitId: string
      actionKind: Exclude<BattleActionKindV1, 'effect'>
      targetUnitIds: string[]
    })
  | (BattleEventBaseV1 & {
      type: 'INTENT_DECLARED'
      intentId: BossIntentId
      sourceUnitId: string
      skillId: SkillId
      targetStrategy: EnemyTargetStrategy
    })
  | (BattleEventBaseV1 & {
      type: 'INTENT_RELEASED'
      intentId: BossIntentId
      sourceUnitId: string
      skillId: SkillId
    })
  | (BattleEventBaseV1 & {
      type: 'INTENT_CLEARED'
      intentId: BossIntentId
      sourceUnitId: string
      reason: 'sourceDefeated' | 'battleFinished'
    })
  | (BattleEventBaseV1 & {
      type: 'DAMAGE_RESOLVED'
      sourceUnitId: string
      targetUnitId: string
      effectIndex: number
      hitIndex: number
      damageKind: 'direct' | 'periodic'
      element: Element
      hitResult: 'critical' | 'nonCritical' | 'notApplicable'
      varianceBps: BasisPoints | null
      effectiveDefense: number
      elementMultiplierBps: 7500 | 10000 | 12500
      shieldDamage: number
      hpDamage: number
      overkill: number
      hpBefore: number
      hpAfter: number
    })
  | (BattleEventBaseV1 & {
      type: 'HEAL_RESOLVED'
      sourceUnitId: string
      targetUnitId: string
      effectIndex: number
      hitResult: 'critical' | 'nonCritical' | 'notApplicable'
      healed: number
      overheal: number
      hpBefore: number
      hpAfter: number
    })
  | (BattleEventBaseV1 & {
      type: 'SHIELD_GRANTED'
      sourceUnitId: string
      targetUnitId: string
      effectIndex: number
      statusStackId: string | null
      granted: number
      discardedByCap: number
      shieldAfter: number
    })
  | (BattleEventBaseV1 & {
      type: 'STATUS_CHANGED'
      sourceUnitId: string | null
      targetUnitId: string
      statusId: StatusId
      statusStackId: string | null
      change: 'applied' | 'refreshed' | 'stacked' | 'capped' | 'consumed' | 'dispelled' | 'expired' | 'resisted' | 'immune' | 'depleted'
      stacksBefore: number
      stacksAfter: number
      remainingOwnerTurnsAfter: number
    })
  | (BattleEventBaseV1 & {
      type: 'RESOURCE_CHANGED'
      targetUnitId: string
      resource: 'energy' | 'cooldown'
      skillId: SkillId | null
      before: number
      after: number
      reason: 'actionCost' | 'actionGain' | 'directHit' | 'damageTaken' | 'turnEnd' | 'effect'
    })
  | (BattleEventBaseV1 & {
      type: 'UNIT_SUMMONED'
      sourceUnitId: string
      unitId: string
      enemyId: EnemyId
      slot: number
      eligibleRound: number
    })
  | (BattleEventBaseV1 & {
      type: 'UNIT_DEFEATED'
      sourceUnitId: string | null
      unitId: string
    })
  | (BattleEventBaseV1 & {
      type: 'UNIT_REVIVED'
      sourceUnitId: string
      unitId: string
      restoredHp: number
    })
  | (BattleEventBaseV1 & {
      type: 'TURN_SKIPPED'
      unitId: string
      reason: 'defeated' | 'control'
      statusId: StatusId | null
    })
  | (BattleEventBaseV1 & {
      type: 'EXTRA_TURN_RESOLVED'
      unitId: string
      result: 'granted' | 'suppressed'
    })
  | (BattleEventBaseV1 & {
      type: 'COMBO_TRIGGERED'
      comboId: ComboId
      ownerKey: string
      targetUnitIds: string[]
      firstInBattle: boolean
    })
  | (BattleEventBaseV1 & {
      type: 'TRIGGER_REJECTED'
      sourceKey: string
      reason: 'CHAIN_DEPTH' | 'ROOT_BUDGET' | 'ROUND_BUDGET' | 'BATTLE_BUDGET' | 'UNIT_DAMAGE_BUDGET' | 'GLOBAL_EVENT_BUDGET' | 'SOURCE_INVALID' | 'TARGET_INVALID' | 'CHANCE_FAILED'
      consumedRng: boolean
    })
  | (BattleEventBaseV1 & {
      type: 'ACTION_FINISHED'
      actorUnitId: string
      outcomeAfter: 'ongoing' | 'victory' | 'defeat' | 'retreat'
    })
  | (BattleEventBaseV1 & {
      type: 'BATTLE_FINISHED'
      outcome: 'victory' | 'defeat' | 'retreat'
    })
  | (BattleEventBaseV1 & {
      type: 'ABYSS_ECHO_EVALUATED'
      echoId: AbyssEchoId
      success: boolean
      failedReasons: Array<'MAX_ROUNDS' | 'MAX_KNOCKOUTS' | 'COMBO_REQUIRED'>
    })
  | (BattleEventBaseV1 & {
      type: 'REWARD_PREPARED'
      transactionId: string
    })

export interface BattleResolutionV1 {
  snapshot: BattleSnapshotV1
  events: BattleDomainEventV1[]
  consumedItem: { itemId: ItemId; quantity: 1 } | null
}

export interface BattleDamageMetricV1 {
  sourceFaction: 'party' | 'enemy'
  sourceKind: 'skill' | 'item' | 'combo' | 'equipmentAffix' | 'skillAffix' | 'status'
  sourceDefinitionId: string
  element: Element
  resolvedDamage: number
  weaknessResolvedDamage: number
}

export interface BattleMetricsV1 {
  damage: BattleDamageMetricV1[]
  partyDamageTaken: number
  partyHealingDone: number
  partyShieldGranted: number
  knockouts: Array<{ unitId: string; round: number; rootActionId: string }>
  comboTriggerCounts: Record<ComboId, number>
  bossEnrageCast: boolean
  maxChainDepth: number
  triggerBudgetExhaustedCount: number
}

export interface BattleSnapshotV1 {
  battleId: string
  expeditionId: string
  battleRevision: number
  encounterId: EncounterId
  encounterObjectId: string
  phase: BattlePhase
  outcome: 'ongoing' | 'victory' | 'defeat' | 'retreat'
  round: number
  units: BattleUnitStateV1[]
  initiativeQueueUnitIds: string[]
  currentUnitId: string | null
  pendingEvents: PendingBattleEventV1[]
  pendingBossIntents: PendingBossIntentV1[]
  successfulItemUses: number
  abyssEchoOutcome: 'notApplicable' | 'pending' | 'success' | 'failed'
  rngState: [number, number, number, number]
  firedComboKeys: string[]
  roundTriggerCounts: Record<string, number>
  battleTriggerCounts: Record<string, number>
  metrics: BattleMetricsV1
  reward: RewardTransactionV1 | null
  returnMapId: MapId
  returnSafePosition: Vector2
}

export interface RewardTransactionV1 {
  transactionId: string
  source:
    | { kind: 'encounter'; encounterId: EncounterId; mapId: MapId; objectId: string }
    | { kind: 'chest'; mapId: MapId; objectId: string; dropTableId: DropTableId }
    | { kind: 'abyssEcho'; echoId: AbyssEchoId; encounterId: EncounterId }
  gold: number
  xp: number
  stackables: Record<ItemId, number>
  stackableCapConversions: Array<{ itemId: ItemId; quantity: number; gold: number }>
  equipment: EquipmentInstance[]
  skillStones: SkillStoneInstance[]
  instanceOrder: InstanceId[]
  claimed: boolean
}
```

- 只在稳定快照点持久化 `BattleSnapshotV1`；因此正常存档里的 `pendingEvents` 必须为空。
- 每次领域调用返回 `BattleResolutionV1`；成功结果的 `events.sequence` 必须从 0 连续递增，数组顺序就是唯一播放/日志顺序。只有成功的 USE_ITEM 返回与命令 ItemId 相同的 `consumedItem={quantity:1}`，其他命令和控制跳过固定为 null。SaveCoordinator 必须在同一个 IndexedDB `readwrite` transaction 中读取实际已存 revision、执行 CAS 并应用该扣除与 snapshot；提交前不得改写权威 GameStore 或外发 events。保存失败时二者都不提交，丢弃 events，保留不可变 command/candidate 或从旧 battle/inventory/RNG 确定性重算同一结果。多标签页 stale revision 永远不得覆盖新记录，必须阻断并要求重载。命令校验失败返回 DomainError 且不返回部分 resolution；BattleAnimator 不得重新排序、补造或反推数值事件。
- `pendingBossIntents` 按来源 faction/slot/unitId 稳定排序，每个 sourceUnitId 至多一条；内容-1.2 实际至多一条。声明根固定 `ACTION_STARTED(intent)→INTENT_DECLARED→ACTION_FINISHED`，三者共享非空 rootActionId/action_declare_intent；不产生 RESOURCE_CHANGED。释放根先输出真实 skillId 的 ACTION_STARTED，再输出 INTENT_RELEASED，随后执行技能 effects；pending 项在输出 release 时删除。来源死亡或战斗终止而未释放时输出 INTENT_CLEARED 并删除，不改 outcome。
- `successfulItemUses` 创建战斗时为 0，只在 USE_ITEM 根行动与库存扣除一起成功提交时 +1。非回响不设上限；回响在命令校验“指令可用”阶段比较 AbyssEchoDefinition.itemUseLimit，达到上限返回 `ITEM_USE_FORBIDDEN.ECHO_LIMIT` 且不产生事件。
- `abyssEchoOutcome` 非回响固定 notApplicable；回响创建为 pending。敌方全灭后按 MAX_ROUNDS→MAX_KNOCKOUTS→COMBO_REQUIRED 顺序收集失败原因并输出唯一 ABYSS_ECHO_EVALUATED；无原因写 success 并继续 REWARD_PREPARED，有原因写 failed、不生成 RewardTransaction，仍完成战斗并直接回城。
- `PHASE_CHANGED` 与因队列残留死亡单位产生的 `TURN_SKIPPED(reason='defeated')` 固定 `rootActionId/rootActionDefinitionId/triggerSource/visualSkillId/contextSkillKind/effect=null`、`chainDepth=0`。成功命令、意图声明及受控制跳过回合均建立一个根行动；其余由该根结算产生的事件（含终局/奖励事件）必须保存同一个非空 rootActionId/DefinitionId。`effect` 仅在该事件由某个 EffectSpec 的应用产生时保存那一份 strict 值，否则为 null。
- 根技能开始时 `ACTION_STARTED.visualSkillId` 为实际执行的 SkillId（含 `replaceBasicSkill` 后的 SkillId）；item/defend/retreat/skip 为 null。根技能后续效果事件不再播放动作前摇：其 `triggerSource=null,visualSkillId=null`。派生事件有明确 effect Skill 时写 `visualSkillId` 并播放其 AnimationDefinition；`visualSkillId=null && effect!=null` 且（`triggerSource!=null` 或 rootActionDefinitionId 能在 Item Catalog 中精确查到）时才调用 ASSET-1.2 内联分类器。`action_defend/action_retreat/action_skip_control` 不满足物品查找，避免根技能、防御与流程事件重复播放。
- `contextSkillKind` 是触发条件读取的“当前效果技能上下文”，不是从 rootActionDefinitionId 反推：根 basic/active/ultimate 的 ACTION_STARTED、beforeAction、各根 effect 与 afterRootAction 保存对应 kind；`replaceBasicSkill` 后仍为 basic；技能词条调用的 effect Skill 及其各 effect 保存 effect；道具、防御、撤退、受控制跳过、状态周期和不调用 effect Skill 的 Combo/装备/技能词条内联派生保存 null。由内联派生继续产生的候选也读取 null，不继承根技能 kind。`TriggerSpec.requiredSkillKinds` 只匹配此字段。
- `DAMAGE_RESOLVED` 每个实际目标、每段各一条；direct 的 hitResult 只能 critical/nonCritical 且 varianceBps 为 9500～10500，periodic 固定 notApplicable/null。`shieldDamage+hpDamage` 是实际 resolvedDamage，overkill 单列且不计指标。
- ApplyStatus 按 TargetResolver 的稳定目标顺序，对每个目标只做一次命中判定，不按 requested stacks 重复抽 RNG；成功后按 stackIndex 0→N-1 应用。independentStacks 每个成功新建层分别输出 applied（此前 0 层）或 stacked，携带新 stackId；每个超过 maxStacks 的请求层分别输出 capped。replaceDuration 的 ApplyStatus.stacks 必须为 1，输出 applied/refreshed。resisted/immune/capped 的 stackId=null、remainingOwnerTurnsAfter=0。所有 STATUS_CHANGED.stacksBefore/After 都是该条事件前后的目标总层数。
- ConsumeStatus 与 Dispel 按 `game-design.md` 的稳定顺序每移除一个 RuntimeStatusStack 就各输出一条 consumed/dispelled；自然到期和护盾耗尽同样逐 stack 输出 expired/depleted，removed event 的 remainingOwnerTurnsAfter=0。sourceUnitId 表示造成本次改变的效果来源；自然到期为 null，护盾被伤害耗尽时为该伤害来源（来源已离场仍保留原 unitId）。replaceDuration 只输出一条 refreshed 并携带新 stackId，不额外把旧 stack 记为 expired。
- `status_shield` 只能由 ShieldEffect 或 overhealToShield 创建，ApplyStatusEffectSpec 引用它是 INVALID_CONTENT；创建时只输出 SHIELD_GRANTED，不再重复输出 STATUS_CHANGED.applied。`desired=max(0,常规 finalShield 或过量治疗乘转化率后的值)`；后者先受单次 maxTargetHpBps 上限，随后两者都受 status_shield.maxStacks=99 容量约束。`granted` 是实际新建 stack 的 shieldRemaining，`discardedByCap=desired-granted`，`shieldAfter` 是目标全部护盾栈剩余值之和；desired=0 或已有 99 栈时 statusStackId=null 且不产生 onGainShield，其他成功创建时为新 stackId。常规护盾无单次数值上限。
- `TRIGGER_REJECTED` 是规则/诊断事件，BattleAnimator 不显示；只有 `reason='CHANCE_FAILED'` 时 `consumedRng=true`，其他拒绝固定 false。预算类拒绝增加 triggerBudgetExhaustedCount；来源/目标无效与 chance 失败不增加。`BATTLE_FINISHED` 在全部队列排空后恰好一次；victory 随后恰好一条 `REWARD_PREPARED`，defeat/retreat 不产生奖励事件。
- `prePercentStats` 是等级成长、装备底材、固定被动 flat 与无条件 flat 全部相加后的八字段快照；`staticPercentByStatBps` 也必须恰好含八个 StatBlock key，记录固定被动和无条件装备的同区 percent 总和，允许负整数。`stats[k]=clampStat(k,floor(prePercentStats[k]×(10000+staticPercentByStatBps[k])/10000))`，是无动态条件时的可核对 baseline。敌人固定 `prePercentStats=EnemyDefinition.stats`、八个静态百分比全 0、`stats=EnemyDefinition.stats`。
- 每次读取有效属性时固定计算 `clampStat(k,floor((prePercentStats[k]+dynamicFlat[k])×(10000+staticPercentByStatBps[k]+dynamicPercentBps[k])/10000))`；dynamic 只来自当前满足的条件词条与状态，缺项按 0。`clampStat` 对 maxHp/attack/defense/speed 下限 1，critRate/effectHit/effectResist 钳制 0～10000，critDamage 钳制 10000～30000。不得从 `stats` 再乘动态百分比，也不得重新加入 GameSave 中已经固化进 prePercent/staticPercent 的装备数值。GameSave loadout 在战斗中只用于枚举条件词条、触发、技能修改与标签，并在整个战斗期间禁止换装/重铸/出售；派生有效值不写回三个快照字段。
- DamageCondition、AffixCondition、TriggerSpec 和 EnemyAiCondition 的所有 HP bps 门槛统一使用 `game-design.md` 4.2 的整数交叉相乘口径；不能计算浮点比例，也不能让 HP 条件 maxHp 词条参与门槛分母形成自引用。
- `outcome` 在战斗未终止时必须为 `ongoing`；进入 VICTORY/REWARD_PENDING 为 `victory`，DEFEAT 为 `defeat`，RETREAT 为 `retreat`，COMPLETE 保留最终 outcome。
- personal Combo 的 ownerKey 为 unitId，party Combo 固定为 `party`；`firedComboKeys` 分别为 `${rootActionId}:${unitId}:${comboId}` 与 `${rootActionId}:party:${comboId}`。
- 通用 trigger budget key 固定为：Combo `${ownerKey}:combo:${comboId}`；装备词条 `${ownerUnitId}:equipmentAffix:${affixId}`；技能词条 `${ownerUnitId}:skillAffix:${skillAffixId}`。`roundTriggerCounts` 与 `battleTriggerCounts` 均使用该 key；status 周期效果只受全局派生事件预算，不写这两个表。
- `roundTriggerCounts/battleTriggerCounts` 是稀疏 Record，缺 key 明确视为 0；前者在每个 ROUND_START 重置为空对象，后者只在创建战斗时初始化为空。rootTriggerCounts、单根每来源单位派生伤害数和单根全局派生事件数只存在于一次同步 RootActionRuntime，不进入稳定 BattleSnapshot；每个新命令或 action_skip_control 都从空/0 开始。候选成功、整组 effects 原子入队后才更新这些计数，计数单位和拒绝优先级以 `game-design.md` 9.3 为唯一真源。
- 同一领域事件的装备词条、技能词条、personal Combo、party Combo 候选排序，以及独立状态周期事件、失败时 RNG/budget/status 是否消费及 FIFO 追加规则严格采用 `game-design.md` 9.4。owner faction 的稳定序固定 party→enemy；字符串比较固定 ECMAScript UTF-16 code unit 升序，禁止受 locale 影响。
- `triggerSource=null` 只允许根行动直接创建的 skill/item/defend effects 以及本身不由效果产生的流程事件；任何 Combo、装备词条、技能词条或状态产生的派生 EffectSpec 必须保存非空来源。status 来源必须同时固化 statusId、stackId 与持有者 unitId，不能在 stack 已移除后反查归因。所有 key 都是领域内部稳定字符串，不从 UI 文案或实例名字推导。
- 装备/技能词条 triggerSource 必须固化实际实例 ID 与原数组位置；普通 affixes 使用 0-based 整数，abyssAffix 使用字面量 `abyss`。该位置必须在入队时与 affixId 交叉校验，详情日志据此显示精确来源；budget key 仍按上一条定义聚合，不能偷偷改成 instance 级预算。
- `visualSkillId` 仅在技能词条 `addFollowUp`/`statusLink` 调用一个明确 effect SkillDefinition 时写该 SkillId；Combo、装备词条、非技能化的技能词条派生效果与状态周期效果固定为 `null`。表现层有值时读取该技能的 AnimationDefinition，无值时严格走 ASSET-1.2 的内联效果分类器；该字段不参与伤害、预算、RNG、指标归因或 AI。
- `PendingBattleEventV1.effectIndex` 固定为其来源 effects 数组的 0-based 下标；effect Skill 使用该技能第 1 级 effects 数组下标，TriggerDefinition/ComboDefinition 使用自身 effects 下标，过量转盾和状态周期等单一合成效果固定为 0。由该 effect 产生的 DAMAGE/HEAL/SHIELD 事件复制此值；不得用队列序号代替。
- PendingBattleEventV1.targetUnitIds 使用与 BattleCommand 相同的严格数量语义：singleEnemy/singleAlly/deadAlly 在入队时固化恰好 1 个继承目标；self/allAllies/allEnemies/randomEnemy 固定为空并在实际应用时由 TargetResolver 解析。候选检查阶段若任一带 targetRule 的 effect 当下没有至少一个合法目标，整组以 TARGET_INVALID 拒绝且不抽 chance；成功入队后目标变化不回滚预算。应用时 single 目标失效则该 event 跳过并输出 TARGET_INVALID，不改选；auto 目标按应用瞬间状态解析，random 按正常 RNG 规则抽取。SummonEffect 的 targetUnitIds 固定为空且不参与此目标预检；无空槽仍按召唤规则安全结算。
- 除状态周期伤害外，Pending 事件应用前要求 sourceUnitId 仍对应存活单位，否则跳过并输出 SOURCE_INVALID，已消费的 chance/预算不回滚。状态周期允许来源死亡或离场：到时点入队时立即计算 `raw=floor(sourceAttackSnapshot×snapshotPowerBps/10000)`，固化为 `{kind:'damage',targetRule:'singleEnemy',element:<状态元素>,powerBps:0,flatPower:raw,canCrit:false,ignoreDefenseBps:0,flatIgnoreDefense:0,hitCount:1,retargetEachHit:false,conditionalMultipliers:[]}`，targetUnitIds 固化为状态持有者，triggerSource 保存 status 三元来源。应用时凭 triggerSource 判为 periodic，只取该 flatPower、目标当下防御与元素倍率，不再反查已可能移除的 stack 或来源属性。
- `rootActionDefinitionId` 是本次根命令或跳过回合实际执行的定义：basic（若有 `replaceBasicSkill` 则为替换后的 SkillId）、active/ultimate SkillId、USE_ITEM 的 ItemId、DEFEND 的 `action_defend`、RETREAT 的 `action_retreat`，或控制跳过的 `action_skip_control`；所有派生事件沿用。根行动的 skillKind 独立保留命令语义，替换后的普攻仍是 basic。指标归因优先使用非空 triggerSource，否则使用该 ID；defend/retreat/skip 本身不产生伤害指标。
- `resolvedDamage` 是本段最终伤害中实际消耗护盾与生命的总和，排除过量伤害；weaknessResolvedDamage 只有本段元素倍率为 12500 时等于该值，否则为 0。damage 数组按四元组 `(sourceFaction,sourceKind,sourceDefinitionId,element)` 聚合，条目顺序取该四元组首次产生非零 resolvedDamage 的事件顺序，读档保持顺序。
- 指标归因映射固定为：triggerSource combo/equipmentAffix/skillAffix/status 分别写 sourceKind 与 comboId/affixId/skillAffixId/statusId；triggerSource=null 的 SkillId/ItemId 根效果分别为 skill/item。action_defend/action_retreat/action_skip_control 不建立 damage 条目。sourceFaction 读取 sourceUnitId 在本场的冻结 faction，死亡不改变；无法在本场解析来源 unitId 是 INVALID_CONTENT，而不是临时归给当前行动者。
- `partyDamageTaken` 同样计入我方护盾吸收与实际生命损失且排除过量；healingDone 排除过量治疗，shieldGranted 记录经过上限后实际创建值。每次 currentHp 首次从正数变为 0 都追加 knockout，复苏后再次倒地可追加第二条。
- `bossEnrageCast` 只在 `status_boss_enrage` 成功施加时变 true；达到回合但被控制尚未施放仍为 false。metrics 只用于日志、诊断与平衡报告，不能参与 AI、掉落、伤害或 RNG。
- BattleFactory 初始化 metrics 为：damage/knockouts 空数组，三个总量与 maxChainDepth/triggerBudgetExhaustedCount 均为 0，bossEnrageCast=false，comboTriggerCounts 恰好包含内容中的 18 个 ComboId 且值全 0；同时 pendingBossIntents=[]、successfulItemUses=0，abyssEchoOutcome 按 mode 初始化；不存在的 Combo key 非法。
- 生成 RewardTransaction 时按 roll 顺序和生成瞬间权威库存，把各 stackable 可容纳数量写入 stackables；超过 9999 的部分按 StackableItemDefinition.baseGoldValue 100% 转金币。conversions 只保留 quantity>0 的行，按首次溢出 roll 顺序，每个 itemId 至多一行，gold 必须等于 quantity×baseGoldValue。重载/重试不重新根据后来库存计算。
- `RewardTransactionV1.instanceOrder` 必须恰好包含 equipment 与 skillStones 的全部 instanceId 各一次，顺序等于掉落 rolls 实际产出顺序。领取 dry-run 与共享溢出仓分配只按该顺序；主背包和 30 格溢出仍放不下时整笔不提交。
- battle 非空且 phase!=COMPLETE 时 expedition 必须同时非空。exploration/shortFarm/bossRetry 的 BattleSnapshot.expeditionId/returnMapId/encounterObjectId/encounterId 必须逐项等于当前 ExpeditionSnapshot 及其 MapDefinition 中唯一 encounter object；进入 REWARD_PENDING 前该 object 不得已在 defeatedEncounterObjectIds，reward source 固定 encounter。abyssEcho 始终要求 expedition.abyssEchoId 引用同一回响、encounterId 等于定义 bossEncounterId、encounterObjectId 固定为空字符串且 returnMapId=`map_town`；仅当 `reward!=null` 时额外要求 `reward.source.kind='abyssEcho'` 且 `reward.source.echoId=expedition.abyssEchoId`。`abyssEchoOutcome='pending'|'failed'` 必须 `reward=null`；只有 success 且处于已准备奖励的 REWARD_PENDING/COMPLETE 状态才允许非空 reward。宝箱交互用 `chest:<mapId>:<objectId>` 子流生成 `source.kind='chest'`、gold=0、xp=0 的同结构事务，立即做相同 9999/120/80/30 dry-run，并在一个 GameSave revision 事务中提交资产、claimedRewardTransactionIds 与 openedChestObjectIds；不进入战斗奖励页、不允许部分领取。容量或保存失败时三者都不修改，宝箱保持关闭；重试从同一 namespace 重新生成相同内容 roll。已开启对象不会再次成为交互候选。
- 所有终局持久化先形成可重试的 COMPLETE 哨兵，再由下一次幂等 cleanup 清理。exploration/shortFarm 胜利提交奖励/HP/XP/首通/任务、追加 defeated object并回 returnSafePosition；exploration 的 F6～10 Boss 胜利在同事务令 echoCharges=min(5,+1)。bossRetry 胜利提交正常 Boss/首通奖励后令 expedition=null；abyssEcho 成功提交增强 Boss 奖励、一次性材料/clearedEchoIds 后令 expedition=null，挑战目标失败也令 expedition=null 但不生成奖励。retreat 只可能来自 exploration/shortFarm 普通或精英，并返回安全点；任意 defeat 写全体已招募角色 50% HP、expedition=null。每条路径最后写对应 COMPLETE；cleanup 保存失败时保留 COMPLETE，标题继续入口重复 cleanup，绝不重复资产、次数、首通、材料或对象写入。

## 14. 玩家战斗命令

```ts
export type BattleCommandV1 =
  | { type: 'USE_BASIC'; expectedBattleRevision: number; actorUnitId: string; targetUnitIds: string[] }
  | { type: 'USE_SKILL'; expectedBattleRevision: number; actorUnitId: string; skillId: SkillId; targetUnitIds: string[] }
  | { type: 'USE_ULTIMATE'; expectedBattleRevision: number; actorUnitId: string; skillId: SkillId; targetUnitIds: string[] }
  | { type: 'DEFEND'; expectedBattleRevision: number; actorUnitId: string }
  | { type: 'USE_ITEM'; expectedBattleRevision: number; actorUnitId: string; itemId: ItemId; targetUnitIds: string[] }
  | { type: 'RETREAT'; expectedBattleRevision: number; actorUnitId: string }
```

命令验证顺序固定为：`expectedBattleRevision` → 战斗 phase → 当前行动者 → 存活 → 指令可用 → 资源/冷却 → 目标数量 → 目标合法性 → 阵型限制。每个根行动完整结算后 `battleRevision + 1`；失败返回明确 reason，不修改状态。

USE_ITEM 的“指令可用”只接受 Item Catalog 中 `category='consumable'`、useContexts 包含 battle 且 InventoryState 对应数量至少 1 的定义；错误 context 返回 `ITEM_USE_FORBIDDEN.WRONG_CONTEXT`，不存在或数量为 0 返回 ITEM_NOT_OWNED。目标数量/阵营严格读取该物品的 target，effects 按原数组作为本根效果，不从中文名或 itemId 推断。ActionResolver 只在成功 resolution 中声明 consumedItem，不直接修改独立 InventoryState；应用层不得先扣物品后另存战斗，也不得在动画开始后才扣。

所有技能命令都先生成本次不可变 ResolvedSkill：`USE_BASIC` 存在合法 `replaceBasicSkill` 时以替换 effect skill 的 target/effects 为底，否则使用角色/敌人的 basicSkillId；`USE_SKILL/USE_ULTIMATE` 使用命令引用且已装备/固定的技能。随后按 `skill-affix-tables.md` 的 morph→power/repeat/resource/follow-up 顺序注入当前 loadout，再用解析后的 targetRule/requiresFrontAccess 校验 targetUnitIds。singleEnemy/singleAlly/deadAlly 恰好传 1 个，self/allAllies/allEnemies/randomEnemy 必须传空数组并由 TargetResolver 稳定展开，不能因命令类型把普攻重新写死为单体。ResolvedSkill 只存在于本根行动，不写回 ContentCatalog；`replaceBasicSkill` 后的命令/contextSkillKind 仍是 basic，allSkills 铭石仍将其视为该角色的 basic 槽。

`BattleUnitStateV1.cooldowns` 的值是剩余阻断计数；使用冷却 N 的主动/终极技能时按 `game-design.md` 写入 N+1，并只在该单位自己的 TURN_END 递减。敌方 Record 恰好包含 `basicSkillId + skillIds`，但 basicSkillId 项永远保持 0，即使它引用 active 模板；角色 Record 恰好包含 basic、当前 0～2 个非空已装备 active 和固定 ultimate，basic 同样保持 0，均初始化为 0。空主动槽不建立 key；passive/effect 不进入 Record，未列技能不能按缺省 0 查询。

## 15. 领域错误

```ts
export type DomainErrorCode =
  | 'INVALID_CONTENT'
  | 'UNSUPPORTED_SAVE_VERSION'
  | 'STALE_REVISION'
  | 'STALE_BATTLE_REVISION'
  | 'INVALID_PARTY'
  | 'CHARACTER_ALREADY_RECRUITED'
  | 'RECRUITMENT_LOCKED'
  | 'INSUFFICIENT_GOLD'
  | 'NOT_IN_TOWN'
  | 'NPC_LOCKED'
  | 'FLOOR_LOCKED'
  | 'EXPEDITION_MODE_LOCKED'
  | 'ABYSS_ECHO_LOCKED'
  | 'INVALID_BATTLE_PHASE'
  | 'NOT_CURRENT_ACTOR'
  | 'SKILL_LOCKED'
  | 'SKILL_ON_COOLDOWN'
  | 'INSUFFICIENT_ENERGY'
  | 'INVALID_TARGET'
  | 'FORMATION_BLOCKED'
  | 'RETREAT_FORBIDDEN'
  | 'INVENTORY_FULL'
  | 'OVERFLOW_NOT_EMPTY'
  | 'ITEM_NOT_OWNED'
  | 'ITEM_USE_FORBIDDEN'
  | 'ITEM_LOCKED'
  | 'ITEM_EQUIPPED'
  | 'WEAPON_NOT_ALLOWED'
  | 'SKILL_LOCKED_BY_LEVEL'
  | 'SKILL_LEVEL_MAX'
  | 'INSUFFICIENT_SKILL_POINTS'
  | 'AFFIX_POOL_EMPTY'
  | 'AFFIX_CONFLICT'
  | 'AFFIX_NOT_REFORGEABLE'
  | 'REFORGE_PREVIEW_STALE'
  | 'SHOP_OFFER_UNAVAILABLE'
  | 'BUYBACK_UNAVAILABLE'
  | 'STACKABLE_CAP_EXCEEDED'
  | 'REWARD_ALREADY_CLAIMED'
  | 'SAVE_FAILED'
  | 'ASSET_LOAD_FAILED'

export interface DomainErrorDetailsByCode {
  INVALID_CONTENT: { path: string; issueKey: string }
  UNSUPPORTED_SAVE_VERSION: { schemaVersion: number; contentVersion: string }
  STALE_REVISION: { expectedRevision: number; actualRevision: number }
  STALE_BATTLE_REVISION: { expectedRevision: number; actualRevision: number }
  INVALID_PARTY: { reason: 'EMPTY' | 'PROTAGONIST_REQUIRED' | 'DUPLICATE_CHARACTER' | 'UNKNOWN_CHARACTER' | 'NOT_RECRUITED' | 'ALL_DEFEATED'; characterId: CharacterId | null }
  CHARACTER_ALREADY_RECRUITED: { characterId: CharacterId }
  RECRUITMENT_LOCKED: { recruitmentId: string }
  INSUFFICIENT_GOLD: { required: number; owned: number }
  NOT_IN_TOWN: null
  NPC_LOCKED: { npcId: NpcId; lockReasonKey: string }
  FLOOR_LOCKED: { floorNumber: number }
  EXPEDITION_MODE_LOCKED: { mode: 'shortFarm' | 'bossRetry'; floorId: FloorId; reason: 'FLOOR_NOT_CLEARED' | 'BOSS_NOT_CONTACTED' | 'BOSS_ALREADY_CLEARED' }
  ABYSS_ECHO_LOCKED: { echoId: AbyssEchoId; reason: 'STORY_NOT_COMPLETED' | 'NO_CHARGE' }
  INVALID_BATTLE_PHASE: { expected: BattlePhase[]; actual: BattlePhase }
  NOT_CURRENT_ACTOR: { actorUnitId: string; currentUnitId: string | null }
  SKILL_LOCKED: { skillId: SkillId }
  SKILL_ON_COOLDOWN: { skillId: SkillId; remainingTurns: number }
  INSUFFICIENT_ENERGY: { required: number; owned: number }
  INVALID_TARGET: { reason: 'COUNT' | 'DEAD' | 'FULL_HP' | 'WRONG_FACTION' | 'UNKNOWN' | 'TAUNTED'; targetUnitId: string | null }
  FORMATION_BLOCKED: { targetUnitId: string }
  RETREAT_FORBIDDEN: null
  INVENTORY_FULL: { kind: 'equipment' | 'skillStone' | 'overflow'; requiredSlots: number; availableSlots: number }
  OVERFLOW_NOT_EMPTY: { count: number }
  ITEM_NOT_OWNED: { instanceId: InstanceId | null; itemId: ItemId | null }
  ITEM_USE_FORBIDDEN: { itemId: ItemId; reason: 'NOT_IN_EXPEDITION' | 'BATTLE_ACTIVE' | 'WRONG_CONTEXT' | 'ECHO_LIMIT' }
  ITEM_LOCKED: { instanceId: InstanceId }
  ITEM_EQUIPPED: { instanceId: InstanceId }
  WEAPON_NOT_ALLOWED: { characterId: CharacterId; weaponType: WeaponType }
  SKILL_LOCKED_BY_LEVEL: { skillId: SkillId; unlockLevel: number; characterLevel: number }
  SKILL_LEVEL_MAX: { skillId: SkillId }
  INSUFFICIENT_SKILL_POINTS: { required: number; owned: number }
  AFFIX_POOL_EMPTY: { poolKind: 'equipmentNormal' | 'equipmentAbyss' | 'skillStoneNormal' | 'skillStoneAbyss'; itemLevel: number }
  AFFIX_CONFLICT: { exclusiveGroup: string; sourceIds: string[] }
  AFFIX_NOT_REFORGEABLE: { instanceId: InstanceId; reason: 'ABYSS_SLOT' | 'WRONG_LOCKED_INDEX' | 'LOCKED_ITEM' | 'EQUIPPED_ITEM' }
  REFORGE_PREVIEW_STALE: { expectedReforgeCount: number; actualReforgeCount: number }
  SHOP_OFFER_UNAVAILABLE: { offerId: string }
  BUYBACK_UNAVAILABLE: { sequence: number }
  STACKABLE_CAP_EXCEEDED: { itemId: ItemId; cap: 9999; owned: number; requested: number }
  REWARD_ALREADY_CLAIMED: { transactionId: string }
  SAVE_FAILED: { operation: 'create' | 'load' | 'save' | 'replace' }
  ASSET_LOAD_FAILED: { bundleId: AssetBundleId; attempts: 3 }
}

export type DomainErrorV1 = {
  [Code in DomainErrorCode]: { code: Code; details: DomainErrorDetailsByCode[Code] }
}[DomainErrorCode]
```

UI 只根据错误码查 `localization-spec.md` 的本地化模板，并只插入 details 中明确允许的字段；不得展示异常 message、issueKey、path、内部 ID 或自行猜测缺失参数。`INVALID_CONTENT` 的 path/issueKey 只写开发日志，玩家统一看到内容错误文案。
