# zh-CN 本地化与结构化详情规格

## 文档状态

- 版本：LOC-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 首版语言：仅 `zh-CN`
- 规范性：所有内容 key、领域错误模板、核心门槛文案和对话必须按本文件生成；业务数值只来自结构化配置

## 1. 生成与校验规则

1. 运行时只读取扁平 `Record<string,string>`；缺 key、重复 key、空值、未知 `{token}` 都是 `INVALID_CONTENT`。不显示 raw key。
2. 内容构建器不得解析 Markdown；实施者按下列真源逐行转录到 `src/content/locales/zh-CN.ts`，`verify:content` 对生成 key 集和 SHA-256 做快照。
3. 名称 key 的值从以下冻结表的“名称/zh-CN”列逐行录入：

| key 集 | 精确数量 | 名称真源 |
| --- | ---: | --- |
| `character.<id>.name` | 6 | `game-design.md` 4.1 |
| `map.<id>.name` | 1 | 本文件 2.1；野外地图复用 floor key |
| `floor.<id>.name` | 10 | 本文件 2.1 |
| `npc.<id>.name` | 7 | 本文件 2.2 |
| `quest.<id>.name` | 1 | 本文件 2.2 |
| `skill.<id>.name` | 97 | `skills-table.md` 15 |
| `status.<id>.name` | 18 | `balance-tables.md` 3 |
| `equipment.<id>.name` | 60 | `equipment-tables.md` 2 |
| `equipment_affix.<id>.name` | 48 | `equipment-tables.md` 4/5 |
| `skill_affix.<id>.name` | 24 | `skill-affix-tables.md` 2/3 |
| `combo.<id>.name` | 18 | `combo-tables.md` 2 |
| `enemy.<id>.name`（普通/精英） | 25 | `balance-tables.md` 2.3 |
| `enemy.<id>.name`（Boss） | 10 | 本文件 2.1；ID 与面板核对 `balance-tables.md` 2.4 |
| `item.<id>.name` | 5 | `balance-tables.md` 5.5 |
| `encounter_modifier.<id>.name` | 8 | 本文件 2.3；ID 与规则核对 `world-content-tables.md` 6 |
| `abyss_echo.<id>.name` | 10 | 本文件 2.3；ID 与参数核对 `world-content-tables.md` 7 |

4. 结构化详情由 ViewModel 读取数值后格式化，不把一份可过期数值抄进自由文案。97 个 `skill.<id>.description` 的静态值统一为“具体效果与数值见下方详情。”；48 个 `equipment_affix.<id>.description` 统一为“实际数值、条件与叠加规则见下方详情。”；24 个 `skill_affix.<id>.description` 统一为“目标技能、实际数值与叠加规则见下方详情。”；18 个 `combo.<id>.description` 统一为“配方、触发条件、效果与次数限制见下方详情。”；8 个 `encounter_modifier.<id>.description` 统一为“本场修正的数值与持续轮次见下方详情。”；10 个 `abyss_echo.<id>.description` 统一为“挑战倍率、限制、目标与奖励见下方详情。”。这些 key 必须逐 ID 存在，不允许 UI 在缺 key 时临时补这句话。
5. 数值格式固定：BPS 属性显示一位百分数，仅在不能整除 10 时显示两位；例如 1500→15%、625→6.25%。闭区间写“6%～8.5%”；回合写“N 回合”；概率 10000 写“必定”而不是“100% 概率”。逐步舍入后的预览整数使用中文千分位。

## 2. 世界、层主与 NPC

### 2.1 地图与层主名称

| key | zh-CN |
| --- | --- |
| `map.map_town.name` | 灰炉镇 |
| `floor.floor_01.name` | 青风原野 |
| `floor.floor_02.name` | 孢子密林 |
| `floor.floor_03.name` | 废弃矿坑 |
| `floor.floor_04.name` | 迷雾沼泽 |
| `floor.floor_05.name` | 赤焰遗迹 |
| `floor.floor_06.name` | 深渊门廊 |
| `floor.floor_07.name` | 血色回廊 |
| `floor.floor_08.name` | 寒狱 |
| `floor.floor_09.name` | 无星虚空 |
| `floor.floor_10.name` | 深渊王座 |
| `enemy.boss_horned_king.name` | 角牙兽王 |
| `enemy.boss_brood_spider.name` | 毒巢蛛后 |
| `enemy.boss_iron_devourer.name` | 钢铁吞噬者 |
| `enemy.boss_bog_witch.name` | 沼泽女巫 |
| `enemy.boss_ember_guardian.name` | 余烬守卫 |
| `enemy.boss_abyss_butcher.name` | 深渊屠夫 |
| `enemy.boss_crimson_knight.name` | 猩红骑士 |
| `enemy.boss_pale_jailer.name` | 苍白狱卒 |
| `enemy.boss_thousand_eye.name` | 千眼观测者 |
| `enemy.boss_abyss_king.name` | 深渊之王 |

`map_floor_NN` 的 nameKey 固定复用对应 `floor.floor_NN.name`，不再创建第二套同值 key。

### 2.2 NPC、任务和对话

