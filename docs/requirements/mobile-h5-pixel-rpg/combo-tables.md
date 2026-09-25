# Combo 配方与数值冻结表

## 文档状态

- 版本：COMBO-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：首版 18 个 Combo 的配方来源、触发、效果和预算均冻结
- 关联契约：`ComboDefinition`、`TriggerSpec`、`EffectSpec` 以 `data-contracts.md` 为准

## 1. 记法与默认展开

- 来源：`I=innate`、`E=equipmentAffix`、`S=equippedSkill`、`A=skillAffix`、`*=any`。
- 配方 `E:burn×1` 严格展开为 `{source:'equipmentAffix', tagId:'burn', count:1}`。
- `S` 只读取两个非空主动槽、固定终极技和固定被动技的 `SkillDefinition.tags`；固定普攻、`familyIds` 和未装入主动槽的技能都不贡献标签。
- 效果记法与 `skills-table.md` 相同；裸状态名在构建期展开为完整 `status_*` ID，运行时不做别名兼容。
- TriggerSpec 未列字段固定为：`requiredSkillKinds=[]`、`requiredHitResult='any'`、两个 HP 门槛 `null`、两个 status 数组 `[]`、`consumeTargetStatus=null`。
- Combo 不使用随机触发概率；满足 TriggerSpec 和预算即 100% 入队。
- `singleEnemy` 指原事件敌方目标；目标已死亡则本次效果跳过，不自动改选。`self` 指个人 Combo 所属角色；party Combo 的 self 不允许出现。
- TriggerSpec 中 source 始终指 Combo 所属角色（party Combo 则是产生根事件的友方角色），target 指根事件主要对手/受益者；因此 onDirectDamageTaken 的 source 是受击 Combo 持有者，target 是攻击者。
- 预算格式为 `每根行动/每轮/每场`；key 仍按 ComboDefinition.id 与作用角色/队伍生成。

## 2. 18 个冻结 Combo

