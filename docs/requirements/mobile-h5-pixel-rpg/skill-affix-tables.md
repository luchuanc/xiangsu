# 技能铭石与技能词条冻结表

## 文档状态

- 版本：STONE-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：24 条技能词条、生成池、数值范围和叠加规则全部冻结
- 关联契约：`data-contracts.md` 第 7 节；技能/族 ID 以 `skills-table.md` 为准

## 1. 生成固定规则

1. drop/shop roll 先按各自冻结顺序确定 itemLevel；进入铭石生成器后始终在当前 `recruited=true` 的角色 ID 升序列表中消费一次等权调谐抽值。若本次是远征内第一笔成功提交的精英铭石且 `focusedEliteStoneConsumed=false`，丢弃该抽值并使用存档中的 `skillStoneFocusCharacterId`，在同一奖励事务把该 flag 置 true；否则使用抽值结果。随后再按该 roll 的 qualityWeights 抽品质。
2. magic/rare/epic/abyss 的 normal affix 数量为 1/2/3/3；abyss 另抽 1 条 pool=abyss。
3. normal 池只保留：minItemLevel≤itemLevel、品质允许、target 可命中调谐角色至少一个技能的词条。
4. 按 weight 逐次加权无放回；每次排除重复 ID 和同 exclusiveGroup。候选不足返回 `AFFIX_POOL_EMPTY`，整件奖励不提交。
5. `roll` 在闭区间均匀抽整数。固定机制仍保存 `roll=1`，不能留空。
6. 铭石只允许给调谐角色装备。具体 skill/family 目标只有命中当前两主动槽、固定终极或固定被动时，其效果和 tags 才激活；`allSkills` 始终命中调谐角色，且实际效果还包括基础攻击。
7. 换技能造成某条词条暂时不命中时，词条和 roll 保留，只在详情中显示“未激活：目标技能未装备”。

## 2. 20 条普通技能词条

quality 缩写：`M/R/E/Y = magic/rare/epic/abyss`。`target` 严格展开为 SkillAffixTarget 判别联合。
本节 20 行全部固定 `pool=normal`；第 3 节 4 行全部固定 `pool=abyss`。