| key | zh-CN |
| --- | --- |
| `npc.npc_tavern_keeper.name` | 酒馆老板 |
| `npc.npc_blacksmith.name` | 铁匠 |
| `npc.npc_skill_mentor.name` | 技能导师 |
| `npc.npc_merchant.name` | 行商人 |
| `npc.npc_innkeeper.name` | 旅店老板 |
| `npc.npc_cartographer.name` | 地图学家 |
| `npc.npc_abyss_watcher.name` | 深渊守望者 |
| `dialogue.tavern_keeper.greeting` | 想走得更远，就先找对同行的人。 |
| `dialogue.blacksmith.greeting` | 好装备不是最亮的那件，是能把你的打法串起来的那件。 |
| `dialogue.skill_mentor.greeting` | 铭石会改变技能的形状。先想清楚你要完成哪条词链。 |
| `dialogue.merchant.greeting` | 每次远征前我都会换一批货，错过就等下次。 |
| `dialogue.innkeeper.greeting` | 歇一会儿吧。这里不收你的金币。 |
| `dialogue.cartographer.greeting` | 层主守着下一条路。先看清弱点，再决定怎么打。 |
| `dialogue.abyss_watcher.greeting` | 第五层之后，数值不够只会被深渊放大。带着完整构筑再来。 |
| `quest.quest_first_elite.name` | 初试锋芒 |
| `quest.quest_first_elite.description` | 击败青风原野的石皮野猪。 |
| `lock.none` | 无锁定条件 |
| `lock.abyss_watcher.floor_05` | 首次击败第五层层主后开放。 |

### 2.3 遭遇修正与深渊回响名称

| key | zh-CN |
| --- | --- |
| `encounter_modifier.modifier_assault.name` | 猛攻 |
| `encounter_modifier.modifier_swift.name` | 迅捷 |
| `encounter_modifier.modifier_bulwark.name` | 壁垒 |
| `encounter_modifier.modifier_mire.name` | 泥沼 |
| `encounter_modifier.modifier_abyss_execution.name` | 深渊处决 |
| `encounter_modifier.modifier_abyss_fortress.name` | 深渊坚城 |
| `encounter_modifier.modifier_abyss_pressure.name` | 深渊压力 |
| `encounter_modifier.modifier_abyss_suppression.name` | 深渊压制 |
| `abyss_echo.echo_f06_iron.name` | 铁血回响 |
| `abyss_echo.echo_f06_hunger.name` | 饥渴回响 |
| `abyss_echo.echo_f07_red_tide.name` | 赤潮回响 |
| `abyss_echo.echo_f07_blood_oath.name` | 血誓回响 |
| `abyss_echo.echo_f08_white_wall.name` | 白壁回响 |
| `abyss_echo.echo_f08_silent_prison.name` | 寂狱回响 |
| `abyss_echo.echo_f09_storm_eye.name` | 风眼回响 |
| `abyss_echo.echo_f09_rewrite.name` | 改写回响 |
| `abyss_echo.echo_f10_dark_throne.name` | 暗王座回响 |
| `abyss_echo.echo_f10_endless_king.name` | 无尽王回响 |

对应 18 个 `.description` key 按 1.4 的统一结构化短句逐 ID 建立；不能省略或把 ID 拆成中文。

## 3. 门槛、构筑与奖励核心文案

| key | zh-CN |
| --- | --- |
| `gate.tutorial` | 教学层：无需完整 Combo 也可首通 |
| `gate.currentTier` | 当层装备检查：升级装备并利用弱点 |
| `gate.breakthrough` | 构筑检查：需要深渊词条与有效 Combo |
| `battle.enrage.countdown` | 狂暴：{rounds} 轮 |
| `battle.enrage.pending` | 已到狂暴阈值，待层主行动 |
| `battle.enrage.active` | 层主狂暴：攻击 +50%（不可驱散） |
| `battle.intent.title` | 层主意图 |
| `battle.intent.next_action` | 下一次合法行动释放 |
| `battle.intent.delayed` | 已被控制延后 |
| `battle.intent.enrage_first` | 狂暴优先，意图保留 |
| `battle.intent.counter.guard` | 建议：防御 |
| `battle.intent.counter.shield` | 建议：护盾 |
| `battle.intent.counter.heal` | 建议：抬高生命 |
| `battle.intent.counter.cleanse` | 建议：预留净化 |
| `upgrade.breakthrough` | 突破升级 |
| `upgrade.outlier` | 异常高提升·待核对 |
| `upgrade.counter_jump` | 克制跃迁·仅对此目标 |
| `reward.stack_cap_conversion` | {itemName} 已达 9999：×{quantity} → {gold} 金币 |
| `diagnosis.output_gate` | 层主已进入狂暴。当前输出未跨过本层门槛。 |
| `diagnosis.survival_gate` | 狂暴前已有队员倒地。优先补充生存、净化或控制。 |
| `diagnosis.weakness_gate` | 弱点伤害不足总直接伤害的 20%。调整元素或技能形态。 |
| `diagnosis.retry_floor` | 重刷本层 |
| `diagnosis.go_blacksmith` | 前往铁匠 |
| `diagnosis.go_build` | 技能与 Combo |
| `reforge.lock_warning` | 确认后将永久锁定此词条槽。取消不会消耗材料，但锁定槽位不会改变。 |
| `skill_stone.focus_help` | 下一次新远征的第一枚精英铭石必定调谐给该角色。 |
| `expedition.full_help` | 完整探索 8 普通、2 精英、3 宝箱与层主。 |
| `expedition.short_help` | 短程刷取 3 普通、1 精英、1 宝箱；没有层主与回响次数。 |
| `expedition.boss_retry_help` | 直接重试尚未首通的层主，正常消耗生命和道具。 |
| `abyss_echo.charge_help` | 完整击败第 6～10 层层主可获得 1 次，上限 5。 |
| `abyss_echo.consume_warning` | 开始将消耗 1 次回响，战败不返还。 |

