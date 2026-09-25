# 数值与平衡冻结表

## 文档状态

- 版本：BAL-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：本文件中的 ID、整数、公式、上下限和权重均为首版实现输入；实现不得自行补默认值
- 舍入：除特别说明外，每个乘法步骤后向下取整，最终生命/攻击/防御/速度最少为 1

## 1. 等级与角色属性

### 1.1 经验

- 从当前等级 `L` 升到 `L + 1`：`100 + 60 × (L - 1)`。
- 到达等级 `L` 的累计经验：`100 × (L - 1) + 30 × (L - 1) × (L - 2)`。
- 50 级封顶，满级后的经验不增加且不转化为其他资源。

| 等级 | 到下一级 | 累计经验 |
| ---: | ---: | ---: |
| 1 | 100 | 0 |
| 5 | 340 | 760 |
| 10 | 640 | 3,060 |
| 20 | 1,240 | 12,160 |
| 30 | 1,840 | 27,260 |
| 40 | 2,440 | 48,360 |
| 49 | 2,980 | 72,480 |
| 50 | - | 75,460 |

### 1.2 六名角色 StatBlock

表中“成长”是每升一级的整数增量；`growthPerLevel.speed=0`，未列出的百分比成长均为 0。`critDamageBps` 的基础值均为 15000。

| characterId | 定位 | Lv1 HP | HP 成长 | Lv1 ATK | ATK 成长 | Lv1 DEF | DEF 成长 | SPD | 暴击 | 效果命中 | 效果抵抗 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `char_wanderer` | 均衡近战/主角 | 420 | 38 | 58 | 5 | 32 | 3 | 52 | 500 | 200 | 300 |
| `char_iron_guard` | 前排坦克 | 520 | 46 | 48 | 4 | 45 | 4 | 38 | 300 | 100 | 700 |
| `char_ranger` | 高速物理 | 360 | 32 | 62 | 6 | 25 | 2 | 65 | 800 | 200 | 200 |
| `char_ember_mage` | 火焰法师 | 330 | 29 | 68 | 6 | 22 | 2 | 50 | 500 | 600 | 300 |
| `char_frost_seer` | 控制法师 | 350 | 31 | 60 | 5 | 26 | 2 | 55 | 400 | 800 | 500 |
| `char_priest` | 治疗辅助 | 390 | 35 | 52 | 5 | 30 | 3 | 46 | 300 | 400 | 700 |

### 1.3 固定被动数值

| passiveSkillId | 被动修正 | tags |
| --- | --- | --- |
| `skill_wanderer_instinct` | `attack +8%` | `bleed ×1`, `guard ×1` |
| `skill_guard_unyielding` | `maxHp +12%` | `shield ×1`, `taunt ×1` |
| `skill_ranger_eagle_eye` | `critRateBps +800` | `crit ×1`, `speed ×1` |
| `skill_ember_kindling` | `fire damage +1000 bps` | `burn ×1`, `fire ×1` |
| `skill_frost_clarity` | `effectHitBps +1000` | `frost ×1`, `control ×1` |
| `skill_priest_benediction` | `healingBonus +1200 bps` | `heal ×1`, `holy ×1` |

## 2. 敌人数值曲线

### 2.1 每层普通敌人基准

| 层 | 标准等级 | HP | ATK | DEF | SPD | effectHit | effectResist | 普通 XP/金币 | 精英 XP/金币 | Boss XP/金币 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | 3 | 300 | 42 | 18 | 45 | 0 | 0 | 45 / 18 | 130 / 60 | 450 / 250 |
| 2 | 8 | 500 | 60 | 28 | 48 | 300 | 200 | 80 / 35 | 230 / 105 | 800 / 450 |
| 3 | 13 | 750 | 82 | 40 | 50 | 500 | 400 | 125 / 55 | 360 / 165 | 1,200 / 700 |
| 4 | 18 | 1,000 | 105 | 53 | 52 | 700 | 600 | 180 / 80 | 520 / 240 | 1,700 / 1,000 |
| 5 | 23 | 1,300 | 132 | 68 | 54 | 900 | 800 | 250 / 110 | 720 / 330 | 2,300 / 1,350 |
| 6 | 28 | 1,600 | 165 | 86 | 58 | 1,100 | 1,000 | 340 / 150 | 980 / 450 | 3,100 / 1,850 |
| 7 | 33 | 1,900 | 205 | 106 | 61 | 1,300 | 1,200 | 450 / 200 | 1,300 / 600 | 4,100 / 2,450 |
| 8 | 38 | 2,250 | 252 | 130 | 64 | 1,500 | 1,400 | 590 / 260 | 1,700 / 780 | 5,300 / 3,200 |
| 9 | 43 | 2,600 | 305 | 158 | 67 | 1,700 | 1,600 | 760 / 335 | 2,200 / 1,000 | 6,800 / 4,100 |
| 10 | 48 | 3,000 | 368 | 190 | 70 | 2,000 | 1,800 | 960 / 420 | 2,800 / 1,260 | 8,600 / 5,200 |

