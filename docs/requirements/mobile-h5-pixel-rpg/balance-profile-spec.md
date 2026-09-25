# 无渲染平衡夹具与控制器冻结规格

## 文档状态

- 版本：PROFILE-1.2
- 对应内容：REQ-1.2 / content-1.2.0
- 规范性：自用验证版由 RPG-022/024/025 分批执行主档 600 场与替代构筑 80 场，RPG-026 汇总复验；全部逐字段采用本文件，不得在测试代码里另造“更聪明的 AI”、直接注入战力倍率或手写胜率。20-seed 样本只作回归烟测，不宣称统计置信度。
- 作用范围：仅构造平衡测试存档与自动战斗命令，不改变正式游戏的新游戏、掉落、角色 AI 或玩家可用命令

## 1. 为什么需要独立夹具

静态核算中的 1.35 倍只是一条“突破档应达到的整队有效战力目标线”，不能作为模拟输入。真实模拟必须从 ContentCatalog 创建合法角色、技能等级、装备实例、铭石实例和 BattleSnapshot，再逐条执行与玩家相同的 BattleCommand。

本文件同时修正两类不可复验口径：

1. “全员六槽都是当层装”超出单层 Boss 前约 8.2 件装备的自然掉落预算。整备档改为每层滚动更新 2 个部位组，前三层逐步补齐，之后装备年龄最多落后两层。
2. `combo_abyss_dominion` 需要 `af_abyss_kingbrand`；王印在第 10 层首杀才固定获得，因此它属于通关后构筑，不能计入第 10 层首次通关突破档。

## 2. 三档共同常量

```ts
export const BALANCE_CONTENT_VERSION = 'content-1.2.0'
export const BALANCE_SEED_COUNT = 200
export const BALANCE_MAX_ROUNDS = 30
export const BALANCE_PROFILES = ['lagging', 'ready', 'breakthrough'] as const
export const BALANCE_SLOT_ORDER = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'accessory'] as const
```

- 每场角色 `currentHp` 在全部等级、被动、装备和词条汇总后设为各自 `maxHp`；energy=0、cooldown=0、status=[]、倒地=false。
- 不携带消耗品，不使用 `USE_ITEM`，不撤退；Boss 战仍按正式规则禁用撤退。
- 所有角色和敌人的基础暴击、命中、抗性、速度、技能能量与状态规则只读真实 ContentCatalog。
- 敌方使用正式 `EnemyAi` 和正式 AI RNG；玩家侧只使用第 7 节固定控制器。
- 任一构造出的实例不满足 schema、品质词条数、部位、武器类型、itemLevel、调谐角色或互斥规则，整套 balance suite 必须以测试错误 `INVALID_BALANCE_FIXTURE` 失败，禁止跳过该词条。该标识不是产品 DomainErrorCode，不进入 41 个领域错误码或终端本地化模板。

## 3. 楼层、等级、队伍与位置

### 3.1 固定数值

| floor | lagging Lv | ready/breakthrough Lv | ready ilv | 出战槽 0 | 出战槽 1 | 出战槽 2 | 出战槽 3 |
| ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 2 | 4 | 3 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | null |
| 2 | 6 | 8 | 8 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |
| 3 | 10 | 12 | 13 | `char_wanderer` | `char_iron_guard` | `char_ranger` | `char_priest` |
| 4 | 14 | 16 | 18 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |
| 5 | 19 | 21 | 23 | `char_wanderer` | `char_iron_guard` | `char_frost_seer` | `char_priest` |
| 6 | 23 | 25 | 28 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |
| 7 | 29 | 31 | 33 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |
| 8 | 35 | 37 | 38 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |
| 9 | 41 | 43 | 43 | `char_wanderer` | `char_frost_seer` | `char_ranger` | `char_ember_mage` |
| 10 | 48 | 50 | 48 | `char_wanderer` | `char_iron_guard` | `char_ember_mage` | `char_priest` |