### 3.1 核心界面固定文案

| key | zh-CN |
| --- | --- |
| `app.title` | 词链深渊 |
| `title.new_game` | 新游戏 |
| `title.continue` | 继续游戏 |
| `title.settings` | 设置 |
| `title.overwrite_title` | 覆盖现有存档？ |
| `title.overwrite_body` | 此操作会永久覆盖当前存档，且无法撤销。 |
| `title.overwrite_action` | 覆盖并开始 |
| `system.rotate_device` | 请旋转设备至横屏 |
| `system.viewport_too_small` | 当前窗口过小，至少需要 568×320 |
| `system.loading` | 加载中… |
| `system.saving` | 保存中… |
| `system.audio_locked` | 点击屏幕后开启声音 |
| `system.retry_save` | 重试保存 |
| `system.view_reason` | 查看原因 |
| `system.saved` | 已保存 |
| `common.confirm` | 确认 |
| `common.cancel` | 取消 |
| `common.back` | 返回 |
| `common.close` | 关闭 |
| `common.retry` | 重试 |
| `common.return_title` | 返回标题 |
| `common.yes` | 是 |
| `common.no` | 否 |
| `common.none` | 无 |
| `common.locked` | 未解锁 |
| `common.equipped` | 已装备 |
| `common.new` | 新 |
| `common.level` | 等级 |
| `common.item_level` | 装等 |
| `common.gold` | 金币 |
| `common.quantity` | 数量 |
| `common.continue` | 继续 |
| `common.info` | 说明 |
| `common.loading` | 处理中… |
| `nav.party` | 队伍 |
| `nav.inventory` | 背包 |
| `nav.equipment` | 装备 |
| `nav.skills` | 技能 |
| `nav.skill_stones` | 技能铭石 |
| `nav.combos` | Combo |
| `nav.bestiary` | 图鉴 |
| `nav.floors` | 层数 |
| `nav.settings` | 设置 |
| `town.tavern` | 酒馆与编队 |
| `town.blacksmith` | 铁匠铺 |
| `town.skill_mentor` | 技能与铭石 |
| `town.merchant` | 商店 |
| `town.inn` | 旅店 |
| `town.cartographer` | 地图与图鉴 |
| `town.abyss_watcher` | 深渊说明 |
| `town.start_expedition` | 开始远征 |
| `town.rest` | 免费休整 |
| `town.no_rest_needed` | 无需休息 |
| `exploration.interact` | 交互 |
| `exploration.menu` | 菜单 |
| `exploration.open_chest` | 开启宝箱 |
| `exploration.chest_received` | 宝箱战利品已收入背包。 |
| `shop.buy` | 购买 |
| `shop.sell` | 出售 |
| `shop.sold` | 已售 |
| `shop.session_buyback_empty` | 本次运行会话暂无可回购物品。返回标题或刷新页面会清空回购记录。 |
| `battle.attack` | 普攻 |
| `battle.skill` | 技能 |
| `battle.ultimate` | 终极技 |
| `battle.defend` | 防御 |
| `battle.item` | 道具 |
| `battle.more` | 更多 |
| `battle.assist` | 辅助 |
| `battle.assist_on` | 重复指令：开 |
| `battle.assist_off` | 重复指令：关 |
| `battle.assist_fallback_basic` | 技能不可用，已改用普攻 |
| `battle.retreat` | 撤退 |
| `battle.select_target` | 选择目标 |
| `battle.round` | 当前轮次 |
| `battle.timeline` | 行动顺序 |
| `battle.details_log` | 战斗详情 |
| `battle.pause` | 暂停 |
| `battle.resume` | 继续 |
| `battle.skip_animation` | 跳过演出 |
| `battle.speed_1x` | ×1 |
| `battle.speed_2x` | ×2 |
| `battle.victory` | 战斗胜利 |
| `battle.defeat` | 远征失败 |
| `battle.echo_success` | 回响目标达成 |
| `battle.echo_failed` | 已击败层主，但挑战目标未达成 |
| `battle.echo_failed.MAX_ROUNDS` | 超过限定轮数 |
| `battle.echo_failed.MAX_KNOCKOUTS` | 倒地次数超过限制 |
| `battle.echo_failed.COMBO_REQUIRED` | 本场没有触发 Combo |
| `battle.retreat_confirm` | 撤退后本次遭遇不会被清除。确认撤退？ |
| `battle.event.critical` | 暴击 |
| `battle.event.overheal` | 溢出 |
| `battle.event.resisted` | 抵抗 |
| `battle.event.immune` | 免疫 |
| `battle.event.turn_skipped` | 跳过 |
| `battle.event.extra_turn` | 追加行动 |
| `inventory.sort` | 排序 |
| `inventory.filter` | 筛选 |
| `inventory.lock` | 锁定 |
| `inventory.unlock` | 解锁 |
| `inventory.equip` | 装备 |
| `inventory.unequip` | 卸下 |
| `inventory.use` | 使用 |
| `inventory.choose_target` | 选择使用目标 |
| `inventory.sell` | 出售 |
| `inventory.buyback` | 回购 |
| `inventory.disassemble` | 分解 |
| `inventory.overflow` | 溢出仓 |
| `inventory.empty` | 当前没有物品 |
| `inventory.go_cleanup` | 前往清理 |
| `inventory.go_disassemble` | 前往分解 |
| `upgrade.newly_gained` | 新获得 |
| `reforge.title` | 定向重铸 |
| `reforge.choose_slot` | 选择要永久锁定的词条槽 |
| `reforge.preview` | 预览候选 |
| `reforge.confirm_candidate` | 确认此候选 |
| `skill.upgrade` | 升级技能 |
| `skill.reset` | 免费重置 |
| `skill.reset_confirm` | 重置会返还全部已投入技能点，是否继续？ |
| `skill.equip_active` | 装配主动技能 |
| `skill_stone.focus` | 精英铭石专注角色 |
| `combo.active` | 已激活 |
| `combo.inactive` | 未激活 |
| `combo.reachable` | 可达成 |
| `combo.codex` | 图鉴 |
| `combo.newly_added` | 新增 Combo |
| `combo.will_be_lost` | 将失去 Combo |
| `combo.first_discovered` | 新词链已发现 |
| `floor.recommended_level` | 推荐等级 |
| `floor.recommended_item_level` | 推荐装等 |
| `floor.enrage_round` | 狂暴轮次 |
| `floor.enter` | 进入该层 |
| `floor.cleared` | 已首通 |
| `floor.enter_full` | 完整远征 |
| `floor.enter_short` | 短程刷取 |
| `floor.enter_boss_retry` | 直接重试层主 |
| `floor.duration_full` | 预计 18～25 分钟 |
| `floor.duration_short` | 预计 8～12 分钟 |
| `floor.duration_boss_retry` | 预计 2～5 分钟 |
| `abyss_echo.title` | 深渊回响 |
| `abyss_echo.charges` | 回响次数 {current}/5 |
| `abyss_echo.start` | 开始回响 |
| `abyss_echo.no_charge` | 回响次数不足 |
| `abyss_echo.go_full_expedition` | 前往完整深渊远征 |
| `abyss_echo.first_clear_reward` | 首通材料 |
| `abyss_echo.first_clear_claimed` | 首通材料已领取 |
| `abyss_echo.abyss_bonus` | 深渊升格加成 |
| `abyss_echo.item_limit` | 道具上限 |
| `abyss_echo.max_rounds` | 轮数目标 |
| `abyss_echo.max_knockouts` | 倒地上限 |
| `abyss_echo.combo_required` | 本场需触发任意 Combo |
| `reward.title` | 战利品 |
| `reward.claim` | 收入背包 |
| `reward.claim_all` | 全部领取 |
| `reward.overflow_notice` | 背包已满，未容纳实例将进入溢出仓。 |
| `diagnosis.title` | 卡点诊断 |
| `settings.quality` | 画质 |
| `settings.quality_battery` | 省电 |
| `settings.quality_standard` | 标准 |
| `settings.quality_high` | 高画质 |
| `settings.music` | 音乐 |
| `settings.sfx` | 音效 |
| `settings.battle_speed` | 战斗速度 |
| `settings.reduce_flashes` | 减少闪烁 |
| `settings.reduce_screen_shake` | 减少震动 |
| `settings.debug_fps` | 显示调试 FPS |
| `pause.resume` | 返回游戏 |
| `pause.return_town` | 回城 |
| `pause.return_town_confirm` | 回城会结束本次远征，是否继续？ |
| `pause.return_title` | 返回标题 |
| `title.start_game` | 开始游戏 |