| comboId | 名称 | scope | 精确配方 | trigger | effects | 预算 |
| --- | --- | --- | --- | --- | --- | --- |
| `combo_ember_chain` | 余烬链爆 | personal | `E:burn×1`, `S:burn×1`, `A:detonate×1` | afterDirectHit；target burn≥3；consume burn 3 | `allEnemies:D(fire,6000,1,false)` | 1/1/999 |
| `combo_iron_reprise` | 铁壁回响 | personal | `E:counter×1`, `S:shield×2`, `A:counter×1` | onDirectDamageTaken；source has shield | `singleEnemy:D(physical,6000,1,true)` | 1/1/999 |
| `combo_blood_hunt` | 血猎追击 | personal | `E:bleed×1`, `S:bleed×1`, `A:chase×1` | afterDirectHit；target has bleed | `singleEnemy:D(physical,4000,1,true)` | 1/1/999 |
| `combo_holy_bulwark` | 圣愈壁垒 | party | `E:shield×1`, `S:heal×2`, `A:heal×1` | onOverheal | `allAllies:Q(attack,3000)` | 1/1/999 |
| `combo_venom_bloom` | 毒华绽放 | personal | `E:poison×2`, `S:control×1`, `A:focus×1` | afterRootAction；target has poison | `allEnemies:D(poison,4500,1,false)+S(poison,10000,1,3)` | 1/1/999 |
| `combo_frozen_verdict` | 冻结裁决 | personal | `E:frost×1`, `S:control×2`, `A:frost×1` | afterDirectHit；target has slow | `singleEnemy:S(freeze,10000,1,1)` | 1/1/999 |
| `combo_storm_circuit` | 雷链回路 | personal | `E:shock×1`, `S:crit×1`, `A:chain×1` | afterDirectHit；hitResult=critical | `allEnemies:D(lightning,4000,1,false)+S(shock,10000,1,2)` | 1/1/999 |
| `combo_execution_cadence` | 处决节拍 | personal | `E:execute×1`, `S:execute×1`, `A:execute×1` | onDefeatUnit | `self:grantExtraTurn` | 1/1/3 |
| `combo_steadfast_aegis` | 不屈圣盾 | party | `I:shield×1`, `E:guard×2`, `A:shield×1` | onGainShield | `allAllies:S(defense_up,10000,1,2)` | 1/1/3 |
| `combo_swift_formation` | 疾风阵列 | party | `I:speed×1`, `E:speed×2`, `A:speed×1` | beforeAction；skillKinds=[basic,active,ultimate] | `allAllies:S(haste,10000,1,2)` | 1/1/1 |
| `combo_perfect_strike` | 完美一击 | personal | `E:crit×2`, `S:crit×1`, `A:focus×1` | afterDirectHit；hitResult=critical | `singleEnemy:D(physical,5000,1,true)` | 1/1/999 |
| `combo_dark_covenant` | 暗血契约 | personal | `E:dark×2`, `I:bleed×1`, `A:dark×1` | afterDirectHit；source HP≤4000 bps | `self:H(attack,3000,false)` | 1/1/999 |
| `combo_cleansing_light` | 净世之光 | party | `S:cleanse×2`, `E:holy×1`, `A:heal×1` | onHeal | `allAllies:DISPEL(debuff,1)` | 1/1/3 |
| `combo_front_fortress` | 前阵要塞 | party | `E:front×1`, `E:guard×1`, `S:shield×1` | onDirectDamageTaken | `allAllies:Q(maxHp,500)` | 1/1/999 |
| `combo_backline_barrage` | 后阵齐射 | party | `E:back×1`, `S:area×1`, `A:focus×1` | afterRootAction；skillKinds=[active,ultimate] | `allEnemies:D(physical,3000,1,false)` | 1/1/999 |
| `combo_triune_elements` | 三相共鸣 | party | `E:fire×1`, `S:frost×1`, `A:shock×1` | beforeAction；skillKinds=[basic,active,ultimate] | `allAllies:S(attack_up,10000,1,2)` | 1/1/1 |
| `combo_ultimate_resonance` | 终极共振 | party | `A:ultimate×2`, `S:support×1`, `E:element×1` | afterRootAction；skillKinds=[ultimate] | `allAllies:ENERGY(10)` | 1/1/3 |
| `combo_abyss_dominion` | 深渊统御 | party | `E:dark×2`, `E:execute×2`, `A:chain×1` | onDefeatUnit | `allEnemies:D(dark,7000,1,false)` | 1/1/999 |

## 3. TriggerSpec 精确补充

- `combo_ember_chain.consumeTargetStatus={statusId:'status_burn',stacks:3}`；TriggerRuntime 只有目标至少 3 层时才满足，不使用“有一层也触发再消耗 min”的规则。
- `combo_iron_reprise.requiredSourceStatusIds=['status_shield']`。
- `combo_blood_hunt.requiredTargetStatusIds=['status_bleed']`。
- `combo_venom_bloom.requiredTargetStatusIds=['status_poison']`；若根行动有多个中毒目标，按原根行动第一个有效 targetUnitId 作为检查目标。
- `combo_frozen_verdict.requiredTargetStatusIds=['status_slow']`。
- `combo_dark_covenant.requiredSourceHpAtMostBps=4000`。
- `combo_swift_formation`、`combo_triune_elements`、`combo_backline_barrage` 与 `combo_ultimate_resonance` 写入表列 requiredSkillKinds；前两者因此不会被 DEFEND/USE_ITEM 提前消耗。
- 所有 `beforeAction` Combo 在整场第一次满足条件的合法 basic/active/ultimate 行动前检查；成功 effects 先在 `DRAIN_PRE_ACTION` 排空，再执行该单位根技能，因此三相共鸣会强化当前这一击。battle budget=1 保证每场最多成功一次；此前不满足配方/来源的行动不会消耗次数。

## 4. 配方可达性样例

每个 Combo 至少有一条内容校验通过的构筑路径；这里只列最短样例，不作为掉落推荐系统：

