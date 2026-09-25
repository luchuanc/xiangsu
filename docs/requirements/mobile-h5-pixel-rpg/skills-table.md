# 技能、状态与 Boss 冻结表

## 文档状态

- 版本：SKILL-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：本文每一行均对应唯一 `SkillDefinition` 或 AI 配置；实现不得改名、补默认值或临场改数
- 公共契约：字段和 EffectSpec 结构以 `data-contracts.md` 为准

## 1. 表格记法

为压缩 5 级重复字段，本文使用以下严格记法：

- `P[a/b/c/d/e]`：技能 1～5 级的 `powerBps`。
- `CD[a/b/c/d/e]`：1～5 级冷却；`maxLevel = 1` 的技能五格必须全部填同一值。
- `CH[a/b/c/d/e]`：1～5 级状态基础命中率。
- `V[a/b/c/d/e]`：任意另有标注的整数值按技能等级逐格展开，例如持续回合、能量或驱散数量；表内直接写 `[a/b/c/d/e]` 等同 `V[...]`，不表示运行时数组字段之外的动态公式。
- `D(element,P,hits,crit)`：DamageEffect；未写忽防时两个忽防字段为 0，未写条件时 `conditionalMultipliers = []`，`retargetEachHit=false`。
- `H(stat,P,crit)`：HealEffect，`flatPower = 0`。
- `Q(stat,P)`：ShieldEffect，固定写入 `status_shield`，`flatPower = 0`，`durationOwnerTurns=2`。
- `S(status,CH,stacks,duration)`：ApplyStatusEffect。
- 为节省列宽，`S`/`C` 内的 `bleed`、`burn` 等裸状态标记在构建表中严格展开为 `status_bleed`、`status_burn`；运行时配置只保存完整 ID，不做别名解析。
- `C(status,stacks)`：ConsumeStatusEffect；消耗 `min(现有层数, stacks)`，0 层时无副作用。
- `DISPEL(polarity,count)`、`ENERGY(amount)`、`CD_CHANGE(skillId,turns)`、`SUMMON(enemyId,slots,max)`、`REVIVE(bps)` 与契约同名。
- 表中“目标 HP≤N 时乘 M”唯一展开为该 DamageEffect 的 `{condition:{kind:'targetHpAtMostBps',valueBps:N},multiplierBps:M}`；“目标 status≥N 时乘 M”唯一展开为 `targetStatusStacksAtLeast`。这些条件只修正紧邻的 DamageEffect，不把后续 EffectSpec 变成条件效果。
- 一格出现 `A + B` 时，按从左到右写入 `effectsByLevel[n]` 并按该顺序解析。
- `target` 同时是 SkillDefinition.targetRule；单个 effect 未单独写目标时沿用技能 target。写 `self:`、`allAllies:` 等前缀表示该 effect 自己的 targetRule。
- `target/front` 中“是”或 `/front` 唯一展开为 `requiresFrontAccess=true`；“否”或未写 `/front` 唯一展开为 false。系统 effect 技能一律 false。
- 所有角色基础技能、终极、被动均 `maxLevel = 1`；它们的五个冷却/能量/效果数组逐项复制第 1 格，绝不留空。四个主动均 `maxLevel = 5`。
- 首版恰好六条角色被动的 `effectsByLevel=[[],[],[],[],[]]`，并在各自表格行显式写出；其余 91 条技能每一级效果数组均非空。系统 effect 技能没有空效果占位。
- 玩家基础技能能量获取固定 25，主动固定 10，终极 energyCost 固定 100 且 baseEnergyGain 为 0；被动两者为 0。敌方模板两者均为 0。
- 所有角色主动升级消耗 1 技能点/级；初始技能等级 0，解锁后第一次投入升到 1 级，最高 5。免费重置后全部主动回到 0，已装备但归零的技能自动卸下。

## 2. 角色与技能引用

| characterId | basicSkillId | activeSkillIds（固定顺序） | ultimateSkillId | passiveSkillId |
| --- | --- | --- | --- | --- |
| `char_wanderer` | `skill_wanderer_strike` | `skill_wanderer_rending_slash`, `skill_wanderer_guarding_blow`, `skill_wanderer_execution`, `skill_wanderer_blood_rally` | `skill_wanderer_endless_edge` | `skill_wanderer_instinct` |
| `char_iron_guard` | `skill_guard_hammer` | `skill_guard_shield_bash`, `skill_guard_fortify`, `skill_guard_banner`, `skill_guard_challenge` | `skill_guard_iron_citadel` | `skill_guard_unyielding` |
| `char_ranger` | `skill_ranger_arrow` | `skill_ranger_twin_shot`, `skill_ranger_marking_arrow`, `skill_ranger_fleet_step`, `skill_ranger_predator_volley` | `skill_ranger_arrow_storm` | `skill_ranger_eagle_eye` |
| `char_ember_mage` | `skill_ember_bolt` | `skill_ember_fireball`, `skill_ember_flame_wave`, `skill_ember_detonate`, `skill_ember_ward` | `skill_ember_inferno` | `skill_ember_kindling` |
| `char_frost_seer` | `skill_frost_shard` | `skill_frost_chill_lance`, `skill_frost_ice_nova`, `skill_frost_crystal_aegis`, `skill_frost_winter_link` | `skill_frost_absolute_zero` | `skill_frost_clarity` |
| `char_priest` | `skill_priest_smite` | `skill_priest_mend`, `skill_priest_sanctuary`, `skill_priest_purifying_light`, `skill_priest_aegis` | `skill_priest_returning_light` | `skill_priest_benediction` |