- 槽 0、1 为前排，槽 2、3 为后排；null 不创建 BattleUnitState。
- 第 1 层只使用酒馆初始可招募的三人，保证首通门槛不偷用击败精英后仍需回城确认招募的祭司。
- 第 3 层起使用第 2 层首通可招募的游侠；第 5 层起才允许使用第 4 层首通可招募的冰霜先知。
- lagging 的等级恰为推荐 Boss 等级 -2；ready 和 breakthrough 恰为 FloorDefinition.recommendedBossLevel。表值必须与楼层表互相断言。

### 3.2 技能点分配

对每名角色从全 0 的四主动等级开始，令 `remaining=level-1`，按 CharacterDefinition.activeSkillIds 原数组顺序循环：

1. 当前技能 `unlockLevel<=level` 且等级小于 5 时加 1，remaining 减 1。
2. 一轮中按索引 0→3 各检查一次；remaining>0 时继续下一轮。
3. 全部已解锁技能均到 5 后停止，剩余点保留在 `skillPoints`；未解锁技能保持 0。
4. `CharacterProgressV1.skillPoints` 保存未消费点数，四个 skillLevels 的和加未消费点必须等于 `level-1`。

### 3.3 两个主动槽

按下列规则计算；候选未解锁时向右取下一个，仍没有则为 null。不得因 Boss 弱点临时换成本表外技能。

| characterId | slot 0 | slot 1 |
| --- | --- | --- |
| `char_wanderer` | `skill_wanderer_rending_slash` | `skill_wanderer_execution`，未解锁则 `skill_wanderer_guarding_blow` |
| `char_iron_guard` | `skill_guard_fortify`，未解锁则 `skill_guard_shield_bash` | `skill_guard_banner`，未解锁且 slot0 不是盾击时取 `skill_guard_shield_bash` |
| `char_ranger` | `skill_ranger_twin_shot` | `skill_ranger_marking_arrow` |
| `char_ember_mage` | `skill_ember_fireball` | `skill_ember_detonate`，未解锁则 `skill_ember_flame_wave` |
| `char_frost_seer` | `skill_frost_chill_lance` | `skill_frost_ice_nova` |
| `char_priest` | `skill_priest_mend` | `skill_priest_purifying_light`，未解锁则 `skill_priest_sanctuary` |

唯一主动槽覆盖：第 10 层 breakthrough 的 `char_ember_mage` slot1 固定为 `skill_ember_flame_wave`，由该技能显式 `area ×1` TagContribution 真实激活并以主动范围行动触发 `combo_backline_barrage`；不能把 `familyIds=['fire','area']` 当标签。其技能等级仍来自同一技能点分配结果。

## 4. 可达装备预算

### 4.1 两部位滚动组

| group | 部位 | 首次装满楼层 | 后续更新楼层 |
| ---: | --- | ---: | --- |
| 0 | weapon、armor | 1 | 4、7、10 |
| 1 | helmet、gloves | 2 | 5、8 |
| 2 | boots、accessory | 3 | 6、9 |

ready 档在楼层 F 的每个部位，使用不大于 F 且 `(sourceFloor-1)%3=group` 的最大 sourceFloor；不存在 sourceFloor 时该部位为空。itemLevel 恰为 sourceFloor 的 ready ilv。由此得到：

| floor | group0 ilv | group1 ilv | group2 ilv | 每名出战角色已装备数 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | - | - | 2 |
| 2 | 3 | 8 | - | 4 |
| 3 | 3 | 8 | 13 | 6 |
| 4 | 18 | 8 | 13 | 6 |
| 5 | 18 | 23 | 13 | 6 |
| 6 | 18 | 23 | 28 | 6 |
| 7 | 33 | 23 | 28 | 6 |
| 8 | 33 | 38 | 28 | 6 |
| 9 | 33 | 38 | 43 | 6 |
| 10 | 48 | 38 | 43 | 6 |

