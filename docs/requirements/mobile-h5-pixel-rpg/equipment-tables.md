# 装备底材与装备词条冻结表

## 文档状态

- 版本：EQUIP-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：60 个底材、40 个普通词条、8 个深渊词条和全部触发定义均为首版冻结输入
- 实现约束：表格缩写只允许构建期展开；运行时必须生成 `data-contracts.md` 的完整字段，不读取缩写或别名

## 1. 表格缩写

- 部位：`W=weapon`、`H=helmet`、`A=armor`、`G=gloves`、`B=boots`、`X=accessory`。
- 品质：`M=magic`、`R=rare`、`E=epic`、`Y=abyss`。
- 武器：`SW=sword`、`HM=hammer`、`BW=bow`、`ST=staff`、`FC=focus`、`RL=relic`。
- tier profile 在构建期逐行展开成 AffixTierDefinition 数组；`rollScaleBps` 未另写时固定为 10000。
- 词条表 `profile` 列使用去掉 `tp_` 的精确短键：例如 `hp_flat` 只允许展开为 `tp_hp_flat`，`abyss_trigger` 只允许展开为 `tp_abyss_trigger`；内联 `26:1～1` 直接生成 tiers，不经过短键。运行时不保存 profile 或短键。
- 空标签写 `-`，运行时必须是空数组；空互斥组写 `-`，运行时必须是 `null`。

## 2. 60 个装备底材

### 2.1 30 把武器

所有武器 `slot=weapon`、`baseStat=attack`。表内 `Lv` 是闭区间；baseValue 对应该区间最低 itemLevel。

所有底材最终基础值固定为 `baseValueAtMinLevel + growthPerItemLevel × (itemLevel - minItemLevel)`；该式只展开 EquipmentBaseDefinition 已列字段，不叠加品质倍率。

| baseId | 名称 | 武器 | Lv | baseValue | growth/Lv | baseGold | gold/Lv |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `eq_sword_t1_windblade` | 青风短剑 | SW | 1～10 | 12 | 2 | 45 | 8 |
| `eq_sword_t2_bloodiron` | 血铁长剑 | SW | 11～20 | 34 | 3 | 130 | 12 |
| `eq_sword_t3_emberedge` | 余烬锋刃 | SW | 21～30 | 68 | 4 | 320 | 18 |
| `eq_sword_t4_voidcutter` | 虚空斩刃 | SW | 31～40 | 110 | 5 | 680 | 26 |
| `eq_sword_t5_kingbreaker` | 破王之剑 | SW | 41～50 | 165 | 6 | 1,250 | 38 |
| `eq_hammer_t1_stonemaul` | 粗石战锤 | HM | 1～10 | 15 | 2 | 50 | 8 |
| `eq_hammer_t2_bastion` | 壁垒铁锤 | HM | 11～20 | 40 | 3 | 145 | 12 |
| `eq_hammer_t3_magma` | 熔核重锤 | HM | 21～30 | 76 | 4 | 350 | 18 |
| `eq_hammer_t4_jailer` | 狱门战锤 | HM | 31～40 | 122 | 5 | 730 | 26 |
| `eq_hammer_t5_worldfall` | 坠界巨锤 | HM | 41～50 | 180 | 6 | 1,330 | 38 |
| `eq_bow_t1_reed` | 青芦短弓 | BW | 1～10 | 13 | 2 | 46 | 8 |
| `eq_bow_t2_hawkeye` | 鹰眼猎弓 | BW | 11～20 | 36 | 3 | 135 | 12 |
| `eq_bow_t3_bloodstring` | 血弦长弓 | BW | 21～30 | 70 | 4 | 330 | 18 |
| `eq_bow_t4_starchaser` | 逐星战弓 | BW | 31～40 | 114 | 5 | 700 | 26 |
| `eq_bow_t5_voidrain` | 虚雨神弓 | BW | 41～50 | 170 | 6 | 1,285 | 38 |
| `eq_staff_t1_oak` | 老橡木杖 | ST | 1～10 | 14 | 2 | 48 | 8 |
| `eq_staff_t2_cinder` | 灰烬法杖 | ST | 11～20 | 38 | 3 | 140 | 12 |
| `eq_staff_t3_volcano` | 火山芯杖 | ST | 21～30 | 74 | 4 | 345 | 18 |
| `eq_staff_t4_nightflame` | 夜焰权杖 | ST | 31～40 | 120 | 5 | 720 | 26 |
| `eq_staff_t5_abyss_sun` | 深渊日轮杖 | ST | 41～50 | 176 | 6 | 1,320 | 38 |
| `eq_focus_t1_frostglass` | 霜玻法器 | FC | 1～10 | 12 | 2 | 45 | 8 |
| `eq_focus_t2_mist_orb` | 迷雾晶球 | FC | 11～20 | 34 | 3 | 130 | 12 |
| `eq_focus_t3_iceheart` | 冰心法器 | FC | 21～30 | 68 | 4 | 320 | 18 |
| `eq_focus_t4_thousand_lens` | 千目透镜 | FC | 31～40 | 112 | 5 | 690 | 26 |
| `eq_focus_t5_zero_core` | 绝零核心 | FC | 41～50 | 168 | 6 | 1,270 | 38 |
| `eq_relic_t1_prayer` | 祷告圣物 | RL | 1～10 | 11 | 2 | 44 | 8 |
| `eq_relic_t2_silver_bell` | 银辉圣铃 | RL | 11～20 | 32 | 3 | 128 | 12 |
| `eq_relic_t3_sun_shard` | 日耀残片 | RL | 21～30 | 66 | 4 | 315 | 18 |
| `eq_relic_t4_pale_grail` | 苍白圣杯 | RL | 31～40 | 108 | 5 | 670 | 26 |
| `eq_relic_t5_dawn_crown` | 黎明冠冕 | RL | 41～50 | 162 | 6 | 1,240 | 38 |