所有普通敌人暴击为 500、暴伤为 15000；没有表内明确覆盖时元素弱点 1 个、抗性 0 个、状态免疫 0 个。

### 2.2 敌人原型倍率

倍率为 basis point，先乘层基准再向下取整。精英在原型倍率之后再乘：HP 18000、ATK 12000、DEF 12000、SPD 10500。

| archetype | HP | ATK | DEF | SPD | 用途 |
| --- | ---: | ---: | ---: | ---: | --- |
| `balanced` | 10000 | 10000 | 10000 | 10000 | 教学/通用 |
| `brute` | 13500 | 12000 | 10500 | 8000 | 高血重击 |
| `swift` | 8500 | 10500 | 8500 | 13500 | 抢速/连击 |
| `guardian` | 14500 | 8500 | 14500 | 7500 | 高防/护盾 |
| `caster` | 9000 | 12500 | 8000 | 10000 | 状态/范围 |
| `support` | 10500 | 8000 | 9500 | 9500 | 治疗/强化 |

### 2.3 25 类普通/精英敌人冻结清单

`N` 为普通，`E` 为精英专用定义。每个 ID 的最终 StatBlock 由“层基准 × 原型 × 精英倍率”唯一得到，并由内容测试锁快照。

| floor | enemyId | 名称 | rank | archetype | 弱点 | 抗性 | 技能模板 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `enemy_grass_slime` | 青草史莱姆 | N | balanced | fire | - | `basic`, `defend` |
| 1 | `enemy_thorn_rat` | 荆棘鼠 | N | swift | frost | physical | `basic`, `doubleHit` |
| 1 | `enemy_fang_wolf` | 裂牙狼 | N | brute | fire | physical | `basic`, `bleedHit` |
| 1 | `enemy_goblin_scout` | 地精斥候 | N | caster | lightning | - | `ranged`, `slowHit` |
| 1 | `enemy_stonehide_boar` | 石皮野猪 | E | guardian | poison | physical | `basic`, `charge` |
| 2 | `enemy_sporeling` | 孢子怪 | N | caster | fire | poison | `basic`, `poisonHit` |
| 2 | `enemy_venom_spider` | 毒牙蛛 | N | swift | frost | poison | `basic`, `poisonDouble` |
| 2 | `enemy_fungal_guardian` | 菌甲守卫 | E | guardian | fire | poison | `basic`, `guardAll` |
| 3 | `enemy_cave_bat` | 矿洞蝠 | N | swift | lightning | dark | `basic`, `speedUp` |
| 3 | `enemy_ore_golem` | 矿岩魔像 | E | guardian | lightning | physical | `basic`, `stunHit` |
| 3 | `enemy_bomb_goblin` | 爆破地精 | N | caster | frost | fire | `ranged`, `allHit` |
| 4 | `enemy_bog_leech` | 沼泽血蛭 | N | support | holy | poison | `basic`, `selfHeal` |
| 4 | `enemy_mist_wraith` | 迷雾怨灵 | E | caster | holy | dark | `ranged`, `fearAll` |
| 5 | `enemy_ember_hound` | 余烬猎犬 | N | brute | frost | fire | `basic`, `burnHit` |
| 5 | `enemy_ash_cultist` | 灰烬教徒 | E | caster | frost | fire | `ranged`, `burnAll` |
| 6 | `enemy_abyss_mauler` | 深渊碾压者 | E | brute | holy | dark | `basic`, `executeHit` |
| 6 | `enemy_dread_eye` | 恐惧魔眼 | N | caster | holy | dark | `ranged`, `fearHit` |
| 7 | `enemy_blood_ghoul` | 血肉尸鬼 | N | swift | holy | dark | `basic`, `bleedDouble` |
| 7 | `enemy_crimson_acolyte` | 猩红侍祭 | E | support | frost | dark | `ranged`, `allyHeal` |
| 8 | `enemy_frost_warden` | 寒狱守卫 | E | guardian | fire | frost | `basic`, `frostGuard` |
| 8 | `enemy_ice_revenant` | 冰骸法师 | N | caster | fire | frost | `ranged`, `freezeHit` |
| 9 | `enemy_void_spark` | 虚空电灵 | N | swift | physical | lightning | `ranged`, `shockDouble` |
| 9 | `enemy_watcher_shard` | 观测者碎片 | E | caster | dark | lightning | `ranged`, `speedDownAll` |
| 10 | `enemy_throne_knight` | 王座骑士 | E | guardian | holy | dark | `basic`, `counterGuard` |
| 10 | `enemy_abyss_herald` | 深渊先声 | N | caster | holy | dark | `ranged`, `allHit` |