### 3.2 结构化枚举中文键

下表中的 key 全部必须存在。详情 ViewModel 只能读取这些标签并与结构化数值组合；禁止显示英文枚举或从 ID 拆词：

| key | zh-CN | key | zh-CN |
| --- | --- | --- | --- |
| `role.fighter` | 战士 | `role.tank` | 坦克 |
| `role.ranger` | 游侠 | `role.mage` | 法师 |
| `role.support` | 辅助 | `weapon.sword` | 剑 |
| `weapon.hammer` | 战锤 | `weapon.bow` | 弓 |
| `weapon.staff` | 法杖 | `weapon.focus` | 法器 |
| `weapon.relic` | 圣遗物 | `slot.weapon` | 武器 |
| `slot.helmet` | 头盔 | `slot.armor` | 护甲 |
| `slot.gloves` | 手套 | `slot.boots` | 鞋子 |
| `slot.accessory` | 饰品 | `quality.common` | 普通 |
| `quality.magic` | 魔法 | `quality.rare` | 稀有 |
| `quality.epic` | 史诗 | `quality.abyss` | 深渊 |
| `craft.ordinary` | 普通锻造 | `craft.tempered` | 淬炼 |
| `craft.exalted` | 升华 | `skill_kind.basic` | 普通攻击 |
| `skill_kind.active` | 主动技能 | `skill_kind.ultimate` | 终极技能 |
| `skill_kind.passive` | 被动技能 | `skill_kind.effect` | 追加效果 |
| `element.physical` | 物理 | `element.fire` | 火焰 |
| `element.frost` | 冰霜 | `element.lightning` | 雷电 |
| `element.holy` | 神圣 | `element.dark` | 暗影 |
| `element.poison` | 毒素 | `element.true` | 真实 |
| `element.all` | 全部伤害 | `target.self` | 自身 |
| `target.singleAlly` | 单个友方 | `target.allAllies` | 全体友方 |
| `target.singleEnemy` | 单个敌方 | `target.allEnemies` | 全体敌方 |
| `target.randomEnemy` | 随机敌方 | `target.deadAlly` | 已倒下友方 |
| `stack_rule.add` | 全部加算 | `stack_rule.max` | 取最高值 |
| `stack_rule.unique` | 唯一生效 | `stack_rule.replace` | 机制替换 |
| `combo_scope.personal` | 个人 Combo | `combo_scope.party` | 队伍 Combo |
| `tag_source.any` | 任意来源 | `tag_source.innate` | 角色本源 |
| `tag_source.equipmentAffix` | 装备词条 | `tag_source.equippedSkill` | 已装备技能 |
| `tag_source.skillAffix` | 技能词条 | `trigger.beforeAction` | 行动前 |
| `trigger.afterDirectHit` | 直接命中后 | `trigger.afterRootAction` | 根行动后 |
| `trigger.onDirectDamageTaken` | 受到直接伤害时 | `trigger.onHeal` | 实际治疗时 |
| `trigger.onOverheal` | 产生过量治疗时 | `trigger.onGainShield` | 获得护盾时 |
| `trigger.onDefeatUnit` | 击倒单位时 | `affix_category.baseStat` | 基础属性 |
| `affix_category.damageType` | 元素增伤 | `affix_category.conditional` | 条件效果 |
| `affix_category.trigger` | 触发效果 | `affix_category.skillAmp` | 技能增幅 |
| `affix_category.mechanic` | 机制转换 | `skill_affix_kind.amplify` | 数值增幅 |
| `skill_affix_kind.repeat` | 追加段数 | `skill_affix_kind.followUp` | 追加技能 |
| `skill_affix_kind.morph` | 形态转换 | `skill_affix_kind.statusLink` | 状态联动 |
| `skill_affix_kind.resource` | 资源变化 | `item_category.consumable` | 消耗品 |
| `item_category.material` | 材料 | `status_polarity.buff` | 增益 |
| `status_polarity.debuff` | 减益 | `status_refresh.replaceDuration` | 刷新持续时间 |
| `status_refresh.independentStacks` | 独立叠层 | `status_timing.turnStart` | 回合开始 |
| `status_timing.afterAction` | 行动后 | `status_timing.turnEnd` | 回合结束 |
| `status_timing.none` | 无自动触发 | `formation.front` | 前排 |
| `formation.back` | 后排 | `stat.maxHp` | 最大生命 |
| `stat.attack` | 攻击 | `stat.defense` | 防御 |
| `stat.speed` | 速度 | `stat.critRateBps` | 暴击率 |
| `stat.critDamageBps` | 暴击伤害 | `stat.effectHitBps` | 效果命中 |
| `stat.effectResistBps` | 效果抵抗 | `hit_result.any` | 任意命中 |
| `hit_result.critical` | 暴击 | `hit_result.nonCritical` | 非暴击 |
| `battle_outcome.ongoing` | 战斗中 | `battle_outcome.victory` | 胜利 |
| `battle_outcome.defeat` | 战败 | `battle_outcome.retreat` | 撤退 |
| `action_kind.skip` | 控制跳过 |  |  |