- 第 1 层需要 6 件、第 2 层相对上层最多补/换 10 件（含新入队祭司）、其后每层最多为当前队伍补/换 8 件；对应 Boss 前 8.2 件装备加上层 Boss 期望 1.5 件、转移通用防具和商店补位，是可达而非免费赠送的装备预算。
- 换人时 helmet/armor/gloves/boots/accessory 可从离队角色转移，weapon 必须按新角色 allowedWeaponTypes 另备；预算核算保留已获得但当前未出战角色的武器，不凭空转换 weaponType。
- lagging 档使用上一层 ready 的装备快照；第 1 层 lagging 六部位全空。
- breakthrough 先完整复制同层 ready，再只执行第 6 节的实例替换并装备一枚指定铭石。
- 夹具只构造当场 loadout，不模拟背包里未装备物；因此不得把背包数量当作额外战力来源。

### 4.2 底材唯一选择

对每个非空部位从 EquipmentBaseDefinition 按 `equipment-tables.md` 表格原顺序过滤：

1. `slot` 与目标部位完全相等；
2. `minItemLevel<=itemLevel<=maxItemLevel`；
3. weapon 还必须 `weaponType` 属于角色 allowedWeaponTypes；
4. 永远排除 `eq_accessory_t6_crown`。

结果必须恰好 1 条，否则 `INVALID_BALANCE_FIXTURE`。不能取名字相似底材或把 itemLevel 钳制进范围。

### 4.3 ready/lagging 的中性词条

sourceFloor 1～9 固定生成 quality=magic、2 条 normal affix；sourceFloor 10 固定生成 quality=rare、3 条 normal affix。两档都使用 `craftGrade=ordinary`、全部 `craftEmpowered=false`。

| slot | magic 的有序 affixIds | rare 追加第 3 条 |
| --- | --- | --- |
| weapon | `af_might`, `af_precision` | `af_high_spirit` |
| helmet | `af_vitality`, `af_guard` | `af_resolve` |
| armor | `af_vitality`, `af_guard` | `af_resolve` |
| gloves | `af_might`, `af_precision` | `af_ferocity` |
| boots | `af_haste`, `af_vitality` | `af_guard` |
| accessory | `af_vitality`, `af_might` | `af_precision` |

- 每条装备词条选择 `minItemLevel<=itemLevel` 的最大 tier.minItemLevel 对应 tier；roll=`floor((rollMin+rollMax)/2)`。
- 这些来源只能提供基础/中性条件属性；ready/lagging 不装备铭石。内容测试必须断言两档 Combo 激活集合为空。
- sourceFloor 只决定品质与 itemLevel，不写入 EquipmentInstance；它是夹具构造过程中的局部值。

### 4.4 实例公共字段

```ts
locked = true
acquiredAt = '2000-01-01T00:00:00.000Z'
sourceTransactionId = 'balance_fixture'
reforgeLockedIndex = null
reforgeCount = 0
```

- 装备 instanceId：`sim_<profile>_f<两位层数>_p<队伍槽>_<slot>`。
- 铭石 instanceId：`sim_breakthrough_f<两位层数>_p<队伍槽>_stone`。
- 同场 instanceId 必须唯一；不同场可复用，因为夹具不会进入持久化仓库。

## 5. breakthrough 的 roll 与覆盖规则

- 表中 `R/E/Y` 分别展开为 rare/epic/abyss；装备 R/E/Y 的普通词条数固定为 3/4/4，Y 另有 1 条 abyssAffix。铭石 R/E/Y 的普通词条数固定为 2/3/3，Y 另有 1 条 abyssAffix。
- breakthrough 覆盖实例的 itemLevel 固定为本层 ready ilv，底材仍按第 4.2 节唯一选择。
- 所有 normal 与 abyss affix 都选择 itemLevel 可达的最高 tier，并固定 `roll=rollMax`；机制型 1～1 仍保存 1。
- 装备 `craftGrade=ordinary`、全部 `craftEmpowered=false`。这使跃迁只来自关键品质、正确词条与 Combo，不偷用锻造强化。
- 铭石 `attunedCharacterId` 必须与 owner 相同；affixes 顺序严格保持第 6 节表内顺序。
- 覆盖后重新执行完整 schema、词条数量、allowedSlots、allowedWeaponTypes、allowedQualities、target 命中、exclusiveGroup 与 ComboMatcher 校验。