| skillAffixId | 名称 | kind | target | minLv | quality | stack/exclusive | weight | gold | roll | operation | tags |
| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | --- | --- | --- |
| `sa_ember_focus` | 聚焰 | amplify | skill:`skill_ember_fireball` | 1 | M/R/E/Y | add/- | 100 | 35 | 600～1400 | addPowerBps | `burn ×1`, `fire ×1` |
| `sa_ember_echo` | 余烬回声 | followUp | skill:`skill_ember_fireball` | 1 | R/E/Y | unique/`fireball_follow` | 50 | 55 | 4500～6500 | addFollowUp `effect_ember_echo_burst`, scale 10000 | `burn ×1`, `detonate ×2` |
| `sa_guard_ripple` | 守势震波 | followUp | family:`shield` | 1 | M/R/E/Y | unique/`shield_follow` | 65 | 45 | 3500～5500 | addFollowUp `effect_guard_ripple`, scale 10000 | `shield ×1`, `counter ×2` |
| `sa_bleed_doublecut` | 裂伤双斩 | repeat | skill:`skill_wanderer_rending_slash` | 1 | M/R/E/Y | max/`rending_repeat` | 75 | 42 | 2500～4500 | addRepeatChanceBps, extraHits 1 | `bleed ×2`, `chase ×1` |
| `sa_heal_overflow` | 盈疗成盾 | statusLink | family:`heal` | 1 | M/R/E/Y | max/`overheal_convert` | 70 | 45 | 3000～5000 | overhealToShield scale 10000, cap 2000, duration 2 | `heal ×2`, `shield ×2` |
| `sa_frost_spread` | 寒意扩散 | morph | skill:`skill_frost_chill_lance` | 21 | E/Y | replace/`chill_shape` | 25 | 80 | 1～1 | replaceTargetRule allEnemies | `frost ×2`, `control ×2`, `area ×1` |
| `sa_swift_charge` | 迅猎充能 | resource | family:`multiHit` | 1 | M/R/E/Y | add/- | 80 | 38 | 5～10 | changeEnergy scale 10000 | `speed ×2`, `chase ×1` |
| `sa_storm_chain` | 风暴改写 | morph | skill:`skill_ranger_twin_shot` | 11 | R/E/Y | replace/`twin_element` | 35 | 70 | 1～1 | replaceDamageElement lightning | `shock ×2`, `chain ×2` |
| `sa_execution_focus` | 终结专注 | amplify | skill:`skill_wanderer_execution` | 1 | M/R/E/Y | add/- | 90 | 38 | 800～1600 | addPowerBps | `execute ×2` |
| `sa_fortress_focus` | 堡垒增幅 | amplify | skill:`skill_guard_fortify` | 1 | M/R/E/Y | add/- | 90 | 38 | 800～1600 | addPowerBps | `shield ×2`, `guard ×1` |
| `sa_guard_shared_wall` | 众志之墙 | morph | skill:`skill_guard_fortify` | 21 | E/Y | replace/`fortify_shape` | 25 | 80 | 1～1 | replaceTargetRule allAllies | `shield ×2`, `support ×2` |
| `sa_ranger_twin_echo` | 双矢回响 | repeat | skill:`skill_ranger_twin_shot` | 1 | M/R/E/Y | max/`twin_repeat` | 75 | 42 | 2000～4000 | addRepeatChanceBps, extraHits 1 | `chase ×2`, `speed ×1` |
| `sa_ranger_marked_chase` | 印记追猎 | statusLink | skill:`skill_ranger_marking_arrow` | 1 | M/R/E/Y | unique/`mark_follow` | 65 | 48 | 4000～6000 | statusLink marked → `effect_bleed_doublecut`, scale 10000 | `mark ×2`, `chase ×2` |
| `sa_ember_detonate_cycle` | 爆燃循环 | resource | skill:`skill_ember_detonate` | 1 | M/R/E/Y | unique/`detonate_cooldown` | 55 | 50 | 1～1 | changeCooldown -1 | `burn ×1`, `detonate ×2` |
| `sa_ember_detonate_focus` | 爆燃增幅 | amplify | skill:`skill_ember_detonate` | 1 | M/R/E/Y | add/- | 85 | 42 | 800～1600 | addPowerBps | `burn ×2`, `detonate ×1` |
| `sa_frost_nova_focus` | 冰环增幅 | amplify | skill:`skill_frost_ice_nova` | 1 | M/R/E/Y | add/- | 85 | 42 | 700～1500 | addPowerBps | `frost ×2`, `control ×1` |
| `sa_frost_zero_echo` | 绝零回响 | repeat | skill:`skill_frost_absolute_zero` | 1 | M/R/E/Y | max/`zero_repeat` | 55 | 55 | 1500～3000 | addRepeatChanceBps, extraHits 1 | `frost ×2`, `control ×1` |
| `sa_priest_mend_focus` | 愈合增幅 | amplify | skill:`skill_priest_mend` | 1 | M/R/E/Y | add/- | 90 | 38 | 800～1600 | addPowerBps | `heal ×2` |
| `sa_priest_sanctuary_echo` | 圣域余辉 | followUp | skill:`skill_priest_sanctuary` | 1 | M/R/E/Y | unique/`sanctuary_follow` | 65 | 48 | 4000～6000 | addFollowUp `effect_holy_afterglow`, scale 10000 | `heal ×2`, `holy ×1` |
| `sa_universal_focus` | 万技专注 | amplify | allSkills | 1 | M/R/E/Y | add/- | 60 | 50 | 400～900 | addPowerBps | `focus ×1` |

## 3. 4 条深渊技能词条

全部 `pool=abyss`、quality 仅 Y、minItemLevel=26、不能重铸。深渊铭石第 4 条只从本表抽取。

| skillAffixId | 名称 | kind | target | stack/exclusive | weight | gold | roll | operation | tags |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| `sa_abyss_unbound_power` | 深渊·无拘威能 | amplify | allSkills | add/- | 35 | 180 | 1200～2200 | addPowerBps | `might ×1`, `dark ×1` |
| `sa_abyss_endless_energy` | 深渊·无尽源流 | resource | allSkills | add/- | 30 | 200 | 8～15 | changeEnergy scale 10000 | `speed ×1`, `ultimate ×1` |
| `sa_abyss_shadow_echo` | 深渊·影随 | followUp | allSkills | unique/`allskill_follow` | 22 | 240 | 2500～4500 | addFollowUp `effect_shadow_echo`, scale 10000 | `dark ×2`, `chase ×2` |
| `sa_abyss_cascade` | 深渊·万技连潮 | repeat | allSkills | max/`allskill_repeat` | 18 | 280 | 1500～3000 | addRepeatChanceBps, extraHits 1 | `chain ×2`, `chase ×1` |