### 3.2.1 Combo 标签中文键

`ComboTagId` 固定为以下 34 个值；界面按 `tag.<tagId>` 精确查表，不得从英文 ID 拆词或回退显示 raw tagId：

| key | zh-CN | key | zh-CN |
| --- | --- | --- | --- |
| `tag.area` | 范围 | `tag.back` | 后排 |
| `tag.basicAttack` | 普通攻击 | `tag.bleed` | 流血 |
| `tag.burn` | 灼烧 | `tag.chain` | 连锁 |
| `tag.chase` | 追击 | `tag.cleanse` | 净化 |
| `tag.control` | 控制 | `tag.counter` | 反击 |
| `tag.crit` | 暴击 | `tag.dark` | 暗影 |
| `tag.detonate` | 引爆 | `tag.element` | 元素 |
| `tag.execute` | 处决 | `tag.fire` | 火焰 |
| `tag.focus` | 专注 | `tag.front` | 前排 |
| `tag.frost` | 冰霜 | `tag.guard` | 守势 |
| `tag.heal` | 治疗 | `tag.healthy` | 高生命 |
| `tag.holy` | 神圣 | `tag.mark` | 标记 |
| `tag.might` | 威能 | `tag.physical` | 物理 |
| `tag.poison` | 中毒 | `tag.shield` | 护盾 |
| `tag.shock` | 感电 | `tag.speed` | 迅捷 |
| `tag.support` | 辅助 | `tag.taunt` | 嘲讽 |
| `tag.ultimate` | 终极 | `tag.vitality` | 生命 |