### 2.4 十个 Boss 精确面板

Boss 的 `critRateBps=500`、`critDamageBps=15000` 固定相同；表中 level 直接写入 EnemyDefinition，不再套普通敌人原型或精英倍率。

| floor | enemyId | level | HP | ATK | DEF | SPD | effectHit | effectResist | 弱点 | 抗性/免疫 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | `boss_horned_king` | 5 | 2,400 | 62 | 26 | 42 | 500 | 1,000 | fire | stun |
| 2 | `boss_brood_spider` | 10 | 4,200 | 88 | 38 | 52 | 900 | 1,300 | fire | poison; poison immune |
| 3 | `boss_iron_devourer` | 15 | 6,200 | 118 | 65 | 38 | 900 | 1,600 | lightning | physical; stun immune |
| 4 | `boss_bog_witch` | 20 | 7,800 | 142 | 64 | 58 | 1,300 | 1,900 | holy | dark; poison immune |
| 5 | `boss_ember_guardian` | 25 | 10,500 | 182 | 92 | 55 | 1,500 | 2,100 | frost | fire; burn immune |
| 6 | `boss_abyss_butcher` | 30 | 13,000 | 230 | 116 | 62 | 1,800 | 2,400 | holy | dark; fear immune |
| 7 | `boss_crimson_knight` | 35 | 14,500 | 285 | 132 | 72 | 2,000 | 2,600 | frost | dark; bleed immune |
| 8 | `boss_pale_jailer` | 40 | 15,500 | 345 | 185 | 58 | 2,200 | 2,900 | fire | frost; freeze immune |
| 9 | `boss_thousand_eye` | 45 | 18,000 | 420 | 190 | 78 | 2,500 | 3,100 | dark | lightning; stun immune |
| 10 | `boss_abyss_king` | 50 | 19,000 | 510 | 240 | 75 | 2,800 | 3,500 | holy | dark; stun/freeze/fear immune |

Boss 技能、阈值和行动优先级在 `skills-table.md` 冻结；不得仅凭面板临时提高难度。

本轮 HP 曲线已按防御常数 `300` 重算。冻结目标不是让裸装自动通关，而是把普通/精英的耐久控制在移动端可接受时长，并把层主门槛集中到同层装备、弱点利用、Combo 和狂暴回合。完整核算输入、结果及可接受区间见 `balance-evaluation.md`。

## 3. 状态表

`duration` 由施加效果明确给出；下表只冻结状态自身。周期伤害的百分比使用施加者攻击快照。三个 Boss 状态 `status_boss_phase_2`、`status_boss_phase_3`、`status_boss_enrage` 的 `canDispel = false`，其余状态均为 `true`。debuff 的 immunityTag 按表中精确值生成，buff 未写时为 `null`。