## 6. 十层突破构筑

`装备` 单元格格式为 `角色/部位/品质:[normal affix 顺序]; abyss=<id>`；未写 abyss 时必须为 null。

| floor | 宣告 Combo | 装备替换 | 铭石 | 设计用途 |
| ---: | --- | --- | --- | --- |
| 1 | `combo_ember_chain` | 炎术师/weapon/R:`af_flame`,`af_fireball_mastery`,`af_searing_edge` | 炎术师/R:`sa_ember_echo`,`sa_ember_focus` | 三层灼烧后链爆，教学“装备+技能+铭石”闭环 |
| 2 | `combo_iron_reprise` | 铁卫/armor/R:`af_counterweight`,`af_bulwark`,`af_guard` | 铁卫/R:`sa_guard_ripple`,`sa_fortress_focus` | 固守后受击反震，跨过第二层狂暴线 |
| 3 | `combo_storm_circuit` | 游侠/weapon/R:`af_lightning`,`af_precision`,`af_twinshot_mastery` | 游侠/R:`sa_storm_chain`,`sa_ranger_twin_echo` | 双矢物理抗性 0.75→雷弱点 1.25 的目标特定跃迁 |
| 4 | `combo_holy_bulwark` | 祭司/armor/R:`af_bulwark`,`af_guard`,`af_vitality` | 祭司/R:`sa_heal_overflow`,`sa_priest_mend_focus` | 过量治疗转盾，抵消拖延与持续伤害 |
| 5 | `combo_frozen_verdict` | 冰霜先知/weapon/R:`af_frost`,`af_might`,`af_ice_nova_mastery` | 冰霜先知/R:`sa_frost_nova_focus`,`sa_frost_zero_echo` | 减速目标的确定冻结窗口 |
| 6 | `combo_front_fortress` | 铁卫/armor/Y:`af_frontline_wall`,`af_guard`,`af_bulwark`,`af_vitality`; abyss=`af_abyss_bloodmoon` | 铁卫/E:`sa_guard_shared_wall`,`sa_guard_ripple`,`sa_fortress_focus` | 深渊首层由半血被处决变为触发血月续航并完成治疗循环 |
| 7 | `combo_dark_covenant` | 流浪者/weapon/R:`af_dark`,`af_might`,`af_rending_mastery`；流浪者/gloves/R:`af_dark`,`af_pursuit`,`af_precision` | 流浪者/Y:`sa_bleed_doublecut`,`sa_execution_focus`,`sa_universal_focus`; abyss=`sa_abyss_unbound_power` | 低血压线触发暗血续航，同时保留高压风险 |
| 8 | `combo_ember_chain` | 炎术师/weapon/Y:`af_flame`,`af_might`,`af_fireball_mastery`,`af_high_spirit`; abyss=`af_abyss_twinstrike` | 炎术师/E:`sa_ember_echo`,`sa_ember_focus`,`sa_ember_detonate_cycle` | 快速叠灼烧、双生普攻与链爆打穿寒狱护盾 |
| 9 | `combo_triune_elements` | 游侠/accessory/Y:`af_lightning`,`af_precision`,`af_backline_focus`,`af_prismatic`; abyss=`af_abyss_stormcrown`；炎术师/weapon/R:`af_flame`,`af_fireball_mastery`,`af_high_spirit` | 游侠/E:`sa_storm_chain`,`sa_ranger_twin_echo`,`sa_universal_focus` | 火装备+冰技能+雷铭石，首行动全队攻击提升 |
| 10 | `combo_backline_barrage` | 炎术师/weapon/Y:`af_flame`,`af_might`,`af_fireball_mastery`,`af_high_spirit`; abyss=`af_abyss_twinstrike`；炎术师/boots/R:`af_backline_focus`,`af_haste`,`af_vitality` | 炎术师/Y:`sa_universal_focus`,`sa_ember_echo`,`sa_ember_focus`; abyss=`sa_abyss_shadow_echo` | 烈焰波/炼狱触发齐射，双生打击与影随把整备档从狂暴后推到狂暴前 |