### 2.2 30 件防具与饰品

| baseId | 名称 | slot | Lv | baseStat | baseValue | growth/Lv | baseGold | gold/Lv |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `eq_helmet_t1_traveler` | 旅人软帽 | H | 1～5 | maxHp | 40 | 8 | 35 | 6 |
| `eq_helmet_t2_iron` | 铁边盔 | H | 6～10 | maxHp | 85 | 10 | 70 | 8 |
| `eq_helmet_t3_ember` | 余烬战盔 | H | 11～20 | maxHp | 140 | 12 | 145 | 11 |
| `eq_helmet_t4_abyss` | 深渊面甲 | H | 21～30 | maxHp | 280 | 16 | 330 | 16 |
| `eq_helmet_t5_pale` | 苍白狱盔 | H | 31～40 | maxHp | 470 | 22 | 700 | 24 |
| `eq_helmet_t6_king` | 王座冠盔 | H | 41～50 | maxHp | 720 | 30 | 1,250 | 34 |
| `eq_armor_t1_leather` | 旧皮甲 | A | 1～5 | defense | 6 | 1 | 38 | 6 |
| `eq_armor_t2_chain` | 细环甲 | A | 6～10 | defense | 12 | 1 | 78 | 8 |
| `eq_armor_t3_plate` | 赤铁板甲 | A | 11～20 | defense | 18 | 2 | 155 | 11 |
| `eq_armor_t4_abyss` | 深渊甲胄 | A | 21～30 | defense | 38 | 3 | 350 | 16 |
| `eq_armor_t5_frost` | 寒狱重甲 | A | 31～40 | defense | 72 | 4 | 740 | 24 |
| `eq_armor_t6_sovereign` | 深王战甲 | A | 41～50 | defense | 118 | 6 | 1,320 | 34 |
| `eq_gloves_t1_hide` | 兽皮手套 | G | 1～5 | attack | 4 | 1 | 34 | 6 |
| `eq_gloves_t2_rivet` | 铆钉护手 | G | 6～10 | attack | 9 | 1 | 72 | 8 |
| `eq_gloves_t3_flame` | 炽焰护手 | G | 11～20 | attack | 14 | 1 | 142 | 11 |
| `eq_gloves_t4_crimson` | 猩红臂铠 | G | 21～30 | attack | 28 | 2 | 320 | 16 |
| `eq_gloves_t5_void` | 虚空织手 | G | 31～40 | attack | 48 | 3 | 680 | 24 |
| `eq_gloves_t6_king` | 王权护手 | G | 41～50 | attack | 75 | 4 | 1,220 | 34 |
| `eq_boots_t1_cloth` | 轻布靴 | B | 1～5 | speed | 1 | 0 | 32 | 6 |
| `eq_boots_t2_scout` | 斥候靴 | B | 6～10 | speed | 2 | 0 | 68 | 8 |
| `eq_boots_t3_ash` | 踏灰长靴 | B | 11～20 | speed | 3 | 0 | 138 | 11 |
| `eq_boots_t4_bloodstep` | 血行战靴 | B | 21～30 | speed | 4 | 0 | 310 | 16 |
| `eq_boots_t5_starless` | 无星步履 | B | 31～40 | speed | 5 | 0 | 660 | 24 |
| `eq_boots_t6_throne` | 王座影靴 | B | 41～50 | speed | 6 | 0 | 1,180 | 34 |
| `eq_accessory_t1_charm` | 旧铜护符 | X | 1～5 | critRateBps | 100 | 20 | 40 | 6 |
| `eq_accessory_t2_gem` | 澄明宝石 | X | 6～10 | critRateBps | 200 | 25 | 82 | 8 |
| `eq_accessory_t3_sigil` | 元素印记 | X | 11～20 | critRateBps | 350 | 30 | 165 | 11 |
| `eq_accessory_t4_eye` | 深渊之眼 | X | 21～30 | critRateBps | 650 | 40 | 370 | 16 |
| `eq_accessory_t5_star` | 无星徽记 | X | 31～50 | critRateBps | 1,050 | 50 | 780 | 24 |
| `eq_accessory_t6_crown` | 深王冠饰 | X | 50～50 | critRateBps | 2,500 | 0 | 2,500 | 0 |