| statusId | zh-CN 名称 | polarity | maxStacks | refreshRule | triggerTiming | immunityTag | effect | 固定值 |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `status_bleed` | 流血 | debuff | 5 | independentStacks | afterAction | bleed | periodicDamage physical | 每层 2500 bps |
| `status_burn` | 灼烧 | debuff | 5 | independentStacks | turnEnd | burn | periodicDamage fire | 每层 3000 bps |
| `status_poison` | 中毒 | debuff | 5 | independentStacks | turnEnd | poison | periodicDamage poison | 每层 2500 bps |
| `status_slow` | 迟缓 | debuff | 1 | replaceDuration | none | slow | speed percent | -2000 bps |
| `status_freeze` | 冻结 | debuff | 1 | replaceDuration | turnStart | freeze | skipTurn | 跳过 1 次本人行动 |
| `status_stun` | 眩晕 | debuff | 1 | replaceDuration | turnStart | stun | skipTurn | 跳过 1 次本人行动 |
| `status_taunt` | 嘲讽 | debuff | 1 | replaceDuration | none | taunt | taunt | 单体攻击强制选来源 |
| `status_guard_30` | 防御 | buff | 1 | replaceDuration | none | - | guard | 直接伤害 -3000 bps |
| `status_shield` | 护盾 | buff | 99 | independentStacks | none | - | shield | 每次 ShieldEffect 新建一条 RuntimeStatusStack，数值写入 shieldRemaining |
| `status_marked` | 标记 | debuff | 1 | replaceDuration | none | marked | defense percent | -1500 bps |
| `status_haste` | 急速 | buff | 1 | replaceDuration | none | - | speed percent | +2000 bps |
| `status_attack_up` | 攻击提升 | buff | 1 | replaceDuration | none | - | attack percent | +2500 bps |
| `status_defense_up` | 防御提升 | buff | 1 | replaceDuration | none | - | defense percent | +2000 bps |
| `status_fear` | 恐惧 | debuff | 1 | replaceDuration | none | fear | attack percent | -1500 bps |
| `status_shock` | 感电 | debuff | 3 | independentStacks | none | shock | speed percent | 每层 -500 bps |
| `status_boss_phase_2` | Boss 二阶段 | buff | 1 | replaceDuration | none | bossPhase | attack percent | +1500 bps；`canDispel=false` |
| `status_boss_phase_3` | Boss 三阶段 | buff | 1 | replaceDuration | none | bossPhase | speed percent | +2000 bps；`canDispel=false` |
| `status_boss_enrage` | 层主狂暴 | buff | 1 | replaceDuration | none | bossEnrage | attack percent | +5000 bps；`canDispel=false` |

## 4. 敌方技能模板数值与 AI 展开

2.3 表内 `template` 不是运行时别名，而是构建期查表键；必须按下表展开为精确 `skillId` 和 `EnemyAiRule`。模板按敌人自身 ATK 计算。每个列出的 AI rule `weight=100`；两个基础模板不写入 `aiRules`，而是把 skillId/targetStrategy 分别写入 `basicSkillId/basicTargetStrategy` 作为永久回退。先按 DATA-1.2 选中最高优先级 rule，再执行目标策略；未胜出规则不提前消费目标 RNG。