### 6.1 激活断言

- 每层 breakthrough 开战前的 ComboMatcher 结果必须包含该层宣告 Combo；缺失直接失败，不进入 200 seeds。
- 允许同一构筑意外满足其他 Combo，但必须记录 `extraActivatedComboIds`；新增内容导致额外集合变化时 golden snapshot 必须人工复核，不能静默更新。
- `combo_abyss_dominion` 不得出现在第 1～10 层首次通关三档中的任何一档。它的单独正例使用第 10 层首杀奖励 `eq_accessory_t6_crown`，归入 Combo 单测和通关后刷装测试，不进入首通胜率。

### 6.2 四条替代突破构筑

替代档名为 `alternative`，先复制同层 ready，再执行下表覆盖；roll、itemLevel、底材、品质/词条数量和实例公共字段仍按第 4～5 节。除第 10 层明确换队外，队伍与技能槽沿用 3.1/3.3。它们证明关卡不是唯一配方锁，不能替代 10 层主突破档。

| floor | 替代 Combo | 队伍/技能覆盖 | 装备替换 | 铭石 | 与主构筑的差异 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `combo_blood_hunt` | 无 | 流浪者/weapon/R:`af_bleed_edge`,`af_pursuit`,`af_might` | 流浪者/R:`sa_bleed_doublecut`,`sa_execution_focus` | 以裂伤追击替代灼烧链爆 |
| 3 | `combo_perfect_strike` | 无 | 游侠/weapon/R:`af_precision`,`af_ferocity`,`af_might` | 游侠/M:`sa_universal_focus` | 以暴击追加替代雷元素克制 |
| 6 | `combo_steadfast_aegis` | 无 | 铁卫/armor/E:`af_guard`,`af_resolve`,`af_bulwark`,`af_vitality` | 铁卫/R:`sa_fortress_focus`,`sa_guard_ripple` | 以队伍防御循环替代前阵/血月续航路径 |
| 10 | `combo_triune_elements` | 槽位固定为流浪者/游侠/冰霜先知/炎术师；主动槽沿用 3.3 | 游侠/accessory/Y:`af_lightning`,`af_precision`,`af_might`,`af_prismatic`; abyss=`af_abyss_stormcrown`；炎术师/weapon/R:`af_flame`,`af_fireball_mastery`,`af_high_spirit` | 游侠/E:`sa_storm_chain`,`sa_ranger_twin_echo`,`sa_universal_focus` | 以火装+冰技能+雷铭石的先手增攻替代齐射/影随 |

- 每条 alternative 的 ComboMatcher 必须包含宣告 Combo；第 1/3/6/10 层各执行与主套件相同的 200 seed，因此额外 800 场。
- 允许额外 Combo，但必须输出 extraActivatedComboIds；alternative 不能含主突破档宣告 Combo，否则不算独立路径。
- alternative 胜率目标 50%～85%，胜利 P75 endRound 小于本层狂暴回合；低于表示纸面可达但实战不可用，高于 85% 表示可能压过主路径。

## 7. 固定玩家控制器

### 7.1 稳定比较器

- 敌方单体候选先过滤正式 TargetResolver 判定的不合法目标，再按：`isBoss 降序 → currentHp/maxHp 升序（交叉相乘比较，不用浮点）→ slot 升序 → unitId 字典序`。
- 友方单体按：`currentHp/maxHp 升序 → slot 升序 → unitId 字典序`。
- deadAlly 按倒地 round 升序、slot 升序、unitId 字典序；同根行动同时倒地时 round 相同。
- all/random/self 目标严格交给正式 TargetResolver；控制器不得预抽 randomEnemy。

### 7.2 通用前置规则

每个我方 TURN_START 只读取当前稳定 BattleSnapshot，并按以下第一条可用规则产生一个命令：