### 3.2.2 技能族与技能词条目标中文键

`SkillFamilyId` 固定为以下 25 个值；技能词条目标的三种判别分支分别显示已知技能名、`skill_family.<familyId>` 或“全部技能”，不显示内部 familyId：

| key | zh-CN |
| --- | --- |
| `skill_family.area` | 范围技能 |
| `skill_family.basic` | 普通攻击 |
| `skill_family.bleed` | 流血技能 |
| `skill_family.bow` | 弓术技能 |
| `skill_family.cleanse` | 净化技能 |
| `skill_family.control` | 控制技能 |
| `skill_family.detonate` | 引爆技能 |
| `skill_family.execute` | 处决技能 |
| `skill_family.fire` | 火焰技能 |
| `skill_family.frost` | 冰霜技能 |
| `skill_family.guard` | 守势技能 |
| `skill_family.hammer` | 战锤技能 |
| `skill_family.heal` | 治疗技能 |
| `skill_family.holy` | 神圣技能 |
| `skill_family.mark` | 标记技能 |
| `skill_family.multiHit` | 多段技能 |
| `skill_family.passive` | 被动技能 |
| `skill_family.projectile` | 投射技能 |
| `skill_family.revive` | 复苏技能 |
| `skill_family.shield` | 护盾技能 |
| `skill_family.speed` | 速度技能 |
| `skill_family.support` | 辅助技能 |
| `skill_family.sword` | 剑术技能 |
| `skill_family.taunt` | 嘲讽技能 |
| `skill_family.ultimate` | 终极技能 |

| key | zh-CN |
| --- | --- |
| `skill_affix_target.skill` | 指定技能 |
| `skill_affix_target.family` | 技能族 |
| `skill_affix_target.allSkills` | 全部技能 |

### 3.3 条件与效果类型中文键

这些标签后可由结构化组件追加数值、状态名或技能名；标签自身不含 token：

| key | zh-CN | key | zh-CN |
| --- | --- | --- | --- |
| `condition.selfHpAtMostBps` | 自身生命不高于 | `condition.selfHpAtLeastBps` | 自身生命不低于 |
| `condition.targetHpAtMostBps` | 目标生命不高于 | `condition.targetHpAtLeastBps` | 目标生命不低于 |
| `condition.selfHasStatus` | 自身具有状态 | `condition.targetHasStatus` | 目标具有状态 |
| `condition.formationRow` | 所在阵型 | `condition.roundAtMost` | 回合数不高于 |
| `condition.targetStatusStacksAtLeast` | 目标状态层数至少 | `modifier.flatStat` | 固定属性 |
| `modifier.percentStat` | 百分比属性 | `modifier.damageBonus` | 伤害提高 |
| `modifier.healingBonus` | 治疗提高 | `modifier.shieldBonus` | 护盾提高 |
| `modifier.finalDamageMultiplier` | 最终伤害提高 | `modifier.conditionalDamageBonus` | 条件伤害提高 |
| `modifier.conditionalPercentStat` | 条件属性提高 | `modifier.trigger` | 触发效果 |
| `modifier.skillPower` | 指定技能威力提高 | `modifier.replaceBasicSkill` | 替换普通攻击 |
| `modifier.replaceDamageElement` | 转换伤害属性 | `skill_affix_operation.addPowerBps` | 技能威力提高 |
| `skill_affix_operation.addRepeatChanceBps` | 追加段数概率 | `skill_affix_operation.addFollowUp` | 追加技能 |
| `skill_affix_operation.replaceTargetRule` | 改变目标范围 | `skill_affix_operation.replaceDamageElement` | 改变伤害属性 |
| `skill_affix_operation.statusLink` | 状态联动追加技能 | `skill_affix_operation.overhealToShield` | 过量治疗转护盾 |
| `skill_affix_operation.changeEnergy` | 改变能量获得 | `skill_affix_operation.changeCooldown` | 改变冷却 |
| `effect.damage` | 造成伤害 | `effect.heal` | 恢复生命 |
| `effect.shield` | 获得护盾 | `effect.applyStatus` | 施加状态 |
| `effect.dispel` | 驱散状态 | `effect.consumeStatus` | 消耗状态 |
| `effect.changeEnergy` | 改变能量 | `effect.changeCooldown` | 改变冷却 |
| `effect.summon` | 召唤单位 | `effect.grantExtraTurn` | 获得追加行动 |
| `effect.revive` | 复苏友方 | `effect.periodicDamage` | 周期伤害 |

### 3.4 模板 token 精确集合

下表列出所有允许插值的模板；未列 key 的 token 集必须为空。整数必须是已校验的非负十进制整数；`itemName` 必须先由已知 ItemId 查本地化名称，不直接插入 ID。