| template | skillId | 目标/效果 | CD | conditions / priority | targetStrategy |
| --- | --- | --- | ---: | --- | --- |
| `basic` | `skill_enemy_basic_physical` | singleEnemy/front；10000 physical | 0 | fallback | frontFirstOpponent |
| `ranged` | `skill_enemy_basic_ranged` | singleEnemy；9500 physical | 0 | fallback | lowestHpOpponent |
| `defend` | `skill_enemy_defend` | self；`status_guard_30` 1 回合 | 3 | `selfHpAtMostBps=5000` / 80 | self |
| `doubleHit` | `skill_enemy_double_hit` | singleEnemy/front；6000×2 physical | 2 | `always` / 70 | frontFirstOpponent |
| `bleedHit` | `skill_enemy_bleed_hit` | singleEnemy/front；9000 physical + bleed/7000/1/3 | 2 | `targetMissingStatus=bleed` / 80；`always` / 50 | frontFirstOpponent |
| `slowHit` | `skill_enemy_slow_hit` | singleEnemy；8500 physical + slow/7500/1/2 | 2 | `targetMissingStatus=slow` / 80 | lowestHpOpponent |
| `charge` | `skill_enemy_charge` | singleEnemy/front；15000 physical + stun/4000/1/1 | 3 | `roundAtLeast=2` / 90 | frontFirstOpponent |
| `poisonHit` | `skill_enemy_poison_hit` | singleEnemy；8500 poison + poison/8000/1/3 | 2 | `targetStatusStacksAtMost=poison:1` / 80 | lowestHpOpponent |
| `poisonDouble` | `skill_enemy_poison_double` | singleEnemy；5000×2 poison + poison/5000/1/3，状态只判定一次 | 3 | `always` / 75 | lowestHpOpponent |
| `guardAll` | `skill_enemy_guard_all` | allAllies；maxHp 800 bps shield + defense_up 2 回合 | 4 | `anyAllyHpAtMostBps=6000` / 90 | self |
| `speedUp` | `skill_enemy_haste` | self；haste 2 回合 | 3 | `selfMissingStatus=haste` / 80 | self |
| `stunHit` | `skill_enemy_stun_hit` | singleEnemy/front；11000 physical + stun/5500/1/1 | 3 | `always` / 80 | frontFirstOpponent |
| `allHit` | `skill_enemy_all_physical` | allEnemies；6500 physical | 3 | `opponentCountAtLeast=2` / 70 | self |
| `selfHeal` | `skill_enemy_self_heal` | self；attack 10000 治疗 | 3 | `selfHpAtMostBps=4500` / 90 | self |
| `fearAll` | `skill_enemy_fear_all` | allEnemies；fear/7000/1/2 | 4 | `roundEquals=1` / 85；`opponentsMissingStatusCountAtLeast=fear:2` / 80 | self |
| `burnHit` | `skill_enemy_burn_hit` | singleEnemy/front；9500 fire + burn/8000/1/3 | 2 | `targetStatusStacksAtMost=burn:1` / 80 | frontFirstOpponent |
| `burnAll` | `skill_enemy_burn_all` | allEnemies；6000 fire + burn/6000/1/3 | 3 | `opponentCountAtLeast=2` / 75 | self |
| `executeHit` | `skill_enemy_execute` | singleEnemy/front；13000 dark，低血乘 13846 后为 17999 before defense | 3 | `anyOpponentHpAtMostBps=3000` / 95 | lowestHpOpponent |
| `fearHit` | `skill_enemy_fear_hit` | singleEnemy；9000 dark + fear/8000/1/2 | 2 | `targetMissingStatus=fear` / 80 | lowestHpOpponent |
| `bleedDouble` | `skill_enemy_bleed_double` | singleEnemy/front；5500×2 physical + bleed/8000/1/3，状态只判定一次 | 3 | `always` / 80 | frontFirstOpponent |
| `allyHeal` | `skill_enemy_ally_heal` | singleAlly；attack 9000 治疗 | 3 | `anyAllyHpAtMostBps=5500` / 95 | lowestHpAlly |
| `frostGuard` | `skill_enemy_frost_guard` | allAllies；maxHp 1000 bps shield + defense_up 2 回合 | 4 | `anyAllyHpAtMostBps=7000` / 90 | self |
| `freezeHit` | `skill_enemy_freeze_hit` | singleEnemy；9000 frost + freeze/3500/1/1 | 3 | `always` / 80 | lowestHpOpponent |
| `shockDouble` | `skill_enemy_shock_double` | randomEnemy；5500×2 lightning + shock/6500/1/2，状态只判定一次 | 3 | `always` / 80 | randomValid |
| `speedDownAll` | `skill_enemy_slow_all` | allEnemies；slow/7500/1/2 | 4 | `roundEquals=1` / 90；`opponentsMissingStatusCountAtLeast=slow:2` / 80 | self |
| `counterGuard` | `skill_enemy_counter_guard` | self；maxHp 1200 bps shield + guard_30 1 回合 | 3 | `selfHpAtMostBps=7000` + `selfMissingStatus=shield` / 90 | self |
| `bossEnrage` | `skill_boss_enrage` | self；`status_boss_enrage` 999 回合 | 0 | `roundAtLeast=FloorDefinition.bossEnrageRound` + `selfMissingStatus=status_boss_enrage` / 120 | self |

裸状态键在构建期只按 `bleed→status_bleed` 等状态表映射展开。每个分号分隔的“conditions / priority”条目生成一条 AI rule；同一条内用 `+` 连接的 conditions 为 AND。运行时内容不保存 template 键。`bossEnrage` 只追加到十个 Boss，round 由其唯一楼层字段物化；普通/精英禁止引用。

## 5. 掉落、商店与铁匠

### 5.1 战斗掉落次数

| 遭遇 | 金币/XP | 装备 | 技能铭石 | 材料 |
| --- | --- | --- | --- | --- |
| 普通 | 使用楼层表 | 3500 bps 抽 1 件 | 0 | 7000 bps 抽 1 组 |
| 精英 | 使用楼层表 | 必得 1 件 magic+，另 2000 bps 加 1 件 | 必得 1 枚 magic+；第一层覆盖为 rare | 必得 1 组 |
| Boss | 使用楼层表 | 必得 1 件 rare+，另 5000 bps 加 1 件 | 1～5 层 5000 bps；6～10 层必得 1 枚 | 必得 2 组 |

- 第 6～9 层 Boss 的保证装备独立有 1000/1200/1500/1800 bps 升格为 abyss；第 10 层普通重复击败为 2500 bps。
- 第 10 层首杀指定 `eq_accessory_t6_crown` 不占 Boss 的常规保证装备次数；重复击败另有 500 bps 独立掉落该底材。
- 材料组数量：普通层 `1～2`，深渊层 `2～4`；按 loot RNG 闭区间均匀抽取。

### 5.2 品质权重