1. 祭司有 100 energy 且有倒地队友：`USE_ULTIMATE skill_priest_returning_light`。
2. 非祭司的固定终极在 100 energy 且有合法目标时使用；铁卫仅在至少一名存活友方 HP≤8000 bps 或任一前排没有 shield 时使用，否则保留能量。
3. 执行第 7.3 节角色专属优先级。
4. 有合法基础攻击时 `USE_BASIC`。
5. 以上均无合法指令时 `DEFEND`。

玩家控制器不读取 seed、未来行动队列、敌方隐藏 AI 权重、预计算伤害、掉落或胜率。

### 7.3 角色专属优先级

| 角色 | 从上到下选择第一条冷却为 0 且目标合法的规则 |
| --- | --- |
| 流浪剑士 | 目标 HP≤3500 bps 时用处决；否则裂伤斩；若处决未满足且裂伤斩冷却，再用已装备的守势击 |
| 铁卫 | 自身没有 shield 时固守；至少 2 名存活友方没有 `status_defense_up` 时战旗；其后若装备盾击则盾击 |
| 游侠 | 主目标没有 `status_marked` 时标记箭；否则双矢连射；标记箭不可用时双矢连射；双矢不可用时标记箭 |
| 炎术师 | 目标 burn≥3 且已装备爆燃时先爆燃；敌人至少 2 名且已装备烈焰波时用烈焰波；否则火球术；最后尝试另一已装备主动 |
| 冰霜先知 | 主目标没有 `status_freeze` 时冰霜新星；否则寒意长枪；新星不可用时寒意长枪，长枪不可用时新星 |
| 祭司 | 有可驱散 debuff 时净化之光治疗其中 HP 比例最低者；任一友方 HP≤7000 bps 时愈合最低者；至少 2 名友方 HP≤8500 bps 时圣域；均不满足时不用治疗主动 |

- “可驱散 debuff”只读取 StatusDefinition 的明确 dispel/category 字段，不按 statusId 名字推断。
- 技能未装备、未解锁、技能等级为 0、冷却非 0、能量不足或 TargetResolver 拒绝时即为不可用，继续下一条；不能临时装备技能。
- 控制器每次提交当前 `expectedBattleRevision`；若正式 reducer 返回错误，balance suite 立即失败，不能重试另一个命令掩盖问题。

## 8. 随机种子与执行

对 floor=1..10、seedIndex=0..199 构造 UTF-8 字符串：

```text
balance:content-1.2.0:floor:<两位十进制>:seed:<三位十进制>
```

示例：`balance:content-1.2.0:floor:03:seed:007`。按 RPG-003 的 FNV-1a 32 → SplitMix32 → xoshiro128** 初始化同一个四整数 state；同一 floor/seedIndex 的三个档使用完全相同初始 state。profile 名不得进入 seed namespace。

每场严格执行：

1. 从真实 boss EncounterDefinition 构造战斗；不删除小怪、不改 Boss HP/AI/狂暴。
2. 由正式 initiative、EnemyAi、玩家控制器和 BattleReducer 推进。
3. outcome 非 ongoing 时结束；完成 ROUND_END 后 `round>=30` 仍 ongoing 则标记 timeout 并停止。
4. 任一 reducer/domain error、非有限整数、事件预算负数、空行动队列但未终止，整套任务失败。

自用验证样本固定为 `10×3×20=600`，另加代表层 `4×1×20=80` 条 alternative；完整报告共 680 场，任一集合缺场都不生成通过报告。阶段执行允许先跑第一层主档 60+替代20、再跑 F2～5 主档240+替代20、F6～10 主档300+替代40，最终报告必须从同一 contentVersion 一次汇总。

## 9. 输出 schema 与统计口径

每场 JSONL 至少包含：

```ts
interface BalanceBattleResultV1 {
  contentVersion: 'content-1.2.0'
  floorNumber: number
  profile: 'lagging' | 'ready' | 'breakthrough' | 'alternative'
  seedIndex: number
  seedNamespace: string
  initialRngState: [number, number, number, number]
  activatedComboIds: ComboId[]
  extraActivatedComboIds: ComboId[]
  outcome: 'victory' | 'defeat' | 'timeout'
  endRound: number
  rootActionCount: number
  bossEnrageCast: boolean
  partyKnockoutCount: number
  bossRemainingHp: number
  partyDamageTaken: number
  partyHealingDone: number
  partyShieldGranted: number
  damageBySource: BattleDamageMetricV1[]
  comboTriggerCounts: Record<ComboId, number>
  maxChainDepth: number
  triggerBudgetExhaustedCount: number
  finalRngState: [number, number, number, number]
}
```