| key | token 集与类型 |
| --- | --- |
| `battle.enrage.countdown` | `rounds:uint` |
| `abyss_echo.charges` | `current:uint` |
| `reward.stack_cap_conversion` | `itemName:localizedString`,`quantity:uint`,`gold:uint` |
| `error.INSUFFICIENT_GOLD` | `required:uint`,`owned:uint` |
| `error.FLOOR_LOCKED` | `floorNumber:uint` |
| `error.SKILL_ON_COOLDOWN` | `remainingTurns:uint` |
| `error.INSUFFICIENT_ENERGY` | `required:uint`,`owned:uint` |
| `error.INVENTORY_FULL` | `requiredSlots:uint`,`availableSlots:uint` |
| `error.OVERFLOW_NOT_EMPTY` | `count:uint` |
| `error.SKILL_LOCKED_BY_LEVEL` | `unlockLevel:uint` |
| `error.INSUFFICIENT_SKILL_POINTS` | `required:uint`,`owned:uint` |
| `error.STACKABLE_CAP_EXCEEDED` | `requested:uint` |

## 4. DomainErrorV1 玩家文案

key 固定为 `error.<DomainErrorCode>`。reason 分支使用 `error.<CODE>.<reason>`；未列分支不得退回通用异常 message。

| key | zh-CN |
| --- | --- |
| `error.INVALID_CONTENT` | 游戏内容校验失败，请返回标题后重试。 |
| `error.UNSUPPORTED_SAVE_VERSION` | 此存档版本暂不受支持，原存档已保留。 |
| `error.STALE_REVISION` | 数据已经变化，请重新打开页面并确认。 |
| `error.STALE_BATTLE_REVISION` | 战斗状态已经推进，请重新选择行动。 |
| `error.INVALID_PARTY.EMPTY` | 队伍至少需要一名角色。 |
| `error.INVALID_PARTY.PROTAGONIST_REQUIRED` | 主角必须在出战队伍中。 |
| `error.INVALID_PARTY.DUPLICATE_CHARACTER` | 同一角色不能重复出战。 |
| `error.INVALID_PARTY.UNKNOWN_CHARACTER` | 队伍中存在无效角色。 |
| `error.INVALID_PARTY.NOT_RECRUITED` | 队伍中存在尚未招募的角色。 |
| `error.INVALID_PARTY.ALL_DEFEATED` | 队伍中没有可行动的角色，请先前往旅店休整。 |
| `error.CHARACTER_ALREADY_RECRUITED` | 该角色已经加入。 |
| `error.RECRUITMENT_LOCKED` | 尚未满足该角色的招募条件。 |
| `error.INSUFFICIENT_GOLD` | 金币不足：需要 {required}，当前 {owned}。 |
| `error.NOT_IN_TOWN` | 该操作只能在城镇进行。 |
| `error.NPC_LOCKED` | 该功能尚未开放。 |
| `error.FLOOR_LOCKED` | 第 {floorNumber} 层尚未解锁。 |
| `error.EXPEDITION_MODE_LOCKED.FLOOR_NOT_CLEARED` | 该楼层尚未首通，不能开始短程刷取。 |
| `error.EXPEDITION_MODE_LOCKED.BOSS_NOT_CONTACTED` | 尚未在普通远征中接触该层主。 |
| `error.EXPEDITION_MODE_LOCKED.BOSS_ALREADY_CLEARED` | 该层主已首通，请通过完整远征重复挑战。 |
| `error.ABYSS_ECHO_LOCKED.STORY_NOT_COMPLETED` | 首次击败第十层层主后开放深渊回响。 |
| `error.ABYSS_ECHO_LOCKED.NO_CHARGE` | 回响次数不足，请完成一次深渊完整远征。 |
| `error.INVALID_BATTLE_PHASE` | 当前战斗阶段不能执行该操作。 |
| `error.NOT_CURRENT_ACTOR` | 还没有轮到该单位行动。 |
| `error.SKILL_LOCKED` | 该技能当前未装备或不可使用。 |
| `error.SKILL_ON_COOLDOWN` | 技能还需等待 {remainingTurns} 个本人回合。 |
| `error.INSUFFICIENT_ENERGY` | 能量不足：需要 {required}，当前 {owned}。 |
| `error.INVALID_TARGET.COUNT` | 目标数量不正确。 |
| `error.INVALID_TARGET.DEAD` | 该目标已经倒下。 |
| `error.INVALID_TARGET.FULL_HP` | 该目标生命已满。 |
| `error.INVALID_TARGET.WRONG_FACTION` | 该技能不能选择此阵营。 |
| `error.INVALID_TARGET.UNKNOWN` | 目标不存在。 |
| `error.INVALID_TARGET.TAUNTED` | 你必须先攻击嘲讽来源。 |
| `error.FORMATION_BLOCKED` | 前排尚未击破，无法选择该后排目标。 |
| `error.RETREAT_FORBIDDEN` | 层主战无法撤退。 |
| `error.INVENTORY_FULL` | 空间不足：还需要 {requiredSlots} 格，可用 {availableSlots} 格。 |
| `error.OVERFLOW_NOT_EMPTY` | 溢出仓仍有 {count} 件物品，请先清理。 |
| `error.ITEM_NOT_OWNED` | 物品已不存在，请刷新列表。 |
| `error.ITEM_USE_FORBIDDEN.NOT_IN_EXPEDITION` | 该物品只能在野外远征中使用。 |
| `error.ITEM_USE_FORBIDDEN.BATTLE_ACTIVE` | 战斗中请从道具指令使用物品。 |
| `error.ITEM_USE_FORBIDDEN.WRONG_CONTEXT` | 该物品不能在当前场景使用。 |
| `error.ITEM_USE_FORBIDDEN.ECHO_LIMIT` | 本次回响的道具使用次数已达上限。 |
| `error.ITEM_LOCKED` | 已锁定物品不能执行此操作。 |
| `error.ITEM_EQUIPPED` | 已装备物品不能执行此操作。 |
| `error.WEAPON_NOT_ALLOWED` | 该角色不能使用这种武器。 |
| `error.SKILL_LOCKED_BY_LEVEL` | 角色达到 {unlockLevel} 级后解锁该技能。 |
| `error.SKILL_LEVEL_MAX` | 该技能已经达到最高等级。 |
| `error.INSUFFICIENT_SKILL_POINTS` | 技能点不足：需要 {required}，当前 {owned}。 |
| `error.AFFIX_POOL_EMPTY` | 当前物品没有合法词条候选，请返回标题并报告此问题。 |
| `error.AFFIX_CONFLICT` | 当前构筑存在互斥词条，请先卸下冲突来源。 |
| `error.AFFIX_NOT_REFORGEABLE.ABYSS_SLOT` | 深渊词条不能重铸。 |
| `error.AFFIX_NOT_REFORGEABLE.WRONG_LOCKED_INDEX` | 该物品只能继续重铸已锁定的词条槽。 |
| `error.AFFIX_NOT_REFORGEABLE.LOCKED_ITEM` | 已锁定物品不能重铸。 |
| `error.AFFIX_NOT_REFORGEABLE.EQUIPPED_ITEM` | 已装备物品不能重铸。 |
| `error.REFORGE_PREVIEW_STALE` | 重铸结果已经变化，请重新预览。 |
| `error.SHOP_OFFER_UNAVAILABLE` | 该商品已经售出或库存已刷新。 |
| `error.BUYBACK_UNAVAILABLE` | 该回购物品已不在最近 10 条记录中。 |
| `error.STACKABLE_CAP_EXCEEDED` | 持有上限为 9999，无法再获得 {requested} 个。 |
| `error.REWARD_ALREADY_CLAIMED` | 这份奖励已经领取。 |
| `error.SAVE_FAILED` | 保存失败，进度暂存于当前页面。请勿关闭。 |
| `error.ASSET_LOAD_FAILED` | 资源连续尝试加载 3 次仍失败。可重试或返回标题。 |