| comboId | 装备来源 | 技能来源 | 铭石来源 |
| --- | --- | --- | --- |
| ember_chain | `af_flame` | `skill_ember_fireball` | `sa_ember_echo` |
| iron_reprise | `af_counterweight` | `skill_guard_fortify` | `sa_guard_ripple` |
| blood_hunt | `af_bleed_edge` | `skill_wanderer_rending_slash` | `sa_bleed_doublecut` |
| holy_bulwark | 祭司任一合法装备的 `af_bulwark` | 祭司主动槽的 `skill_priest_mend` | 祭司铭石的 `sa_heal_overflow` |
| venom_bloom | 冰霜先知武器同件 `af_poison`+`af_venom_edge` | 冰霜先知主动槽的 `skill_frost_ice_nova` | 冰霜先知铭石的 `sa_universal_focus` |
| frozen_verdict | `af_frost` | `skill_frost_ice_nova` | `sa_frost_nova_focus` |
| storm_circuit | `af_lightning` | `skill_ranger_marking_arrow` | `sa_storm_chain` |
| execution_cadence | `af_executioner` | `skill_wanderer_execution` | `sa_execution_focus` |
| steadfast_aegis | 铁卫本源；队伍装备 `af_guard`+`af_frontline_wall` | -（配方不要求技能标签） | 铁卫铭石的 `sa_guard_ripple` |
| swift_formation | 游侠本源；队伍两件装备各有 `af_haste` | -（配方不要求技能标签） | 游侠铭石的 `sa_swift_charge` |
| perfect_strike | 游侠同件装备 `af_precision`+`af_ferocity` | 游侠固定被动 `skill_ranger_eagle_eye` | 游侠铭石的 `sa_universal_focus` |
| dark_covenant | 流浪者 weapon、gloves 各有一个 `af_dark`；流浪者本源 | -（配方不要求技能标签） | 流浪者铭石深渊词条 `sa_abyss_unbound_power` |
| cleansing_light | `af_holy` | `skill_priest_purifying_light` | `sa_priest_mend_focus` |
| front_fortress | 队伍装备一个 `af_frontline_wall` | 铁卫主动槽的 `skill_guard_fortify` | -（配方不要求技能词条） |
| backline_barrage | 队伍装备一个 `af_backline_focus` | 炎术师主动槽的 `skill_ember_flame_wave`（显式 `area ×1`） | 任一出战角色铭石的 `sa_universal_focus` |
| triune_elements | 队伍装备一个 `af_flame` | 冰霜先知主动槽的 `skill_frost_chill_lance` | 游侠铭石的 `sa_storm_chain` |
| ultimate_resonance | 队伍装备一个 `af_prismatic` | 铁卫主动槽的 `skill_guard_banner` | 两名出战角色的铭石深渊词条各为 `sa_abyss_endless_energy` |
| abyss_dominion | `eq_accessory_t6_crown` 的 `af_abyss_kingbrand`+一个普通 `af_dark` | -（配方不要求技能标签） | 任一出战角色铭石深渊词条 `sa_abyss_cascade` |

可达性测试读取真实 TagContribution，不能把本表样例文本当业务输入。

`combo_abyss_dominion` 的装备最短路径依赖第 10 层首杀固定王印，因此只属于通关后复战/刷装构筑，不得作为第 10 层首次通关条件；首次通关突破夹具固定使用 `combo_backline_barrage`，见 `balance-profile-spec.md`。

## 5. 预算与循环门禁

1. 所有 Combo 派生事件 `chainDepth = parent + 1`；大于 3 拒绝。
2. personal Combo 的同根 key 为 `${rootActionId}:${ownerUnitId}:${comboId}`，每个持有者最多入队一次；party Combo 为 `${rootActionId}:party:${comboId}`，整队最多一次。
3. 额外行动仍受“每单位每轮最多一次”限制；时隙词条和处决节拍同时满足时，第二个被抑制并记录来源。
4. 每单位每根行动最多 8 个派生伤害，整场每根最多 32；Combo 自身 budget 是更严格的上限。
5. 内容测试对 18 个 Combo 构造正例、缺少每一种来源的负例和至少三条循环攻击图，验证可达且必定终止。