## 3. 主角：流浪剑士

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_wanderer_strike` | basic | 1 | singleEnemy/是 | 0×5 | `basic`, `sword` | 无 | `D(physical,10000,1,true)` ×5 |
| `skill_wanderer_rending_slash` | active | 1 | singleEnemy/是 | `2/2/2/2/2` | `sword`, `bleed` | `bleed ×1` | `D physical P[11000/12000/13000/14000/15000] + S bleed CH[7000/7500/8000/8500/9000],1,3` |
| `skill_wanderer_guarding_blow` | active | 3 | singleEnemy/是 | `3/3/3/3/3` | `sword`, `guard` | `guard ×1`, `shield ×1` | `D physical P[9000/9500/10000/10500/11000] + self:Q(attack,P[6000/6500/7000/7500/8000])` |
| `skill_wanderer_execution` | active | 6 | singleEnemy/是 | `3/3/3/3/3` | `sword`, `execute` | `execute ×1` | `D physical P[13500/14500/15500/16500/17500]`；目标 HP≤3500 bps 时额外乘 `15000` |
| `skill_wanderer_blood_rally` | active | 10 | allEnemies/否 | `4/4/4/4/4` | `sword`, `bleed` | `bleed ×1`, `guard ×1` | `D physical P[7500/8000/8500/9000/9500] + self:S(attack_up,10000,1,2)` |
| `skill_wanderer_endless_edge` | ultimate | 1 | allEnemies/否 | 0×5 | `sword`, `bleed`, `ultimate` | `bleed ×1`, `execute ×1` | `D(physical,14000,1,true)`；目标 bleed≥3 时乘 `13000`，随后 `C(bleed,3)`；整组 ×5 |
| `skill_wanderer_instinct` | passive | 1 | self/否 | 0×5 | `passive` | `bleed ×1`, `guard ×1` | `passiveModifiers=[{kind:'percentStat',stat:'attack',valueBps:800}]`，effects 五个空数组 |

## 4. 铁卫

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_guard_hammer` | basic | 1 | singleEnemy/是 | 0×5 | `basic`, `hammer` | 无 | `D(physical,10000,1,true)` ×5 |
| `skill_guard_shield_bash` | active | 1 | singleEnemy/是 | `2/2/2/2/2` | `hammer`, `control` | `taunt ×1`, `counter ×1` | `D physical P[9500/10000/10500/11000/11500] + S taunt CH[7000/7500/8000/8500/9000],1,2` |
| `skill_guard_fortify` | active | 3 | self/否 | `3/3/3/3/3` | `shield`, `guard` | `shield ×2`, `guard ×1` | `Q(maxHp,P[1500/1700/1900/2100/2300]) + S(guard_30,10000,1,1)` |
| `skill_guard_banner` | active | 6 | allAllies/否 | `4/4/4/4/4` | `shield`, `support` | `shield ×1`, `support ×1` | `Q(attack,P[6000/7000/8000/9000/10000]) + S(defense_up,10000,1,2)` |
| `skill_guard_challenge` | active | 10 | allEnemies/否 | `4/4/4/4/4` | `taunt`, `guard` | `taunt ×2`, `counter ×1` | `S taunt CH[7000/7500/8000/8500/9000],1,2 + self:S(attack_up,10000,1,2)` |
| `skill_guard_iron_citadel` | ultimate | 1 | allAllies/否 | 0×5 | `shield`, `guard`, `ultimate` | `shield ×2`, `guard ×2` | `Q(maxHp,2500) + S(guard_30,10000,1,1)` ×5 |
| `skill_guard_unyielding` | passive | 1 | self/否 | 0×5 | `passive` | `shield ×1`, `taunt ×1` | `passiveModifiers=[{kind:'percentStat',stat:'maxHp',valueBps:1200}]`，effects 五个空数组 |