### 2.3 楼层底材池

| 楼层 | 武器 tier | 其他部位 tier | itemLevel |
| ---: | --- | --- | --- |
| 1 | t1 | t1 | 1～5 |
| 2 | t1 | t2 | 6～10 |
| 3～4 | t2 | t3 | 11～20，按楼层区间裁剪 |
| 5～6 | t3 | t4 | 21～30，按楼层区间裁剪 |
| 7～8 | t4 | t5 | 31～40，按楼层区间裁剪 |
| 9～10 | t5 | helmet/armor/gloves/boots 使用 t6；accessory 仍用 t5 | 41～50，按楼层区间裁剪 |

掉落表与商店装备按固定部位顺序 weapon→helmet→armor→gloves→boots→accessory 先等权抽取 1/6，再在该部位当前 itemLevel 合法底材中按表格原顺序等权抽取。武器组含当层 6 个 weaponType 各一件，故每种武器的单次装备掉落概率为 1/36，其他单一部位各为 1/6；武器抽到角色不可用不影响掉落合法性，但商店展示适用角色。两级抽取都消费 RNG，禁止把 11 个底材平铺等权导致武器过量。

`eq_accessory_t6_crown` 不进入普通底材池和商店，只进入第 10 层 Boss 独有表：首杀固定生成 itemLevel 50、quality abyss、craftGrade exalted、4 条 normal affix、其中 2 条合法词条强化，abyssAffix 固定 `af_abyss_kingbrand`；其余普通词条仍按种子抽取。重复击败第 10 层 Boss 另有 500 bps 掉落同一底材，属性重新随机，因此可以持续刷取。

## 3. 词条 tier profile

每格格式为 `tier:minItemLevel:rollMin～rollMax`。tier 选择规则见 `game-design.md`；profile 是文档生成缩写，最终每个词条保存独立 tiers 数组。