## 5. 结构化技能与词条详情顺序

- 技能：名称 → 等级/解锁 → 目标/前排限制 → 威力/段数/元素 → 状态概率/层数/持续 → 冷却/能量 → 铭石修改 → Combo 影响 → 来源说明。
- 装备：底材主属性 → 品质/ilv/锻造特性 → 普通词条原始 roll/有效值 → 深渊词条 → 适用角色 → 标签 → Combo 变化 → 价格。每个 `ModifierSpec.kind` 精确读取 `modifier.<kind>`；stat/element/condition/skill/status/trigger 的从属值继续查其本地化键或内容名，不显示枚举。
- 铭石：调谐角色 → 品质/ilv → 每条目标范围 → operation 数值 → stackRule/冲突规则 → 当前是否激活 → 标签/Combo。目标按 skill/family/allSkills 分支格式化；每个 `SkillAffixOperation.kind` 精确读取 `skill_affix_operation.<kind>`；exclusiveGroup 只用于领域冲突判断，不显示其内部 ID，冲突时显示本地化来源名称。
- Combo：scope → requirements（来源逐项）→ trigger → effects → 每根/每轮/每场预算 → 当前来源树 → 当前是否激活。
- 所有来源按内容数组原顺序显示；合计行在来源之后。被 max/unique/replace 抑制的来源不得隐藏，使用“未采用：取最高值”或“冲突：需要卸下”固定说明。
- `DamageCondition.sourceHpAtMostBps/sourceHasStatus` 分别复用 `condition.selfHpAtMostBps/selfHasStatus`；`targetStatusStacksAtLeast` 使用其同名 key。`Element|'all'` 一律查 `element.<value>`。任何未命中上述封闭路由的 kind/enum 都是 `INVALID_CONTENT`，不能把字段名转成人话兜底。

## 6. 校验门禁

1. `verify:content` 断言上表 348 个内容名称 key、206 个结构化说明/任务描述 key、7 个对话 key、2 个 lock key、34 个 `tag.*` key、25 个 `skill_family.*` key、3 个技能词条目标分支、12 个 modifier、9 个 skill-affix operation key、41 个 DomainErrorCode 展开的 60 个终端分支模板和本文件核心 UI key 均存在且非空；野外 MapDefinition 复用 floor key，因此不重复计数。任何玩家可见短字也必须来自 key，不允许在 BattleAnimator/View 中写中文常量。
2. 模板 token 集必须与本文件完全一致；翻译文件多出业务 token 或缺 token 均失败。
3. 用最大长度值在 568×320 截图：长名称省略时详情仍能显示全名；错误模板允许最多两行，不覆盖主操作。
4. 自动遍历 97 技能、48 装备词条、24 技能词条与 18 Combo，结构化格式化不得出现 `undefined`、raw ID、NaN、未替换 token 或英文枚举。