## 5. 游侠

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_ranger_arrow` | basic | 1 | singleEnemy/否 | 0×5 | `basic`, `bow` | 无 | `D(physical,10000,1,true)` ×5 |
| `skill_ranger_twin_shot` | active | 1 | singleEnemy/否 | `2/2/2/2/2` | `bow`, `multiHit` | `chase ×1`, `speed ×1` | `D physical P[6000/6500/7000/7500/8000],2,true` |
| `skill_ranger_marking_arrow` | active | 3 | singleEnemy/否 | `3/3/3/3/3` | `bow`, `mark` | `crit ×1`, `chase ×1` | `D physical P[11000/12000/13000/14000/15000] + S marked CH[7500/8000/8500/9000/9500],1,3` |
| `skill_ranger_fleet_step` | active | 6 | self/否 | `3/3/3/3/3` | `speed`, `support` | `speed ×2` | `S(haste,10000,1,[2/2/3/3/3]) + ENERGY([10/12/14/16/18])` |
| `skill_ranger_predator_volley` | active | 10 | randomEnemy/否 | `4/4/4/4/4` | `bow`, `multiHit` | `chase ×1`, `crit ×1` | `D physical P[5000/5500/6000/6500/7000],3,true`；唯一覆盖 `retargetEachHit=true`，每段按存活合法目标 slot 升序建候选并用 battle RNG 重新选择 |
| `skill_ranger_arrow_storm` | ultimate | 1 | allEnemies/否 | 0×5 | `bow`, `multiHit`, `ultimate` | `chase ×2`, `speed ×1` | `D(physical,5000,4,true)` ×5 |
| `skill_ranger_eagle_eye` | passive | 1 | self/否 | 0×5 | `passive` | `crit ×1`, `speed ×1` | `passiveModifiers=[{kind:'flatStat',stat:'critRateBps',value:800}]`，effects 五个空数组 |

## 6. 炎术师

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_ember_bolt` | basic | 1 | singleEnemy/否 | 0×5 | `basic`, `fire` | 无 | `D(fire,10000,1,true)` ×5 |
| `skill_ember_fireball` | active | 1 | singleEnemy/否 | `2/2/2/2/2` | `fire`, `projectile` | `burn ×1`, `fire ×1` | `D fire P[12000/13000/14000/15000/16000] + S burn CH[7500/8000/8500/9000/9500],1,3` |
| `skill_ember_flame_wave` | active | 3 | allEnemies/否 | `3/3/3/3/3` | `fire`, `area` | `burn ×1`, `fire ×1`, `area ×1` | `D fire P[7000/7500/8000/8500/9000] + S burn CH[5000/5500/6000/6500/7000],1,3` |
| `skill_ember_detonate` | active | 6 | singleEnemy/否 | `3/3/3/3/3` | `fire`, `detonate` | `detonate ×2`, `burn ×1` | `D fire P[10000/10500/11000/11500/12000]`；目标 burn≥3 时乘 `[14000/14500/15000/15500/16000]`，随后 `C(burn,5)` |
| `skill_ember_ward` | active | 10 | self/否 | `4/4/4/4/4` | `fire`, `shield` | `shield ×1`, `burn ×1` | `Q(attack,P[10000/11000/12000/13000/14000]) + S(attack_up,10000,1,2)` |
| `skill_ember_inferno` | ultimate | 1 | allEnemies/否 | 0×5 | `fire`, `area`, `ultimate` | `burn ×2`, `detonate ×1` | `D(fire,12000,1,true) + S(burn,10000,2,3)` ×5 |
| `skill_ember_kindling` | passive | 1 | self/否 | 0×5 | `passive` | `burn ×1`, `fire ×1` | `passiveModifiers=[{kind:'damageBonus',element:'fire',valueBps:1000}]`，effects 五个空数组 |