| profile | T1 | T2 | T3 | T4 | T5 | 数值语义 |
| --- | --- | --- | --- | --- | --- | --- |
| `tp_hp_flat` | `1:25～40` | `11:55～75` | `21:90～120` | `31:135～175` | `41:190～240` | flat maxHp |
| `tp_atk_flat` | `1:3～5` | `11:7～10` | `21:12～16` | `31:18～23` | `41:25～32` | flat attack |
| `tp_def_flat` | `1:2～3` | `11:4～6` | `21:7～10` | `31:11～14` | `41:15～20` | flat defense |
| `tp_speed_flat` | `1:1～1` | `11:1～2` | `21:2～3` | `31:3～4` | `41:4～5` | flat speed |
| `tp_rating` | `1:200～350` | `11:400～600` | `21:650～900` | `31:950～1250` | `41:1300～1700` | flat BPS stat |
| `tp_damage` | `1:300～500` | `11:600～850` | `21:900～1200` | `31:1250～1600` | `41:1650～2100` | damage bonus BPS |
| `tp_conditional` | `1:500～700` | `11:800～1100` | `21:1200～1550` | `31:1600～2050` | `41:2100～2700` | 条件增伤/属性 BPS |
| `tp_trigger` | `1:3000～4000` | `11:4000～5000` | `21:5000～6000` | `31:6000～7000` | `41:7000～8000` | 触发概率 BPS |
| `tp_skill` | `1:500～700` | `11:800～1100` | `21:1200～1500` | `31:1550～1950` | `41:2000～2500` | 指定技能 power 增量 BPS |
| `tp_mechanic` | `31:1～1` | `41:1～1` | - | - | - | 固定机制，无随机数值 |
| `tp_abyss_damage` | `26:1200～1600` | `36:1700～2200` | `46:2300～3000` | - | - | 深渊增伤 BPS |
| `tp_abyss_trigger` | `26:7000～8000` | `36:8000～9000` | `46:9000～10000` | - | - | 深渊触发概率 BPS |

## 4. 40 个普通装备词条

本节 40 行全部固定 `pool=normal`；未另写 `allowedWeaponTypes` 时按第 8 节展开。

### 4.1 基础属性与伤害（16 条）

| affixId | 名称 | category | slots | minLv | quality | stack/exclusive | weight | gold | craft | profile | modifiers | tags |
| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- |
| `af_vitality` | 强健 | baseStat | H/A/G/B/X | 1 | M/R/E/Y | add/- | 100 | 25 | 是 | hp_flat | `flatStat maxHp` | `vitality ×1` |
| `af_might` | 刚力 | baseStat | W/G/X | 1 | M/R/E/Y | add/- | 100 | 25 | 是 | atk_flat | `flatStat attack` | `might ×1` |
| `af_guard` | 坚守 | baseStat | H/A/B/X | 1 | M/R/E/Y | add/- | 100 | 25 | 是 | def_flat | `flatStat defense` | `guard ×1` |
| `af_haste` | 迅捷 | baseStat | B/X | 1 | M/R/E/Y | add/- | 70 | 30 | 是 | speed_flat | `flatStat speed` | `speed ×1` |
| `af_precision` | 精准 | baseStat | W/G/X | 1 | M/R/E/Y | add/- | 85 | 28 | 是 | rating | `flatStat critRateBps` | `crit ×1` |
| `af_ferocity` | 凶猛 | baseStat | W/G/X | 1 | M/R/E/Y | add/- | 75 | 30 | 是 | rating | `flatStat critDamageBps` | `crit ×1` |
| `af_focus` | 专注 | baseStat | H/G/X | 1 | M/R/E/Y | add/- | 80 | 28 | 是 | rating | `flatStat effectHitBps` | `control ×1` |
| `af_resolve` | 坚定 | baseStat | H/A/X | 1 | M/R/E/Y | add/- | 80 | 28 | 是 | rating | `flatStat effectResistBps` | `guard ×1` |
| `af_physical_edge` | 破军 | damageType | W/G/X | 1 | M/R/E/Y | add/- | 85 | 32 | 是 | damage | `damageBonus physical` | `physical ×1` |
| `af_flame` | 炽焰 | damageType | W/G/X | 1 | M/R/E/Y | add/- | 85 | 32 | 是 | damage | `damageBonus fire` | `fire ×1`, `burn ×1` |
| `af_frost` | 凝霜 | damageType | W/G/X | 1 | M/R/E/Y | add/- | 85 | 32 | 是 | damage | `damageBonus frost` | `frost ×1` |
| `af_lightning` | 雷鸣 | damageType | W/G/X | 11 | M/R/E/Y | add/- | 75 | 36 | 是 | damage | `damageBonus lightning` | `shock ×1` |
| `af_holy` | 圣辉 | damageType | W/G/X | 11 | M/R/E/Y | add/- | 75 | 36 | 是 | damage | `damageBonus holy` | `holy ×1`, `heal ×1` |
| `af_dark` | 暗蚀 | damageType | W/G/X | 21 | R/E/Y | add/- | 60 | 44 | 是 | damage | `damageBonus dark` | `dark ×1` |
| `af_poison` | 猛毒 | damageType | W/G/X | 6 | M/R/E/Y | add/- | 80 | 34 | 是 | damage | `damageBonus poison` | `poison ×1` |
| `af_prismatic` | 万象 | damageType | X | 31 | E/Y | add/- | 30 | 70 | 是 | damage | `damageBonus all` | `element ×1` |