| 层数 | common | magic | rare | epic | abyss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 35 | 50 | 15 | 0 | 0 |
| 2 | 35 | 50 | 14 | 1 | 0 |
| 3～5 | 15 | 50 | 30 | 5 | 0 |
| 6～7 | 0 | 35 | 45 | 17 | 3 |
| 8～9 | 0 | 20 | 45 | 27 | 8 |
| 10 | 0 | 0 | 45 | 40 | 15 |

保证最低品质先移除更低品质项，再对剩余权重重新归一化；不把低品质结果强制改名为高品质。

技能铭石不含 common，战斗掉落固定使用以下权重；itemLevel 与同层装备一致，Boss 取层上限、精英取区间中位数：

| 层数 | magic | rare | epic | abyss |
| --- | ---: | ---: | ---: | ---: |
| 1 | 80 | 20 | 0 | 0 |
| 2 | 80 | 19 | 1 | 0 |
| 3～5 | 55 | 38 | 7 | 0 |
| 6～7 | 35 | 45 | 17 | 3 |
| 8～9 | 20 | 45 | 27 | 8 |
| 10 | 0 | 45 | 40 | 15 |

铭石保证最低品质使用 `magic < rare < epic < abyss` 序表执行同一“移除低项后重新归一化”规则。

### 5.3 固定经济参数

| 参数 | 值 |
| --- | ---: |
| 出售率 | 2500 bps |
| 商店购买倍率 | 20000 bps |
| 会话回购上限 | 10 |
| 旅店费用 | 0 |
| 锻造特性权重 | ordinary 70 / tempered 25 / exalted 5 |
| 装备分解产物 | `item_forge_shard` |
| 铭石分解产物 | `item_inscription_dust` |
| equipmentReforgeBaseCost / PerItemLevel | 5 / 1 |
| skillStoneReforgeBaseCost / PerTwoItemLevels | 5 / 1 |
| 装备重铸 | `5 + itemLevel` 个 `item_forge_shard` |
| 铭石重铸 | `5 + ceil(itemLevel / 2)` 个 `item_inscription_dust` |
| 单种堆叠物持有上限 | 9999 |

| 品质 | 装备分解碎片 | 铭石分解尘 |
| --- | ---: | ---: |
| common | 1 | - |
| magic | 2 | 2 |
| rare | 4 | 4 |
| epic | 8 | 8 |
| abyss | 16 | 16 |

### 5.4 商店 tier

| tier | 最高解锁层门槛 | offer 数 | itemLevel | 类型权重（消耗品/装备/铭石） | 装备品质权重 | 铭石品质权重 |
| --- | ---: | ---: | --- | --- | --- | --- |
| `shop_t1` | 1 | 8 | 1～5 | 45 / 45 / 10 | 40/50/10/0/0 | 80/20/0/0 |
| `shop_t2` | 3 | 10 | 6～15 | 35 / 50 / 15 | 20/55/23/2/0 | 60/35/5/0 |
| `shop_t3` | 6 | 12 | 21～30 | 25 / 55 / 20 | 0/45/45/10/0 | 35/50/15/0 |
| `shop_t4` | 9 | 12 | 36～45 | 20 / 55 / 25 | 0/25/50/25/0 | 20/50/30/0 |

商店不直接出售 abyss 品质；深渊装备和深渊铭石只来自战斗掉落。类型权重中某次抽到的池按 ShopDefinition 内条目权重继续抽取。

四档库存是刻意设置的“补位档”，不是随当前最高层线性追平：解锁层 1～2 使用 ilv 1～5、3～5 使用 6～15、6～8 使用 21～30、9～10 使用 36～45。它只在第 1/3/6/9 层入口接近当层上限，之后随玩家继续解锁逐层落后；第 10 层推荐 ilv 48 时商店上限仍为 45。该缺口用于保证商店能修补空部位和坏词条，但不能用金币直接跳过第 5、8、10 层构筑门槛。若实现擅自按最高解锁层放大 itemLevel，视为冻结表不一致。

每个 tier 的 `equipmentBasePools` 在构建期按固定 slot 顺序 weapon→helmet→armor→gloves→boots→accessory 生成 6 组，各 `weight=100`；组内按 `equipment-tables.md` 2.1→2.2 的表格顺序收集与该 tier itemLevel 闭区间有交集的普通池底材，每项 `weight=100`，永远排除 `eq_accessory_t6_crown`。生成 offer 时先抽 itemLevel，逐组只保留 `minItemLevel≤itemLevel≤maxItemLevel` 的条目，再进行 slot 抽取与组内 base 抽取；任一组为空为 `INVALID_CONTENT`。禁止先抽到不兼容底材后钳制或降级。