## 7. 冰霜先知

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_frost_shard` | basic | 1 | singleEnemy/否 | 0×5 | `basic`, `frost` | 无 | `D(frost,10000,1,true) + S(slow,4000,1,2)` ×5 |
| `skill_frost_chill_lance` | active | 1 | singleEnemy/否 | `2/2/2/2/2` | `frost`, `projectile` | `frost ×1`, `control ×1` | `D frost P[11500/12500/13500/14500/15500] + S slow CH[7500/8000/8500/9000/9500],1,2` |
| `skill_frost_ice_nova` | active | 3 | allEnemies/否 | `4/4/4/4/4` | `frost`, `area`, `control` | `frost ×1`, `control ×2` | `D frost P[7000/7500/8000/8500/9000] + S freeze CH[2500/3000/3500/4000/4500],1,1` |
| `skill_frost_crystal_aegis` | active | 6 | singleAlly/否 | `3/3/3/3/3` | `frost`, `shield` | `shield ×2`, `frost ×1` | `Q(maxHp,P[1200/1400/1600/1800/2000]) + S(defense_up,10000,1,2)` |
| `skill_frost_winter_link` | active | 10 | allEnemies/否 | `3/3/3/3/3` | `frost`, `control` | `frost ×1`, `chain ×1` | `D frost P[5500/6000/6500/7000/7500] + S slow CH[7000/7500/8000/8500/9000],1,2` |
| `skill_frost_absolute_zero` | ultimate | 1 | allEnemies/否 | 0×5 | `frost`, `control`, `ultimate` | `frost ×2`, `control ×2` | `D(frost,10000,1,true) + S(freeze,5000,1,1) + S(slow,10000,1,2)` ×5 |
| `skill_frost_clarity` | passive | 1 | self/否 | 0×5 | `passive` | `frost ×1`, `control ×1` | `passiveModifiers=[{kind:'flatStat',stat:'effectHitBps',value:1000}]`，effects 五个空数组 |

## 8. 祭司

| skillId | kind | unlock | target/front | CD | familyIds | tags | 1～5 级效果 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `skill_priest_smite` | basic | 1 | singleEnemy/否 | 0×5 | `basic`, `holy` | 无 | `D(holy,9500,1,true)` ×5 |
| `skill_priest_mend` | active | 1 | singleAlly/否 | `2/2/2/2/2` | `heal`, `holy` | `heal ×2` | `H attack P[14000/15500/17000/18500/20000],false` |
| `skill_priest_sanctuary` | active | 3 | allAllies/否 | `4/4/4/4/4` | `heal`, `area`, `holy` | `heal ×2`, `support ×1` | `H attack P[7000/8000/9000/10000/11000],false` |
| `skill_priest_purifying_light` | active | 6 | singleAlly/否 | `3/3/3/3/3` | `heal`, `cleanse`, `holy` | `heal ×1`, `cleanse ×2` | `H attack P[8000/9000/10000/11000/12000],false + DISPEL(debuff,[1/1/1/2/2])` |
| `skill_priest_aegis` | active | 10 | singleAlly/否 | `3/3/3/3/3` | `shield`, `holy` | `shield ×2`, `heal ×1` | `Q attack P[14000/15500/17000/18500/20000] + S(guard_30,10000,1,1)` |
| `skill_priest_returning_light` | ultimate | 1 | deadAlly/否 | 0×5 | `heal`, `revive`, `ultimate` | `heal ×2`, `holy ×2` | `REVIVE(4000)` ×5；没有倒地友方时按钮禁用且不扣能量 |
| `skill_priest_benediction` | passive | 1 | self/否 | 0×5 | `passive` | `heal ×1`, `holy ×1` | `passiveModifiers=[{kind:'healingBonus',valueBps:1200}]`，effects 五个空数组 |

## 9. 系统 effect 技能

这些技能不可装备、不可升级，`owner = systemEffect`、`kind = effect`、`maxLevel = 1`，五级数组复制第 1 格。

| skillId | target | effect | 用途 |
| --- | --- | --- | --- |
| `effect_ember_echo_burst` | allEnemies | `D(fire,4500,1,false)` | 火球追加爆裂 |
| `effect_guard_ripple` | allEnemies | `D(physical,4000,1,false)` | 获得护盾震波 |
| `effect_bleed_doublecut` | singleEnemy | `D(physical,4500,1,true)` | 流血追击 |
| `effect_holy_afterglow` | allAllies | `H(attack,4000,false)` | 治疗余辉 |
| `effect_shadow_echo` | singleEnemy | `D(dark,6000,1,true)` | 深渊暗影追击 |
| `effect_sweeping_basic` | allEnemies | `D(physical,7000,1,true)` | 装备机制将基础攻击替换为横扫 |

系统 effect 技能必须被一个 `addFollowUp`、`statusLink` 或 `replaceBasicSkill` 字段显式引用；final 内容中孤儿 effect skill 为 `INVALID_CONTENT`。Combo 与装备触发直接携带 EffectSpec，不伪造未引用 SkillDefinition；其表现由 `asset-spec.md` 的内联派生效果规则选择。

`skill_wanderer_endless_edge` 与 `skill_ember_detonate` 的状态倍率只属于 DamageEffect；紧随其后的 ConsumeStatusEffect 无条件执行，分别消耗 `min(当前 bleed,3)` 与 `min(当前 burn,5)`。玩家可以在不足 3 层时主动释放，但不会获得条件倍率且仍会消耗已有层数；详情与确认界面必须明确显示这一代价。

## 10. 敌方通用技能模板

全部 `owner = systemEffect`、`maxLevel = 1`。`skill_enemy_basic_*` 为 basic，其余为 active。CD 与效果五格复制。

| skillId | target/front | CD | effects |
| --- | --- | ---: | --- |
| `skill_enemy_basic_physical` | singleEnemy/是 | 0 | `D(physical,10000,1,true)` |
| `skill_enemy_basic_ranged` | singleEnemy/否 | 0 | `D(physical,9500,1,true)` |
| `skill_enemy_defend` | self/否 | 3 | `S(guard_30,10000,1,1)` |
| `skill_enemy_double_hit` | singleEnemy/是 | 2 | `D(physical,6000,2,true)` |
| `skill_enemy_bleed_hit` | singleEnemy/是 | 2 | `D(physical,9000,1,true)+S(bleed,7000,1,3)` |
| `skill_enemy_slow_hit` | singleEnemy/否 | 2 | `D(physical,8500,1,true)+S(slow,7500,1,2)` |
| `skill_enemy_charge` | singleEnemy/是 | 3 | `D(physical,15000,1,true)+S(stun,4000,1,1)` |
| `skill_enemy_poison_hit` | singleEnemy/否 | 2 | `D(poison,8500,1,true)+S(poison,8000,1,3)` |
| `skill_enemy_poison_double` | singleEnemy/否 | 3 | `D(poison,5000,2,true)+S(poison,5000,1,3)`；状态判定只执行一次 |
| `skill_enemy_guard_all` | allAllies/否 | 4 | `Q(maxHp,800)+S(defense_up,10000,1,2)` |
| `skill_enemy_haste` | self/否 | 3 | `S(haste,10000,1,2)` |
| `skill_enemy_stun_hit` | singleEnemy/是 | 3 | `D(physical,11000,1,true)+S(stun,5500,1,1)` |
| `skill_enemy_all_physical` | allEnemies/否 | 3 | `D(physical,6500,1,true)` |
| `skill_enemy_self_heal` | self/否 | 3 | `H(attack,10000,false)` |
| `skill_enemy_fear_all` | allEnemies/否 | 4 | `S(fear,7000,1,2)` |
| `skill_enemy_burn_hit` | singleEnemy/是 | 2 | `D(fire,9500,1,true)+S(burn,8000,1,3)` |
| `skill_enemy_burn_all` | allEnemies/否 | 3 | `D(fire,6000,1,true)+S(burn,6000,1,3)` |
| `skill_enemy_execute` | singleEnemy/是 | 3 | `D(dark,13000,1,true)`；目标 HP≤3000 bps 时乘 `13846`，得到总倍率约 18000 |
| `skill_enemy_fear_hit` | singleEnemy/否 | 2 | `D(dark,9000,1,true)+S(fear,8000,1,2)` |
| `skill_enemy_bleed_double` | singleEnemy/是 | 3 | `D(physical,5500,2,true)+S(bleed,8000,1,3)` |
| `skill_enemy_ally_heal` | singleAlly/否 | 3 | `H(attack,9000,false)`；AI 选最低生命友方 |
| `skill_enemy_frost_guard` | allAllies/否 | 4 | `Q(maxHp,1000)+S(defense_up,10000,1,2)` |
| `skill_enemy_freeze_hit` | singleEnemy/否 | 3 | `D(frost,9000,1,true)+S(freeze,3500,1,1)` |
| `skill_enemy_shock_double` | randomEnemy/否 | 3 | `D(lightning,5500,2,true)+S(shock,6500,1,2)` |
| `skill_enemy_slow_all` | allEnemies/否 | 4 | `S(slow,7500,1,2)` |
| `skill_enemy_counter_guard` | self/否 | 3 | `Q(maxHp,1200)+S(guard_30,10000,1,1)` |
| `skill_boss_enrage` | self/否 | 0 | `S(status_boss_enrage,10000,1,999)` |

普通/精英敌人到技能模板、条件、优先级、targetStrategy 和 weight 的映射以 `balance-tables.md` 2.3/4 为真源：特殊模板按表中规则执行，基础模板为回退；禁止为单个普通敌人新增隐藏 AI。`skill_boss_enrage` 只允许十个 Boss 引用，不进入普通/精英技能池。

## 11. Boss 阶段状态

| statusId | effect | duration | 说明 |
| --- | --- | ---: | --- |
| `status_boss_phase_2` | attack +1500 bps | 999 owner turns | 通用二阶段标记；不可驱散 |
| `status_boss_phase_3` | speed +2000 bps | 999 owner turns | 仅十层三阶段标记；不可驱散 |
| `status_boss_enrage` | attack +5000 bps | 999 owner turns | 层主超时狂暴；不可驱散 |

Boss AI 阶段技一旦成功施放即添加对应状态；`selfMissingStatus` 保证只施放一次。阶段状态 immunityTag 固定 `bossPhase`。

## 12. 十个 Boss 技能与 AI

表内全部技能 `owner = {kind:'enemy', enemyId: 对应 Boss}`、`maxLevel=1`。fallback 槽使用 `skill_enemy_basic_physical` 或表中指定共享模板；即使模板 SkillDefinition.kind=active，通过 basicSkillId 执行时仍按 DATA-1.2 的 basic 命令语义且不启动模板 CD。AI 每回合按 priority 降序选择满足 conditions 且不在冷却的规则；同 priority 才按 weight。

Boss 表的 AI 行固定按以下构建规则展开，最终 `EnemyDefinition.aiRules` 仍保存完整字段：

- 每个“conditions / priority”条目生成一条 rule，`weight=100`。
- `self`、`allAllies`、`allEnemies` 技能的 `targetStrategy='self'`；`singleEnemy/front` 为 `frontFirstOpponent`；`singleEnemy` 为 `lowestHpOpponent`；`randomEnemy` 为 `randomValid`；`singleAlly` 为 `lowestHpAlly`。
- 唯一覆盖：`skill_boss_butcher_cleaver` 的两条 rule 都用 `lowestHpOpponent`，但仍由 `requiresFrontAccess=true` 过滤合法目标。
- `HP≤N` 展开为 `selfHpAtMostBps=N`；`round≥N` 为 `roundAtLeast=N`；`missing phase2/phase3` 为对应 `selfMissingStatus`；`has phase2/phase3` 为对应 `selfHasStatus`；`anyOpponentHpAtMostBps=N` 保持同名条件；`always` 为单个 always 条件。
- 同一条中用 `+` 连接的 conditions 为 AND；基础攻击不写 aiRules，只作为所有规则无候选时的回退。

每个 Boss 的 `skillIds` 在本节专属技能之后追加 `skill_boss_enrage`，并在 aiRules 原数组最前追加一条共享规则：`conditions=[roundAtLeast:bossEnrageRound,selfMissingStatus:status_boss_enrage]`、`priority=120`、`weight=100`、`targetStrategy=self`。`bossEnrageRound` 只读取对应 FloorDefinition，冻结值如下；不得复制成第二套 Boss 私有数值。

| floor | bossEnrageRound |
| ---: | ---: |
| 1 | 12 |
| 2 | 11 |
| 3 | 12 |
| 4 | 14 |
| 5 | 11 |
| 6 | 12 |
| 7 | 13 |
| 8 | 14 |
| 9 | 11 |
| 10 | 14 |

Boss 的 owner、基础技能和 `EnemyDefinition.skillIds` 原数组不得从标题、楼层或名称推断，精确映射如下；最后一个 `skill_boss_enrage` 也必须真实进入 skillIds：

| enemyId | basicSkillId | basicTargetStrategy | skillIds（原数组顺序） |
| --- | --- | --- | --- |
| `boss_horned_king` | `skill_enemy_basic_physical` | frontFirstOpponent | [`skill_boss_horned_charge`,`skill_boss_horned_call`,`skill_boss_enrage`] |
| `boss_brood_spider` | `skill_enemy_poison_hit` | lowestHpOpponent | [`skill_boss_brood_venom_web`,`skill_boss_brood_hatch`,`skill_boss_enrage`] |
| `boss_iron_devourer` | `skill_enemy_stun_hit` | frontFirstOpponent | [`skill_boss_iron_quake`,`skill_boss_iron_overdrive`,`skill_boss_enrage`] |
| `boss_bog_witch` | `skill_enemy_fear_hit` | lowestHpOpponent | [`skill_boss_witch_miasma`,`skill_boss_witch_rebirth`,`skill_boss_enrage`] |
| `boss_ember_guardian` | `skill_enemy_burn_hit` | frontFirstOpponent | [`skill_boss_ember_sweep`,`skill_boss_ember_eruption`,`skill_boss_enrage`] |
| `boss_abyss_butcher` | `skill_enemy_basic_physical` | frontFirstOpponent | [`skill_boss_butcher_cleaver`,`skill_boss_butcher_frenzy`,`skill_boss_enrage`] |
| `boss_crimson_knight` | `skill_enemy_bleed_double` | frontFirstOpponent | [`skill_boss_crimson_flurry`,`skill_boss_crimson_bloodmoon`,`skill_boss_enrage`] |
| `boss_pale_jailer` | `skill_enemy_freeze_hit` | lowestHpOpponent | [`skill_boss_jailer_prison`,`skill_boss_jailer_whitewall`,`skill_boss_enrage`] |
| `boss_thousand_eye` | `skill_enemy_shock_double` | randomValid | [`skill_boss_eye_chain`,`skill_boss_eye_rewrite`,`skill_boss_enrage`] |
| `boss_abyss_king` | `skill_enemy_basic_physical` | frontFirstOpponent | [`skill_boss_king_dark_wave`,`skill_boss_king_phase_two`,`skill_boss_king_phase_three`,`skill_boss_king_annihilation`,`skill_boss_enrage`] |

每条专属技能的 `owner={kind:'enemy',enemyId:<本表行>}`；`skill_boss_enrage.owner={kind:'systemEffect'}`，允许被全部 Boss 共同引用。内容校验断言：每个 Boss 的专属 skillId 只出现在一行，owner enemyId 与该行一致，basic 不重复写入 skillIds/aiRules，basicTargetStrategy 与 targetRule 兼容，skillIds 末项恰好为 enrage。

### 12.1 角牙兽王

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_horned_charge` | 3 | singleEnemy/front | `D(physical,14500,1,true)+S(stun,4500,1,1)` | `always` / 70 |
| `skill_boss_horned_call` | 0 | self | `S(phase_2,10000,1,999)+SUMMON(enemy_fang_wolf,[4,5],2)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_basic_physical`；phase2 后 charge power 通过状态攻击加成自然提高，不另改公式。