### 4.2 条件、触发与防护（16 条）

| affixId | 名称 | category | slots | minLv | quality | stack/exclusive | weight | gold | craft | profile | modifiers | tags |
| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- |
| `af_high_spirit` | 无伤斗志 | conditional | W/G/X | 1 | M/R/E/Y | add/- | 60 | 38 | 是 | conditional | `conditionalDamageBonus selfHpAtLeastBps=8000, all` | `healthy ×1` |
| `af_executioner` | 处决者 | conditional | W/G/X | 11 | R/E/Y | add/- | 55 | 44 | 是 | conditional | `conditionalDamageBonus targetHpAtMostBps=3000, all` | `execute ×1` |
| `af_last_stand` | 背水 | conditional | A/H/X | 11 | R/E/Y | add/- | 55 | 44 | 是 | conditional | `conditionalPercentStat selfHpAtMostBps=4000, defense` | `guard ×1` |
| `af_frontline_wall` | 前线壁垒 | conditional | H/A/B | 1 | M/R/E/Y | add/- | 70 | 35 | 是 | conditional | `conditionalPercentStat formationRow=front, defense` | `guard ×1`, `front ×1` |
| `af_backline_focus` | 后阵专注 | conditional | G/B/X | 1 | M/R/E/Y | add/- | 70 | 35 | 是 | conditional | `conditionalPercentStat formationRow=back, attack` | `focus ×1`, `back ×1` |
| `af_marked_prey` | 锁定猎物 | conditional | W/G/X | 11 | R/E/Y | add/- | 55 | 44 | 是 | conditional | `conditionalDamageBonus targetHasStatus=marked, all` | `mark ×1`, `chase ×1` |
| `af_bleed_edge` | 裂伤锋 | trigger | W | 1 | M/R/E/Y | unique/`basic_ailment` | 55 | 42 | 否 | trigger | `trigger tr_bleed_edge` | `bleed ×2` |
| `af_bulwark` | 厚重壁垒 | skillAmp | H/A/X | 1 | M/R/E/Y | add/- | 75 | 34 | 是 | damage | `shieldBonus` | `shield ×2` |
| `af_counterweight` | 反震配重 | trigger | A/G/X | 1 | R/E/Y | unique/`counter_trigger` | 50 | 48 | 否 | trigger | `trigger tr_counterweight` | `counter ×2`, `shield ×1` |
| `af_pursuit` | 血迹追猎 | conditional | W/G/B | 1 | M/R/E/Y | add/- | 65 | 40 | 是 | conditional | `conditionalDamageBonus targetHasStatus=bleed, physical` | `bleed ×1`, `chase ×2` |
| `af_searing_edge` | 灼热锋 | trigger | W | 1 | M/R/E/Y | unique/`basic_ailment` | 55 | 42 | 否 | trigger | `trigger tr_searing_edge` | `burn ×2`, `basicAttack ×1` |
| `af_venom_edge` | 淬毒锋 | trigger | W | 6 | M/R/E/Y | unique/`basic_ailment` | 55 | 42 | 否 | trigger | `trigger tr_venom_edge` | `poison ×2`, `basicAttack ×1` |
| `af_frostbite_edge` | 霜噬锋 | trigger | W | 11 | R/E/Y | unique/`basic_ailment` | 50 | 46 | 否 | trigger | `trigger tr_frostbite_edge` | `frost ×1`, `control ×1` |
| `af_storm_spark` | 雷火花 | trigger | W/G/X | 21 | R/E/Y | unique/`crit_resource` | 45 | 52 | 否 | trigger | `trigger tr_storm_spark` | `crit ×1`, `shock ×1` |
| `af_healing_echo` | 治愈回声 | trigger | W/X | 11 | R/E/Y | unique/`heal_follow` | 45 | 50 | 否 | trigger | `trigger tr_healing_echo` | `heal ×2`, `shield ×1` |
| `af_guardian_pulse` | 守护脉冲 | trigger | H/A/X | 21 | R/E/Y | unique/`shield_follow` | 40 | 55 | 否 | trigger | `trigger tr_guardian_pulse` | `shield ×1`, `counter ×1` |