### 5.5 物品与商店堆叠物池

首版 StackableItemDefinition 固定为 5 个。`nameKey=item.<itemId>.name`，iconId 固定为 `icon_<itemId>`；材料的 useContexts/target/effects 字段不存在，因为其判别分支为 MaterialItemDefinition。

| itemId | zh-CN 名称 | category | maxStack | baseGold | useContexts | target | effects |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `item_minor_potion` | 小型生命药水 | consumable | 99 | 20 | field,battle | singleAlly | `H(maxHp,2500,false)` |
| `item_major_potion` | 大型生命药水 | consumable | 99 | 60 | field,battle | singleAlly | `H(maxHp,5000,false)` |
| `item_cleansing_tonic` | 净化药剂 | consumable | 99 | 45 | battle | singleAlly | `DISPEL(debuff,1)` |
| `item_forge_shard` | 锻造碎片 | material | 99 | 5 | - | - | - |
| `item_inscription_dust` | 铭文尘 | material | 99 | 5 | - | - | - |

ShopTierDefinition.stackableItems 固定如下；同一格格式为 `itemId:weight:quantityMin～quantityMax`：

| tier | stackableItems（原数组顺序） |
| --- | --- |
| `shop_t1` | `item_minor_potion:60:1～3`, `item_forge_shard:20:1～2`, `item_inscription_dust:20:1～2` |
| `shop_t2` | `item_minor_potion:40:1～3`, `item_major_potion:20:1～2`, `item_cleansing_tonic:20:1～2`, `item_forge_shard:10:2～4`, `item_inscription_dust:10:2～4` |
| `shop_t3` | `item_major_potion:35:1～3`, `item_cleansing_tonic:25:1～2`, `item_forge_shard:20:3～6`, `item_inscription_dust:20:3～6` |
| `shop_t4` | `item_major_potion:40:2～4`, `item_cleansing_tonic:20:1～3`, `item_forge_shard:20:4～8`, `item_inscription_dust:20:4～8` |

### 5.6 50 个 DropTableDefinition 的纯函数展开

每层固定生成 `drop_floor_NN_normal`、`drop_floor_NN_elite`、`drop_floor_NN_boss`、`drop_floor_NN_chest`、`drop_floor_NN_first_clear` 五张表，共 50 张。运行时只保存完整 rolls，不从 ID 解析楼层或 rank。

- equipment roll 的 `equipmentBasePools` 取 `equipment-tables.md` 2.3 对应层：固定 6 个 slot 组各权重 100，组内合法底材各权重 100；qualityWeights 取 5.2 装备表。
- skillStone roll 的 qualityWeights 取 5.2 铭石表。
- normal/chest 的 itemLevelMin/Max 使用本层完整区间；elite 两端都等于 `floor((层最小+层最大)/2)`；boss 两端都等于层上限。
- 每条 roll 先调用统一 `rollBps(chance)`；0/10000 按公共规则不抽值。随机 equipment 的后续顺序固定为 itemLevel → equipment slot → slot 内 base → 非零 abyssUpgrade 判定 → 未升格时 quality → normal affix ID/roll 逐条交错 → craftGrade → craftEmpowered 目标 → abyss affix ID/roll。skillStone 固定为 itemLevel → attunedCharacter（专注覆盖也消费并丢弃）→ quality → normal affix ID/roll 逐条交错 → abyss affix ID/roll。fixedEquipment 不抽 itemLevel/slot/base/quality/fixedAbyssAffixId：ordinary 为 normal ID/roll；weighted 为 normal ID/roll → craftGrade → craftEmpowered 目标；指定 tempered/exalted 则按 `game-design.md` 8.1 先将 1/2 个合法强化 affix ID/roll 逐条预抽，再补普通 affix ID/roll，不另抽 grade 或强化目标。slot、组内 base、调谐角色或强化目标只有一个候选也照常消费稳定抽值；其他不适用步骤不消费 RNG。instanceId/时间戳由 DomainContext 注入且不消费该随机流。stackableItemPool 为 itemId → quantity，固定 stackableItem 仅 quantity（定量时也调用一次 nextIntInclusive）。
- normal/elite/boss 的 xpReward 与 goldRewardMin=goldRewardMax 逐层读取 2.1 对应 rank 列。normal/elite canRetreat=true，boss=false。
- materialPool：第 1～5 层为 `item_forge_shard:70, item_inscription_dust:30`、quantity 1～2；第 6～10 层为两者各 50、quantity 2～4。