### 12.2 毒巢蛛后

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_brood_venom_web` | 3 | allEnemies | `D(poison,5500,1,true)+S(poison,7500,1,3)+S(slow,6500,1,2)` | round≥2 / 75 |
| `skill_boss_brood_hatch` | 0 | self | `S(phase_2,...)+SUMMON(enemy_venom_spider,[3,4,5],3)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_poison_hit`。

### 12.3 钢铁吞噬者

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_iron_quake` | 3 | allEnemies | `D(physical,7000,1,true)+S(stun,3000,1,1)` | always / 75 |
| `skill_boss_iron_overdrive` | 0 | self | `S(phase_2,...)+Q(maxHp,1800)+S(guard_30,10000,1,1)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_stun_hit`。

### 12.4 沼泽女巫

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_witch_miasma` | 3 | allEnemies | `D(poison,6000,1,true)+S(poison,7000,1,3)+S(fear,5000,1,2)` | round≥2 / 75 |
| `skill_boss_witch_rebirth` | 0 | self | `S(phase_2,...)+H(maxHp,1800,false)+SUMMON(enemy_bog_leech,[4,5],2)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_fear_hit`。

### 12.5 余烬守卫

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_ember_sweep` | 3 | allEnemies | `D(fire,7500,1,true)+S(burn,7500,1,3)` | always / 75 |
| `skill_boss_ember_eruption` | 0 | allEnemies | `self:S(phase_2,...)+D(fire,10000,1,true)+S(burn,10000,2,3)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_burn_hit`。