`af_healing_echo` 的 allowedSlots 运行时展开为 `[weapon, accessory]`，并额外由装备基础校验限制 weaponType 为 staff/focus/relic；为此 EquipmentAffixDefinition 新增的武器过滤字段见第 8 节契约补充。

### 4.3 指定技能增幅与机制（8 条）

| affixId | 名称 | category | slots | minLv | quality | stack/exclusive | weight | gold | craft | profile | modifiers | tags |
| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- |
| `af_rending_mastery` | 裂伤精通 | skillAmp | W/X | 1 | M/R/E/Y | add/- | 45 | 45 | 否 | skill | `skillPower skill_wanderer_rending_slash` | `bleed ×1` |
| `af_fortress_mastery` | 堡垒精通 | skillAmp | H/A/X | 1 | M/R/E/Y | add/- | 45 | 45 | 否 | skill | `skillPower skill_guard_fortify` | `shield ×1` |
| `af_twinshot_mastery` | 双矢精通 | skillAmp | W/G/X | 6 | M/R/E/Y | add/- | 45 | 45 | 否 | skill | `skillPower skill_ranger_twin_shot` | `chase ×1` |
| `af_fireball_mastery` | 火球精通 | skillAmp | W/G/X | 1 | M/R/E/Y | add/- | 45 | 45 | 否 | skill | `skillPower skill_ember_fireball` | `burn ×1` |
| `af_ice_nova_mastery` | 冰环精通 | skillAmp | W/G/X | 11 | R/E/Y | add/- | 40 | 50 | 否 | skill | `skillPower skill_frost_ice_nova` | `frost ×1`, `control ×1` |
| `af_mend_mastery` | 愈合精通 | skillAmp | W/G/X | 1 | M/R/E/Y | add/- | 45 | 45 | 否 | skill | `skillPower skill_priest_mend` | `heal ×1` |
| `af_sweeping_form` | 横扫架势 | mechanic | W | 31 | E/Y | replace/`basic_shape` | 18 | 95 | 否 | mechanic | `replaceBasicSkill effect_sweeping_basic` | `basicAttack ×2`, `area ×1` |
| `af_elemental_recast` | 元素重铸 | mechanic | W | 31 | E/Y | replace/`basic_element` | 18 | 95 | 否 | mechanic | `replaceDamageElement physical→fire` | `basicAttack ×1`, `fire ×2` |

## 5. 8 个深渊装备词条

全部 `pool=abyss`、`allowedQualities=[abyss]`、`canBeCraftEmpowered=false`、不能重铸。

| affixId | 名称 | category | slots | minLv | stack/exclusive | weight | gold | profile | modifiers | tags |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- | --- |
| `af_abyss_twinstrike` | 深渊·双生打击 | trigger | W | 26 | unique/`basic_follow` | 25 | 180 | abyss_trigger | `trigger tr_abyss_twinstrike` | `basicAttack ×2`, `chase ×2` |
| `af_abyss_soulburn` | 深渊·噬魂火 | trigger | W/G/X | 26 | unique/`burn_consume` | 25 | 180 | abyss_trigger | `trigger tr_abyss_soulburn` | `burn ×2`, `dark ×2`, `detonate ×1` |
| `af_abyss_bloodmoon` | 深渊·血月 | trigger | A/G/X | 26 | unique/`lowhp_sustain` | 22 | 200 | abyss_trigger | `trigger tr_abyss_bloodmoon` | `bleed ×2`, `heal ×1` |
| `af_abyss_permafrost` | 深渊·永冻 | trigger | W/X | 26 | unique/`basic_ailment` | 22 | 200 | abyss_trigger | `trigger tr_abyss_permafrost` | `frost ×2`, `control ×2` |
| `af_abyss_stormcrown` | 深渊·雷冠 | trigger | H/G/X | 31 | unique/`crit_follow` | 20 | 220 | abyss_trigger | `trigger tr_abyss_stormcrown` | `crit ×2`, `shock ×2`, `chain ×1` |
| `af_abyss_sanctuary` | 深渊·圣域 | trigger | H/A/X | 26 | unique/`heal_follow` | 20 | 220 | abyss_trigger | `trigger tr_abyss_sanctuary` | `heal ×2`, `shield ×2` |
| `af_abyss_timefracture` | 深渊·时隙 | trigger | B/X | 26 | unique/`extra_turn` | 12 | 280 | `26:1～1` | `trigger tr_abyss_timefracture` | `speed ×2`, `ultimate ×1` |
| `af_abyss_kingbrand` | 深渊·王印 | damageType | X | 46 | max/- | 10 | 320 | abyss_damage | `finalDamageMultiplier` | `dark ×1`, `execute ×2` |