| rank | rolls（保持所列顺序） |
| --- | --- |
| normal | equipment chance=3500/minQuality=null/abyssUpgrade=0；stackableItemPool material chance=7000 |
| elite | equipment chance=10000/minQuality=magic/abyssUpgrade=0；equipment chance=2000/minQuality=null/abyssUpgrade=0；skillStone chance=10000/minQuality=magic；stackableItemPool material chance=10000 |
| boss | equipment chance=10000/minQuality=rare/abyssUpgrade 见下；equipment chance=5000/minQuality=null/abyssUpgrade=0；skillStone chance=5000（1～5）或 10000（6～10）/minQuality=null；stackableItemPool material chance=10000 两次 |
| chest | equipment chance=10000/minQuality=magic/abyssUpgrade=0；stackableItemPool material chance=10000 |

唯一教学覆盖：`drop_floor_01_elite` 的 skillStone roll 把 `guaranteedMinQuality` 从 magic 提升为 rare；其余字段仍按 elite/floor 纯函数展开。第一层 qualityWeights 没有 epic，因此该枚必为 rare 且生成 2 条普通技能词条，保证垂直切片能实际教学铭石系统。其他层精英的 chance 也固定为 10000，避免技能词条与 Combo 的入口被连续空掉落阻断。每次远征第一笔成功提交的精英铭石按 `skillStoneFocusCharacterId` 定向，之后恢复已招募角色等权抽取；定向时仍消费并丢弃一次等权调谐抽值，因此不改变品质、词条或后续 RNG 消费顺序。

`drop_floor_10_boss` 在上述 rolls 末尾再追加一条 fixedEquipment：chance=500、baseId=`eq_accessory_t6_crown`、itemLevel=50、quality=abyss、craftGrade=weighted、fixedAbyssAffixId=`af_abyss_kingbrand`。第 6～10 层 Boss 第一条保证装备的 `abyssUpgradeChanceBps` 依次为 1000/1200/1500/1800/2500；第 1～5 层为 0。upgrade 未命中时，该保证 roll 的 qualityWeights 把 abyss 固定为 0，再按 5.2 原权重选择满足 rare+ 的非 abyss 品质；额外 roll 保持 5.2 完整权重。这里的覆盖只作用于第一条保证 roll。

首次击败 Boss 时，在普通 boss 表之外原子追加对应 first-clear 表；内容固定如下：

| floor | firstClearRewardTableId | rolls |
| ---: | --- | --- |
| 1 | `drop_floor_01_first_clear` | `item_forge_shard` ×5 |
| 2 | `drop_floor_02_first_clear` | `item_inscription_dust` ×5 |
| 3 | `drop_floor_03_first_clear` | `item_forge_shard` ×8 |
| 4 | `drop_floor_04_first_clear` | `item_inscription_dust` ×8 |
| 5 | `drop_floor_05_first_clear` | `item_forge_shard` ×10；`item_inscription_dust` ×10 |
| 6 | `drop_floor_06_first_clear` | `item_forge_shard` ×12 |
| 7 | `drop_floor_07_first_clear` | `item_inscription_dust` ×12 |
| 8 | `drop_floor_08_first_clear` | `item_forge_shard` ×16 |
| 9 | `drop_floor_09_first_clear` | `item_inscription_dust` ×16 |
| 10 | `drop_floor_10_first_clear` | fixedEquipment chance=10000、baseId=`eq_accessory_t6_crown`、itemLevel=50、quality=abyss、craftGrade=exalted、fixedAbyssAffixId=`af_abyss_kingbrand`；`item_forge_shard` ×20；`item_inscription_dust` ×20 |

表内固定材料数量展开为 chanceBps=10000 且 quantityMin=quantityMax 的 stackableItem roll。第 10 层 crown first-clear roll 与常规保证装备相互独立；只有整笔 RewardTransaction 成功后才写入首通标记。

## 6. 数值变更门禁

1. 表内 ID 或数值变更必须同时更新 `contentVersion`、相关快照测试和变更记录。
2. 实施任务只能逐行录入，不得因“手感”临时提高/降低；试玩调平衡必须先修改本表并获得新确认。
3. 内容构建允许用纯函数物化“层基准 × 原型倍率”，但 `ContentCatalog` 最终暴露的 EnemyDefinition.stats 必须是校验后的明确整数。
4. 任何表格空值只表示字段按契约固定为 `null`/空数组，不能推断默认效果。