### 12.6 深渊屠夫

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_butcher_cleaver` | 3 | singleEnemy/front | `D(dark,15000,1,true)`；目标 HP≤3000 时乘 14000 | `anyOpponentHpAtMostBps=3000` / 90；否则 `always` / 65 |
| `skill_boss_butcher_frenzy` | 0 | self | `S(phase_2,...)+S(haste,10000,1,999)+S(fear,10000,1,2)` 的 fear target 为 allEnemies | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_basic_physical`。

### 12.7 猩红骑士

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_crimson_flurry` | 3 | singleEnemy/front | `D(physical,5000,3,true)+S(bleed,8000,1,3)` | always / 75 |
| `skill_boss_crimson_bloodmoon` | 0 | self | `S(phase_2,...)+H(maxHp,1500,false)+S(attack_up,10000,1,999)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_bleed_double`。

### 12.8 苍白狱卒

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_jailer_prison` | 3 | allEnemies | `D(frost,6500,1,true)+S(freeze,4000,1,1)` | round≥2 / 75 |
| `skill_boss_jailer_whitewall` | 0 | self | `S(phase_2,...)+Q(maxHp,2200)+S(defense_up,10000,1,999)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_freeze_hit`。

### 12.9 千眼观测者

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_eye_chain` | 2 | randomEnemy | `D(lightning,5000,3,true)+S(shock,7500,1,2)` | always / 75 |
| `skill_boss_eye_rewrite` | 0 | allEnemies | `self:S(phase_2,...)+S(slow,10000,1,3)+D(lightning,7000,1,true)` | HP≤5000 + missing phase2 / 100 |

基础攻击 `skill_enemy_shock_double`。

### 12.10 深渊之王

| skillId | CD | target | effects | AI conditions / priority |
| --- | ---: | --- | --- | --- |
| `skill_boss_king_dark_wave` | 3 | allEnemies | `D(dark,8000,1,true)+S(fear,6500,1,2)` | always / 70 |
| `skill_boss_king_phase_two` | 0 | self | `S(phase_2,...)+SUMMON(enemy_throne_knight,[4,5],1)+Q(maxHp,1500)` | HP≤7000 + missing phase2 / 100 |
| `skill_boss_king_phase_three` | 0 | allEnemies | `self:S(phase_3,...)+D(dark,10000,1,true)+S(burn,8000,1,3)+S(shock,8000,1,2)` | HP≤3500 + has phase2 + missing phase3 / 110 |
| `skill_boss_king_annihilation` | 4 | allEnemies | `D(dark,12000,1,true)` | has phase3 / 90 |

基础攻击 `skill_enemy_basic_physical`。

### 12.11 十条 Boss 高威胁意图

每个 Boss 恰好一条 `BossIntentDefinition`。`delayLegalActions=1` 表示 AI 选中该技能时本次行动只声明，下一次非控制跳过的合法行动才释放；targetStrategy 必须与该技能胜出 AI rule 相同。`counterKind` 只提供结构化提示，不改变领域数值或自动替玩家行动。

| intentId | bossId | skillId | targetStrategy | delayLegalActions | counterKind | HUD 反制含义 |
| --- | --- | --- | --- | ---: | --- | --- |
| `intent_horned_charge` | `boss_horned_king` | `skill_boss_horned_charge` | `frontFirstOpponent` | 1 | `guard` | 前排防御或补盾 |
| `intent_brood_venom_web` | `boss_brood_spider` | `skill_boss_brood_venom_web` | `self` | 1 | `cleanse` | 预留净化与群体回复 |
| `intent_iron_quake` | `boss_iron_devourer` | `skill_boss_iron_quake` | `self` | 1 | `shield` | 提前建立群体护盾 |
| `intent_witch_miasma` | `boss_bog_witch` | `skill_boss_witch_miasma` | `self` | 1 | `cleanse` | 预留净化，避免恐惧连锁 |
| `intent_ember_eruption` | `boss_ember_guardian` | `skill_boss_ember_eruption` | `self` | 1 | `shield` | 半血线前补盾与回复 |
| `intent_butcher_cleaver` | `boss_abyss_butcher` | `skill_boss_butcher_cleaver` | `lowestHpOpponent` | 1 | `heal` | 把最低血角色抬离处决线 |
| `intent_crimson_flurry` | `boss_crimson_knight` | `skill_boss_crimson_flurry` | `frontFirstOpponent` | 1 | `guard` | 前排防御，降低多段与流血风险 |
| `intent_jailer_prison` | `boss_pale_jailer` | `skill_boss_jailer_prison` | `self` | 1 | `cleanse` | 预留净化并接受控制延后 |
| `intent_eye_chain` | `boss_thousand_eye` | `skill_boss_eye_chain` | `randomValid` | 1 | `shield` | 使用群体护盾应对随机多段 |
| `intent_king_annihilation` | `boss_abyss_king` | `skill_boss_king_annihilation` | `self` | 1 | `guard` | 终相后全队防御/护盾 |

内容校验必须证明 bossId 与 skill owner 匹配、skillId 在该 Boss skillIds 内、该 skill 至少存在一条兼容 targetStrategy 的 AI rule、delayLegalActions 恰好为 1，且 10 个 Boss/intentId/skillId 都无重复。`self` 用于 allEnemies 技能，表示 AI 不提前选择具体目标，真实目标仍由 TargetResolver 展开。

## 13. Boss 效果中的省略值

为避免表格重复，Boss 表中的 `S(phase_2,...)` 一律展开为 `S(status_boss_phase_2,10000,1,999)`；`phase_3` 同理。带 `self:` 的效果目标为 Boss 自身，其余沿用技能目标。此处是唯一允许的表格缩写，生成脚本必须在构建期展开并由快照测试确认。

## 14. 验证快照

- 精确内容数量：角色技能 42、系统 effect 技能 6、敌方通用技能 27（含层主通用狂暴）、Boss 专属技能 22；共 97 个 SkillDefinition。
- BossIntentDefinition 精确 10 条；不计入 97 个 SkillDefinition。
- 每个角色恰好 1 basic、4 active、1 ultimate、1 passive。
- 每个 5 级主动恰好 5 个完整效果数组；所有 maxLevel=1 数组五格逐项相等。
- 每个 statusId、enemyId、familyId 和技能词条引用的 effect skillId 必须存在。
- 所有伤害 conditionalMultipliers 的条件和倍率逐项进入 golden snapshot；不得在解析器按技能 ID 分支。

## 15. 97 个技能 zh-CN 名称冻结表

`SkillDefinition.nameKey=skill.<skillId>.name`，其 zh-CN 值逐行固定如下。详情数值由结构化 `SkillDefinition` 格式化，`descriptionKey` 只承载不改变规则的说明文字，禁止在本地化文件另写一套数值。

| # | skillId | zh-CN 名称 |
| ---: | --- | --- |
| 1 | `skill_wanderer_strike` | 流浪者斩击 |
| 2 | `skill_wanderer_rending_slash` | 裂伤斩 |
| 3 | `skill_wanderer_guarding_blow` | 守势击 |
| 4 | `skill_wanderer_execution` | 处决 |
| 5 | `skill_wanderer_blood_rally` | 血战集结 |
| 6 | `skill_wanderer_endless_edge` | 无尽刃舞 |
| 7 | `skill_wanderer_instinct` | 漂泊本能 |
| 8 | `skill_guard_hammer` | 铁锤击 |
| 9 | `skill_guard_shield_bash` | 盾击 |
| 10 | `skill_guard_fortify` | 固守 |
| 11 | `skill_guard_banner` | 铁卫战旗 |
| 12 | `skill_guard_challenge` | 挑战怒吼 |
| 13 | `skill_guard_iron_citadel` | 钢铁城塞 |
| 14 | `skill_guard_unyielding` | 不屈 |
| 15 | `skill_ranger_arrow` | 穿云箭 |
| 16 | `skill_ranger_twin_shot` | 双矢连射 |
| 17 | `skill_ranger_marking_arrow` | 标记箭 |
| 18 | `skill_ranger_fleet_step` | 疾行步 |
| 19 | `skill_ranger_predator_volley` | 猎手齐射 |
| 20 | `skill_ranger_arrow_storm` | 箭雨 |
| 21 | `skill_ranger_eagle_eye` | 鹰眼 |
| 22 | `skill_ember_bolt` | 火焰弹 |
| 23 | `skill_ember_fireball` | 火球术 |
| 24 | `skill_ember_flame_wave` | 烈焰波 |
| 25 | `skill_ember_detonate` | 爆燃 |
| 26 | `skill_ember_ward` | 余烬护盾 |
| 27 | `skill_ember_inferno` | 炼狱 |
| 28 | `skill_ember_kindling` | 引火 |
| 29 | `skill_frost_shard` | 冰晶 |
| 30 | `skill_frost_chill_lance` | 寒意长枪 |
| 31 | `skill_frost_ice_nova` | 冰霜新星 |
| 32 | `skill_frost_crystal_aegis` | 水晶庇护 |
| 33 | `skill_frost_winter_link` | 凛冬联结 |
| 34 | `skill_frost_absolute_zero` | 绝对零度 |
| 35 | `skill_frost_clarity` | 澄明 |
| 36 | `skill_priest_smite` | 圣击 |
| 37 | `skill_priest_mend` | 愈合 |
| 38 | `skill_priest_sanctuary` | 圣域 |
| 39 | `skill_priest_purifying_light` | 净化之光 |
| 40 | `skill_priest_aegis` | 圣盾 |
| 41 | `skill_priest_returning_light` | 返生之光 |
| 42 | `skill_priest_benediction` | 赐福 |
| 43 | `effect_ember_echo_burst` | 余烬回声爆裂 |
| 44 | `effect_guard_ripple` | 守势震波 |
| 45 | `effect_bleed_doublecut` | 裂伤双斩 |
| 46 | `effect_holy_afterglow` | 圣光余辉 |
| 47 | `effect_shadow_echo` | 影随追击 |
| 48 | `effect_sweeping_basic` | 横扫普攻 |
| 49 | `skill_enemy_basic_physical` | 近战攻击 |
| 50 | `skill_enemy_basic_ranged` | 远程攻击 |
| 51 | `skill_enemy_defend` | 防御 |
| 52 | `skill_enemy_double_hit` | 二连击 |
| 53 | `skill_enemy_bleed_hit` | 裂伤击 |
| 54 | `skill_enemy_slow_hit` | 迟缓击 |
| 55 | `skill_enemy_charge` | 冲锋 |
| 56 | `skill_enemy_poison_hit` | 毒击 |
| 57 | `skill_enemy_poison_double` | 毒牙连击 |
| 58 | `skill_enemy_guard_all` | 群体守护 |
| 59 | `skill_enemy_haste` | 加速 |
| 60 | `skill_enemy_stun_hit` | 震荡击 |
| 61 | `skill_enemy_all_physical` | 横扫 |
| 62 | `skill_enemy_self_heal` | 自愈 |
| 63 | `skill_enemy_fear_all` | 恐惧扩散 |
| 64 | `skill_enemy_burn_hit` | 灼烧击 |
| 65 | `skill_enemy_burn_all` | 烈焰席卷 |
| 66 | `skill_enemy_execute` | 处决击 |
| 67 | `skill_enemy_fear_hit` | 恐惧凝视 |
| 68 | `skill_enemy_bleed_double` | 嗜血连击 |
| 69 | `skill_enemy_ally_heal` | 援护治疗 |
| 70 | `skill_enemy_frost_guard` | 寒霜守护 |
| 71 | `skill_enemy_freeze_hit` | 冻结击 |
| 72 | `skill_enemy_shock_double` | 雷震连击 |
| 73 | `skill_enemy_slow_all` | 群体迟缓 |
| 74 | `skill_enemy_counter_guard` | 反击守势 |
| 75 | `skill_boss_horned_charge` | 角牙冲锋 |
| 76 | `skill_boss_horned_call` | 兽王呼唤 |
| 77 | `skill_boss_brood_venom_web` | 毒网 |
| 78 | `skill_boss_brood_hatch` | 孵化 |
| 79 | `skill_boss_iron_quake` | 钢铁震地 |
| 80 | `skill_boss_iron_overdrive` | 过载 |
| 81 | `skill_boss_witch_miasma` | 瘴气 |
| 82 | `skill_boss_witch_rebirth` | 泥沼重生 |
| 83 | `skill_boss_ember_sweep` | 余烬横扫 |
| 84 | `skill_boss_ember_eruption` | 熔火喷发 |
| 85 | `skill_boss_butcher_cleaver` | 屠夫劈斩 |
| 86 | `skill_boss_butcher_frenzy` | 血肉狂乱 |
| 87 | `skill_boss_crimson_flurry` | 猩红连斩 |
| 88 | `skill_boss_crimson_bloodmoon` | 血月 |
| 89 | `skill_boss_jailer_prison` | 寒狱囚牢 |
| 90 | `skill_boss_jailer_whitewall` | 苍白壁垒 |
| 91 | `skill_boss_eye_chain` | 千眼雷链 |
| 92 | `skill_boss_eye_rewrite` | 命运改写 |
| 93 | `skill_boss_king_dark_wave` | 暗潮 |
| 94 | `skill_boss_king_phase_two` | 王座二相 |
| 95 | `skill_boss_king_phase_three` | 王座终相 |
| 96 | `skill_boss_king_annihilation` | 终焉湮灭 |
| 97 | `skill_boss_enrage` | 层主狂暴 |