## 6. AffixTriggerDefinition 冻结表

### 6.1 目标继承规则

- `self` 永远指词条佩戴者。
- `singleEnemy` 优先指触发事件的原始敌对目标；原目标无效时该 effect 跳过，不自动改选。
- `singleAlly` 优先指原始友方治疗/护盾目标；原事件没有友方目标时指佩戴者。
- `allEnemies/allAllies` 以佩戴者阵营解析。
- 每个触发严格按 `game-design.md` 9.4：先检查 TriggerSpec，再检查 root/round/battle/全局 budget，最后才按 `chance` 抽一次；chance 失败会消费这一次 RNG，但不入队、不消费状态也不占 budget，条件或 budget 失败不消费 RNG。
- 表中 `affixRoll×10000` 精确表示 `{kind:'affixRoll',scaleBps:10000}`，最终 chanceBps=clamp(floor(effectiveRoll×10000/10000),0,10000)，即取该触发词条自身 raw roll；不按拥有者其他词条或同 ID 多实例合并概率。

### 6.2 普通触发

| triggerId | event / 条件 | chance | effects | budget root/round/battle |
| --- | --- | --- | --- | --- |
| `tr_bleed_edge` | afterDirectHit；skillKinds=[basic]；any hit | affixRoll×10000 | `singleEnemy:S(bleed,10000,1,3)` | 1/1/999 |
| `tr_counterweight` | onDirectDamageTaken；source has `status_shield` | affixRoll×10000 | `singleEnemy:D(physical,4500,1,true)` | 1/1/999 |
| `tr_searing_edge` | afterDirectHit；skillKinds=[basic] | affixRoll×10000 | `singleEnemy:S(burn,10000,1,3)` | 1/1/999 |
| `tr_venom_edge` | afterDirectHit；skillKinds=[basic] | affixRoll×10000 | `singleEnemy:S(poison,10000,1,3)` | 1/1/999 |
| `tr_frostbite_edge` | afterDirectHit；skillKinds=[basic] | affixRoll×10000 | `singleEnemy:S(slow,10000,1,2)` | 1/1/999 |
| `tr_storm_spark` | afterDirectHit；hitResult=critical | affixRoll×10000 | `self:ENERGY(8)` | 1/1/999 |
| `tr_healing_echo` | onHeal；skillKinds=[active,ultimate,effect] | affixRoll×10000 | `singleAlly:Q(attack,4000)` | 1/1/999 |
| `tr_guardian_pulse` | onGainShield | affixRoll×10000 | `allEnemies:D(physical,3000,1,false)` | 1/1/999 |

### 6.3 深渊触发