## 4. 叠加与冲突矩阵

| kind | 允许多个来源 | 汇总 | 冲突展示 |
| --- | --- | --- | --- |
| amplify | 是 | add：所有 effectiveRoll 相加 | 列出各来源和合计 |
| repeat | 是 | max：只取最高追加概率；`extraHits` 必须相同，否则内容校验失败 | 其余标“未采用：取最高值” |
| followUp | 否（同 exclusiveGroup） | unique | 装备确认前阻止 |
| morph | 否（同 exclusiveGroup） | replace | 装备确认前要求卸下冲突来源 |
| statusLink/overheal | 同组只一个 | max 或 unique，按定义 | 展示转化率、上限和抑制来源 |
| resource-energy | 是 | add 后钳制单次总增量最多 30 | 展示钳制前后值 |
| resource-cooldown | 同技能同组只一个 | unique；冷却最少 0 | 冲突阻止 |

跨装备与铭石的相同 exclusiveGroup 也参与冲突校验；不是只在一枚铭石内部检查。

技能解析与结算顺序固定为：

1. 只收集当前调谐角色、目标命中本次根技能且已激活的铭石词条，按铭石 affixes 原顺序后接 abyssAffix。
2. 先校验 exclusiveGroup，再执行 morph：`replaceTargetRule` 修改 SkillDefinition.targetRule，并修改所有 targetRule 等于原技能 targetRule 的 effects；显式 self/allAllies 等覆盖不变。`replaceDamageElement` 修改该技能全部 DamageEffect。
3. 把装备 `skillPower` 与所有 `addPowerBps` 有效 roll 相加到每个 damage/heal/shield powerBps，再进入各自条件倍率与领域公式。
4. `addRepeatChanceBps` 按 max 得到一次概率；每个根行动只抽一次，成功后只给第一个 DamageEffect 的 hitCount 增加 extraHits，并保留其 retargetEachHit，后续 ApplyStatus/Heal/Shield 不重复。
5. cooldown 修正作用于本次使用后要写入的基础 cooldown，additive turns 后最少 0；energy 修正与技能 baseEnergyGain 相加，所有 energy 词条总增量先 add 后钳制为 0～30。终极先把原能量置 0，再获得修正后的 gain。
6. 根技能 effects 全部结算后，`addFollowUp` 在 afterRootAction 按最终概率检查一次；`statusLink` 同样在 afterRootAction 检查原根行动第一个有效敌方主要 target 是否具有 requiredStatusId。成功的 effectSkillId 进入统一队列，chainDepth+1，并按 effect Skill 自己的 targetRule 重新解析：self/allAllies/allEnemies/randomEnemy 不读取命令 targetUnitIds；singleEnemy 只沿用原主要敌方 target，singleAlly 只沿用原主要友方 target，目标已失效或原行动没有该类单体目标时跳过且不改选。
7. `overhealToShield` 只订阅 onOverheal；对每个 HealEffect 的每个受益者分别处理一次实际 overheal，按转化率和目标最大生命上限生成持续 2 回合的 shield。它不是 follow-up skill、不抽概率、不占 skillAffix 的 root/round/battle trigger budget；每个实际护盾作为一个派生事件计入单根全局 32 事件上限，但不计“每单位最多 8 个派生伤害”，并照常产生 onGainShield。

所有 `operation.kind='addFollowUp'|'statusLink'` 的派生触发预算固定为 `1/1/999`（每根/每轮/每场），budget key 为 `${ownerUnitId}:skillAffix:${skillAffixId}`；repeat 不创建独立触发，overhealToShield 只受上条明确的全局派生事件上限。

## 5. 数量与可用池门禁

- normal=20、abyss=4，总计 24。
- 对每名角色和 itemLevel 1～50，normal pool 在应用 exclusiveGroup 后必须至少能生成 3 条；对 itemLevel 26～50，abyss pool 至少 1 条。
- 逐角色固定 100 个 seed 生成 magic/rare/epic/abyss，断言 1/2/3/4 条、调谐角色、目标有效、无重复/互斥和 roll 闭区间。
- `sa_frost_spread`、`sa_guard_shared_wall` 的全体化只替换 targetRule，不改变 power；这是明确的高阶 E/Y 构筑效果，不在运行时偷偷做衰减。
- allSkills 词条对调谐角色 basic/已装备 active/ultimate 生效；passive 没有 damage/heal/shield effect 时 addPower 无实际数值，但其词条 tags 仍因 allSkills 命中固定 passive 而激活。