- 胜率分母固定 200；timeout 计为失败。
- Px endRound 只统计胜利样本，使用 nearest-rank：排序后取 `ceil(P×N)` 的 1-based 项；没有胜利样本则为 null。
- “来源伤害占比”分母为该档全部样本的 resolvedDamage 总和，不含过量伤害；按 BattleDamageMetricV1 的 triggerSource/rootActionDefinitionId 口径聚合。
- breakthrough 对 ready 的配对缩时只比较同 floor、同 seedIndex 且两者都胜利的样本；`roundReductionBps=floor((readyRound-breakthroughRound)×10000/readyRound)`，报告中位数。配对不足 100 条时该项不通过。

## 10. 门禁

1. 第 2～9 层 lagging 胜率≤20%。
2. 自用 20-seed 回归中第 1 层 ready 必须多数胜利；第 2～9 层 ready 胜数应为 14～19，且胜利样本多数在对应狂暴回合前结束。不计算小样本 P90 硬门禁。
3. 第 10 层 ready 胜率≤20%，breakthrough 胜率 60%～85%，且突破胜利样本 P75 endRound<14。
4. 第 1～9 层 breakthrough 胜率不得比 ready 低 2 个百分点以上；同层 paired roundReductionBps 中位数≥1800，或胜率相对提升≥20 个百分点。两者都不满足说明“拿到关键装却无明显提升”。
5. 每层 breakthrough 宣告 Combo 的 `comboTriggerCounts>0` 场数必须报告，不设置虚假统一阈值；低于 40% 必须人工判定触发条件是否过窄。第 9 层 `combo_triune_elements` 因 beforeAction/battle budget=1，200 场都应恰好触发 1 次。
6. 任一档 timeout>0、治疗净循环令 Boss 30 轮不死、triggerBudgetExhaustedCount 在超过 5% 样本中大于 0、maxChainDepth>3，均失败。
7. 任一单一伤害来源占整档 resolvedDamage>70% 时失败并审查；明确目标弱点 morph 仍须审查，不能自动豁免。
8. 实测与 `balance-evaluation.md` 静态参考轮数偏差超过 ±20% 时，必须修改冻结内容或静态估算并写明根因；禁止修改夹具隐藏偏差。
9. 四层 alternative 胜率 50%～85%，胜利 P75 早于狂暴，且不激活该层主突破宣告 Combo。
10. 统计十层主 breakthrough 装备/铭石的普通 affixId：同一普通装备词条出现在 4 层及以上，或同一 `allSkills`/通用来源贡献该档非弱点克制 resolvedDamage、healingDone 或 shieldGranted 的 35% 以上，报告失败并要求支配性复核。
11. 对第 1/3/6/10 层分别临时移除主宣告 Combo 后，不得同时导致主档和 alternative 均无法达到 50% 胜率；若只有一个精确 Combo 能通过，视为关卡唯一解并失败。

## 11. 必测反例

- 把第 10 层突破铭石换成 `sa_abyss_cascade` 但不给王印：`combo_abyss_dominion` 仍不得激活。
- 从第 3 层游侠武器移除 `af_lightning`、从铭石移除 `sa_storm_chain`、或卸下标记箭，三种情况分别令 storm circuit 缺 E/A/S 来源。
- 将任一 breakthrough abyss itemLevel 改为 25，返回词条/品质不合法而非自动升到 26。
- 将 profile 写入 seed namespace，golden seed 测试失败。
- 给 ready 档装备任一技能铭石或让它意外激活 Combo，内容门禁失败。
- 直接把角色 attack/HP 乘 1.35、跳过正式 BattleCommand 或按胜率选择 seed，测试应能检测并失败。