| triggerId | event / 条件 | chance | effects | budget root/round/battle |
| --- | --- | --- | --- | --- |
| `tr_abyss_twinstrike` | afterDirectHit；skillKinds=[basic] | affixRoll×10000 | `singleEnemy:D(physical,7000,1,true)` | 1/1/999 |
| `tr_abyss_soulburn` | afterDirectHit；target has burn | affixRoll×10000 | `singleEnemy:C(burn,3) + D(dark,10000,1,false)` | 1/1/999 |
| `tr_abyss_bloodmoon` | afterDirectHit；source HP≤4000 bps | affixRoll×10000 | `self:H(attack,2500,false)` | 1/1/999 |
| `tr_abyss_permafrost` | afterDirectHit；skillKinds=[basic] | affixRoll×10000 | `singleEnemy:S(freeze,10000,1,1)` | 1/1/999 |
| `tr_abyss_stormcrown` | afterDirectHit；hitResult=critical | affixRoll×10000 | `allEnemies:D(lightning,4500,1,false)` | 1/1/999 |
| `tr_abyss_sanctuary` | onHeal | affixRoll×10000 | `allAllies:Q(attack,5000)` | 1/1/999 |
| `tr_abyss_timefracture` | afterRootAction；skillKinds=[ultimate] | fixed 10000 | `self:grantExtraTurn` | 1/1/1 |

所有未列条件字段严格填：`requiredSkillKinds=[]`、`requiredHitResult=any`、两个 HP 门槛为 `null`、两个 required status 数组为空、`consumeTargetStatus=null`。表中“source/target has”写入相应 status ID 数组；`tr_abyss_soulburn` 的消耗由 effects 执行，不写 TriggerSpec.consumeTargetStatus，避免重复消费。

## 7. 词条值解析

1. flatStat：`effectiveRoll` 直接加到对应 StatBlock 字段。
2. damage/shield/skill/conditional：`effectiveRoll` 直接作为 basis point。
3. `finalDamageMultiplier`：最终乘区为 `10000 + effectiveRoll`；同角色多个 max 来源只取最大并展示抑制来源。
4. trigger：AffixTrigger chance 的 affixRoll 绑定读取该词条 `effectiveRoll`；表内 `affixRoll×10000` 精确展开为 `{kind:'affixRoll',scaleBps:10000}`。固定 chance 不读取 roll。
5. mechanism profile 的 roll 固定为 1，只用于满足实例统一字段，不参与数值公式。
6. 普通攻击机制顺序固定为：先按 `replaceBasicSkill` 把本次 USE_BASIC 的 effects 替换为 effect skill，再按 `replaceDamageElement` 修改替换后所有命中 from 的 DamageEffect；根行动 skillKind 仍为 basic，因此 `requiredSkillKinds=[basic]` 的词条仍可触发。
7. 装备 skillPower 与技能铭石 addPower 在进入 conditionalMultipliers 前加算；两类来源均展示，不修改静态 SkillDefinition。
8. `canBeCraftEmpowered=false` 的精确集合为：全部 category=`trigger|skillAmp|mechanic` 的普通词条和全部深渊词条；其余普通词条按表中“是”进入候选。内容校验断言表值与此集合一致。

## 8. 契约补充：武器类型过滤

为严格表达 `af_healing_echo` 等只适用于部分武器的词条，EquipmentAffixDefinition 增加必填字段：

```ts
allowedWeaponTypes: WeaponType[]
```

- 非 weapon 部位词条必须为 `[]`。
- allowedSlots 包含 weapon 时：空数组表示所有武器类型；非空表示只允许列出的类型。
- `af_healing_echo=[staff,focus,relic]`；`af_elemental_recast=[sword,hammer,bow]`；其余包含 weapon 的词条均为 `[]`。
- 禁止从词条名字或技能 owner 推断武器类型。

## 9. 数量与生成门禁

- `equipmentBases = 60`；每个 weaponType 恰好 5 件，其他五个 slot 各 6 件。
- `equipmentAffixes(pool=normal) = 40`；`pool=abyss = 8`。
- 普通词条各品质数量严格为 0/2/3/4/4，深渊词条另占 `abyssAffix`。
- 任何被冻结 drop/shop/fixed 表实际引用的 base/quality/itemLevel 组合，在抽取目标数量时必须有足够合法 normal pool；测试穷举 60 个底材的有效 itemLevel 与该等级可达品质。不可达反例（尤其 itemLevel<26 的 abyss）必须返回 `AFFIX_POOL_EMPTY`，不能为了让笛卡尔积通过而提前开放深渊池。
- 自用验证固定 20 个代表种子做 golden generation；同种子实例除注入 ID/时间外 roll、词条顺序、锻造特性完全一致。
