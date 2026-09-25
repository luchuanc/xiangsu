# 像素资源、动画与音频契约

## 文档状态

- 版本：ASSET-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 适用范围：占位资源、正式资源、Pixi Assets manifest、动画时间线与音频清单
- 规范性：逻辑资源 ID、bundle 所属、帧尺寸、clip 和校验规则必须按本文件实现；允许替换物理文件，不允许静默改变逻辑契约

## 1. 总则

1. 内容只引用逻辑资源 ID；`AssetCatalog` 将逻辑 ID 显式映射到 bundle、URL、类型和元数据。运行时不得从中文名、路径或相邻 ID 猜测资源。
2. 占位阶段允许多个逻辑 ID 显式指向同一物理 PNG/WebP/OGG 文件，但每个逻辑 ID 都必须在 manifest 中逐项存在。正式候选构建不得在资源缺失时回退到“通用缺图”。
3. 所有位图采用整数像素、透明边界至少 1px、`scaleMode='nearest'`、无 mipmap；图集任一边不超过 2048px。PNG 用于需要透明且像素边缘敏感的图，WebP 仅用于不破坏像素边缘的静态背景。
4. 首版音频只接受 OGG Vorbis 与 MP3 双源；选择顺序固定为先用 `canPlayType` 检查 oggSrc、再检查 mp3Src，取首个返回 `probably` 或 `maybe` 的源。AssetService 在 bundle load 中 fetch 该源并交 AudioService.decode/register；fetch/decode 走同一组最多 3 次尝试。两种源都不可解码、文件缺失或 decode 失败均为资源错误；音频尚未被用户手势解锁只影响播放，不影响预取/解码，也不算加载失败。
5. `verify:assets` 在构建前检查 ID 精确集合、重复逻辑 ID、bundle 归属、文件存在、图像尺寸/帧整除、clip 完整性、图集边长、音频双源和来源登记。物理 URL 显式复用合法；逻辑 ID 重复非法。失败返回非零退出码。
6. 每个物理文件登记 `{sourceKind:'generated'|'original'|'licensed', sourceNote:string, licenseId:string}`；`licenseId` 不得为空。候选构建禁止 `unknown`、网页热链和无许可来源。

## 2. 资源清单类型

```ts
export interface AssetManifestV1 {
  schemaVersion: 1
  contentVersion: 'content-1.2.0'
  bundles: AssetBundleDefinitionV1[]
  assets: AssetEntryV1[]
  animations: AnimationDefinitionV1[]
}

export interface AssetBundleDefinitionV1 {
  id: string
  dependsOn: string[]
  assetIds: string[]
}

export type AssetSourceRecord = {
  sourceKind: 'generated' | 'original' | 'licensed'
  sourceNote: string
  licenseId: string
}

export type AssetEntryV1 =
  | {
      kind: 'fieldActorSheet'
      id: string
      bundleId: string
      src: string
      frameWidth: 24
      frameHeight: 32
      columns: 10
      rows: 4
      clips: FieldActorClipsV1
      source: AssetSourceRecord
    }
  | {
      kind: 'battleActorSheet'
      id: string
      bundleId: string
      src: string
      frameWidth: 48 | 64
      frameHeight: 48 | 64
      columns: 27
      rows: 1
      clips: BattleActorClipsV1
      source: AssetSourceRecord
    }
  | {
      kind: 'singleFrame'
      id: string
      bundleId: string
      src: string
      width: 16 | 24 | 32
      height: 16 | 24 | 32
      source: AssetSourceRecord
    }
  | {
      kind: 'mapTileset'
      id: string
      bundleId: string
      src: string
      tileSize: 16
      columns: number
      rows: number
      source: AssetSourceRecord
    }
  | {
      kind: 'atlas'
      id: string
      bundleId: string
      imageSrc: string
      dataSrc: string
      requiredFrames: string[]
      source: AssetSourceRecord
    }
  | {
      kind: 'bitmapFont'
      id: string
      bundleId: string
      descriptorSrc: string
      textureSrc: string
      glyphHeight: 16
      source: AssetSourceRecord
    }
  | {
      kind: 'image'
      id: string
      bundleId: string
      src: string
      width: number
      height: number
      source: AssetSourceRecord
    }
  | {
      kind: 'audio'
      id: string
      bundleId: string
      oggSrc: string
      mp3Src: string
      channel: 'music' | 'sfx'
      loop: boolean
      baseGainBps: number
      source: AssetSourceRecord
    }

export interface FieldActorClipsV1 {
  down: FieldDirectionClipsV1<0>
  left: FieldDirectionClipsV1<1>
  right: FieldDirectionClipsV1<2>
  up: FieldDirectionClipsV1<3>
}

export interface FieldDirectionClipsV1<Row extends 0 | 1 | 2 | 3> {
  row: Row
  idle: { startColumn: 0; frameCount: 4; fps: 6 }
  walk: { startColumn: 4; frameCount: 6; fps: 10 }
}

export interface BattleActorClipsV1 {
  idle: { startFrame: 0; frameCount: 4; fps: 6; loop: true }
  attack: { startFrame: 4; frameCount: 6; fps: 12; loop: false; impactFrame: 8 }
  skill: { startFrame: 10; frameCount: 8; fps: 12; loop: false; impactFrame: 15 }
  hit: { startFrame: 18; frameCount: 3; fps: 12; loop: false }
  down: { startFrame: 21; frameCount: 6; fps: 10; loop: false }
}
```

字段对象必须 strict；所有尺寸/行列为正整数，`baseGainBps` 为 0～10000 的整数。`validationMode` 是 AssetCatalog 构造参数，不写入 manifest。field sheet 固定为 `240×128`：四行依次 down/left/right/up，每行前 4 帧 idle、后 6 帧 walk。普通单位 battle sheet 固定 `1296×48`，Boss 固定 `1728×64`。`impactFrame` 是整张 sheet 的零基绝对帧序号，伤害事件在该画面帧显示；跳过动画仍立即显示已结算事件。

## 3. 逻辑 ID 精确集合

### 3.1 内容派生资源，共 302 个

| 来源 | 数量 | ID 规则 | kind | bundle |
| --- | ---: | --- | --- | --- |
| 6 个角色探索 | 6 | `sprite_field_<CharacterId>` | fieldActorSheet | `player_common` |
| 6 个角色战斗 | 6 | `sprite_battle_<CharacterId>` | battleActorSheet 48 | `player_common` |
| 50 个遭遇探索 | 50 | `sprite_field_<EncounterId>` | fieldActorSheet | 对应 `floor_NN` |
| 7 个 NPC 探索 | 7 | `sprite_<NpcId>` | fieldActorSheet | `town` |
| 25 普通/精英+10 Boss 战斗 | 35 | `sprite_battle_<EnemyId>` | battleActorSheet；Boss 64，其余 48 | 敌人首次出现的 `floor_NN`；跨层引用仍只加载该唯一 owner bundle 及声明依赖 |
| 60 个装备底材 | 60 | `sprite_<EquipmentBaseId>` | singleFrame 24 | `core_ui` |
| 18 个状态 | 18 | `icon_<StatusId>` | singleFrame 16 | `core_ui` |
| 18 个 Combo | 18 | `icon_<ComboId>` | singleFrame 24 | `core_ui` |
| 5 个堆叠物 | 5 | `icon_<ItemId>` | singleFrame 24 | `core_ui` |
| 97 个技能动画 | 97 | `anim_<SkillId>` | 逻辑 AnimationDefinition，见 4.2 | `battle_common` |

“敌人首次出现层”按 `world-content-tables.md` 的 Floor 顺序及每层 Encounter、Boss summon 闭包的配置数组顺序扫描；同一 EnemyId 后续再出现不创建第二份资源。content-1.2.0 的敌人均只在同一层闭包内使用；若未来跨层复用，必须先提升版本并把资源移入明确 common bundle，禁止让一个 floor bundle 依赖另一个 floor bundle。

### 3.2 地图与系统资源

| ID | 数量 | kind / 规格 | bundle |
| --- | ---: | --- | --- |
| `tileset_map_town`、`tileset_map_floor_01`…`tileset_map_floor_10` | 11 | mapTileset，16×16 tile，列/行显式登记 | town / 对应 floor |
| `atlas_core_ui` | 1 | UI nine-slice/按钮/品质框图集，frame 名见 4.1 | core_ui |
| `atlas_battle_fx` | 1 | 战斗像素特效图集，frame 名见 4.1 | battle_common |
| `font_pixel_zh_cn` | 1 | BitmapFont；必须覆盖本地化快照实际使用字符集 | boot |
| `image_boot_logo` | 1 | image，固定 320×96 | boot |
| `image_boot_background` | 1 | image，固定 640×360 | boot |

地图层索引规则固定：`groundLayer` 的 0 是 tileset 第 0 格且为有效地面；`decorBackLayer`/`decorFrontLayer` 的 0 表示空，正整数 `n` 读取 tileset 第 `n-1` 格。负数、越界索引或 ground 空洞均为 `INVALID_CONTENT`。

### 3.3 固定音频，共 22 个逻辑 ID

| ID | bundle | channel | loop | baseGainBps | 使用场景 |
| --- | --- | --- | --- | ---: | --- |
| `bgm_title` | boot | music | true | 6500 | 标题 |
| `bgm_town` | town | music | true | 6000 | 城镇 |
| `bgm_field` | player_common | music | true | 6000 | 第 1～5 层 |
| `bgm_abyss` | abyss_common | music | true | 6000 | 第 6～10 层探索 |
| `bgm_boss` | battle_common | music | true | 7000 | 第 1～9 层 Boss |
| `bgm_final_boss` | battle_common | music | true | 7500 | 第 10 层 Boss |
| `sfx_ui_confirm` | core_ui | sfx | false | 7000 | 确认 |
| `sfx_ui_cancel` | core_ui | sfx | false | 6500 | 返回/取消 |
| `sfx_ui_error` | core_ui | sfx | false | 7000 | 阻断错误 |
| `sfx_step` | player_common | sfx | false | 3500 | 探索脚步 |
| `sfx_encounter` | player_common | sfx | false | 8000 | 接触转战斗 |
| `sfx_attack` | battle_common | sfx | false | 7000 | 近战直接伤害动作（含普通攻击与技能） |
| `sfx_skill` | battle_common | sfx | false | 7500 | 投射/范围直接伤害动作（含普通攻击与技能） |
| `sfx_hit` | battle_common | sfx | false | 7000 | 命中 |
| `sfx_heal` | battle_common | sfx | false | 7000 | 治疗/护盾 |
| `sfx_status` | battle_common | sfx | false | 6500 | 状态生效 |
| `sfx_combo_unlock` | core_ui | sfx | false | 8500 | 首次发现 Combo |
| `sfx_combo_trigger` | battle_common | sfx | false | 8000 | 每场首次触发 Combo |
| `sfx_loot_rare` | battle_common | sfx | false | 8000 | rare/epic 掉落 |
| `sfx_loot_abyss` | battle_common | sfx | false | 9000 | abyss 掉落 |
| `sfx_boss_phase` | battle_common | sfx | false | 8500 | Boss 转阶段/狂暴 |
| `sfx_battle_result` | battle_common | sfx | false | 8000 | 胜利或战败；画面用事件类型区分 |

### 3.4 16 个 bundle 与依赖

| bundleId | dependsOn（原数组顺序） |
| --- | --- |
| `boot` | `[]` |
| `core_ui` | `[boot]` |
| `player_common` | `[core_ui]` |
| `town` | `[player_common]` |
| `battle_common` | `[player_common]` |
| `abyss_common` | `[player_common]` |
| `floor_01`～`floor_05` | 各自 `[player_common]` |
| `floor_06`～`floor_10` | 各自 `[player_common,abyss_common]` |

bundle ID 集恰好为上表 16 个；依赖图必须无环。每个 AssetEntry 恰好属于一个 owner bundle，并在该 bundle.assetIds 恰好出现一次；每个 AnimationDefinition 归 `battle_common`，不写入 assetIds。URL 相同不代表共享引用计数，实际纹理缓存键使用物理 URL；卸载仅在所有逻辑 alias 所属已加载 bundle 引用均归零后执行。

## 4. 图集帧与技能动画

### 4.1 `atlas_core_ui` 必需 frame

固定 frame 名：`panel_9s`、`button_normal_9s`、`button_pressed_9s`、`button_disabled_9s`、`slot_empty`、`slot_locked`、`quality_common`、`quality_magic`、`quality_rare`、`quality_epic`、`quality_abyss`、`cursor_target`、`marker_interact`、`marker_alert`、`marker_boss`、`marker_elite`、`object_chest_closed`、`object_portal_floor`、`object_portal_return`、`icon_gold`、`icon_energy`、`icon_hp`、`icon_attack`、`icon_defense`、`icon_speed`、`icon_critical`、`icon_close`、`icon_back`、`icon_menu`、`icon_warning`。nine-slice 的 left/top/right/bottom 固定为 4px。三个 `object_*` frame 为 24×32、脚底中心锚点 `(0.5,1)`；marker frame 为 16×16，不参与碰撞。

`atlas_battle_fx` 固定 frame 名：`fx_slash_00`～`fx_slash_05`、`fx_projectile_physical`、`fx_projectile_fire`、`fx_projectile_frost`、`fx_projectile_lightning`、`fx_projectile_holy`、`fx_projectile_dark`、`fx_projectile_poison`、`fx_projectile_true`、`fx_area_00`～`fx_area_07`、`fx_heal_00`～`fx_heal_05`、`fx_shield_00`～`fx_shield_05`、`fx_status_00`～`fx_status_03`、`fx_summon_00`～`fx_summon_07`。所有 frame 固定 32×32，播放时按 preset 选择对应序列；单帧 projectile 只做整数坐标补间。

### 4.2 97 个 `AnimationDefinitionV1`

每个 SkillDefinition.animationId 必须恰好对应一条定义；占位期可以共用 preset，但逻辑定义不得缺失：

```ts
export interface AnimationDefinitionV1 {
  id: string
  bundleId: 'battle_common'
  presetId: 'melee' | 'projectile' | 'area' | 'heal' | 'shield' | 'status' | 'summon' | 'passive'
  element: 'physical' | 'fire' | 'frost' | 'lightning' | 'holy' | 'dark' | 'poison' | 'true'
  durationMs: 0 | 300 | 450 | 600
  screenShake: 'none' | 'light' | 'heavy'
  sfxId: 'sfx_attack' | 'sfx_skill' | 'sfx_heal' | 'sfx_status' | null
}
```

`id` 固定为 `anim_<SkillId>`，`bundleId` 固定为 `battle_common`。其余五个字段由下表自上而下选择第一条匹配；“首个效果”始终指 `effects` 原数组索引 0，不重排数组：

| 条件 | presetId | element | durationMs | screenShake | sfxId |
| --- | --- | --- | ---: | --- | --- |
| `effects=[]` 且 kind=`passive` 或 `effect` | passive | physical | 0 | none | `null` |
| 首个效果为 heal/revive | heal | holy | 450 | none | `sfx_heal` |
| 首个效果为 shield | shield | holy | 450 | none | `sfx_heal` |
| 首个效果为 applyStatus/dispel/consumeStatus/changeEnergy/changeCooldown/grantExtraTurn | status | physical | 300 | none | `sfx_status` |
| 首个效果为 summon | summon | physical | 600 | heavy | `sfx_status` |
| 首个效果为 damage 且 targetRule=`allEnemies` | area | effect.element | 600 | heavy | `sfx_skill` |
| 首个效果为 damage、targetRule≠`allEnemies` 且 `requiresFrontAccess=true` | melee | effect.element | 300 | light | `sfx_attack` |
| 首个效果为 damage、targetRule≠`allEnemies` 且 `requiresFrontAccess=false` | projectile | effect.element | 450 | light | `sfx_skill` |

`effects=[]` 仅允许 kind=`passive` 或 `effect`；其他 kind 为空、非空 effects 的首项无法命中上表、damage 缺少显式 element 或 `requiresFrontAccess` 均是内容错误，禁止默认猜值。`presetId=passive && durationMs=0` 不创建动作 clip；若 BattleAnimator 收到引用该定义的领域事件，就在消费该事件的同一帧同步标记表现完成，不入动画队列；`sfxId=null` 时不得调用音频服务。当前六条角色被动不可成为 BattleCommand，领域测试必须断言 `ACTION_STARTED.visualSkillId` 不会引用它们。技能词条调用的 effect Skill 按自身 AnimationDefinition 播放；多段伤害不重复播放根技能 clip，只按领域事件生成命中特效。该规则仅生成表现元数据，不改变业务效果。

content-1.2.0 中命中空 effects 分支的必须恰好是 6 条角色被动：`skill_wanderer_instinct`、`skill_guard_unyielding`、`skill_ranger_eagle_eye`、`skill_ember_kindling`、`skill_frost_clarity`、`skill_priest_benediction`；因此 97 条 AnimationDefinition 中恰好 6 条 `sfxId=null`、91 条非空。集合或数量变化必须先提升 content/ASSET 版本，不能由实现自行吸收。

### 4.3 内联派生效果表现

Combo、装备触发、状态周期、不调用 effect SkillDefinition 的技能词条和道具效果直接携带 `EffectSpec`，不为它们创建伪技能或额外 AnimationDefinition。派生 `BattleDomainEventV1.visualSkillId` 非空时必须播放该技能的 AnimationDefinition；只有 `visualSkillId=null && effect!=null` 且（`triggerSource!=null` 或 `rootActionDefinitionId` 是 ContentCatalog 中存在的 ItemId）时，BattleAnimator 才可调用下列纯函数分类器，禁止根据中文名、affixId 或 comboId 猜表现。根技能 effect 事件因无 triggerSource 且其 root 定义是 SkillId，不调用本分类器；动作已由 `ACTION_STARTED` 播放：

按表格自上而下选择第一条匹配；状态周期优先于普通 damage targetRule 分类：

| EffectSpec / 来源 | presetId | element | durationMs | screenShake | sfxId |
| --- | --- | --- | ---: | --- | --- |
| damage 且 `triggerSource.kind='status'` | status | effect.element | 300 | none | `sfx_status` |
| damage，targetRule=`allEnemies` | area | effect.element | 600 | heavy | `sfx_skill` |
| damage，其他 targetRule 且 element=`physical` | melee | physical | 300 | light | `sfx_attack` |
| damage，其他 targetRule 且 element≠`physical` | projectile | effect.element | 450 | light | `sfx_skill` |
| heal/revive | heal | holy | 450 | none | `sfx_heal` |
| shield | shield | holy | 450 | none | `sfx_heal` |
| summon | summon | physical | 600 | heavy | `sfx_status` |
| applyStatus/dispel/consumeStatus/changeEnergy/changeCooldown/grantExtraTurn | status | physical | 300 | none | `sfx_status` |

分类器返回无 `id`/`bundleId` 且音效必定非空的类型：

```ts
export type InlineEffectVisualV1 = Omit<
  Pick<AnimationDefinitionV1, 'presetId' | 'element' | 'durationMs' | 'screenShake' | 'sfxId'>,
  'sfxId'
> & {
  sfxId: Exclude<AnimationDefinitionV1['sfxId'], null>
}
```

同一个 PendingBattleEvent 只播放一次 preset，hitCount 和多 target 只生成命中帧与数字，不重复动作前摇。Combo 每场首次触发的 `sfx_combo_trigger` 与 700ms 横幅是独立提示，不能替代本表 effect 音效；reduced/×2/跳过仍沿用 4.2 的变换规则。

`reducedScreenShake=true` 时把 heavy/light 统一变为 none；`reducedFlashes=true` 时移除全屏白闪和高亮闪烁。两个开关独立生效，均不改变 durationMs、事件顺序、文字、品质框和音效。×2 战斗速度把 durationMs 向下除以 2；规则结算和 RNG 不读取该值。

### 4.4 音频触发、去重与跳过

AnimationDefinition 与 InlineEffectVisual 的非空 `sfxId` 在对应 preset 开始时播放恰好一次；`null` 不调用 AudioService。其余 12 个非动作 SFX 与全部 16 个 SFX 的唯一调用点如下。表中“去重键”只存在于 View/Audio 调度层，不写入存档或领域快照：

| sfxId | 唯一触发点 | 去重/折叠规则 | 任务归属 |
| --- | --- | --- | --- |
| `sfx_ui_confirm` | 启用的主操作、确认、页签或选择控件接受一次 pointer/keyboard 激活 | 每次输入事件一次；领域随后失败可再播 error | RPG-005 提供通用绑定，各页面接入 |
| `sfx_ui_cancel` | 返回、关闭或取消控件接受一次激活 | 每次输入事件一次 | RPG-005/各页面 |
| `sfx_ui_error` | 用户操作被禁用原因或 DomainError 阻断且实际显示本地化错误 | 同一输入事件最多一次；后台校验日志不播放 | RPG-005/各页面 |
| `sfx_step` | 探索中玩家实际位移累计每跨过 24 逻辑像素 | 使用 `expeditionId:mapId:stepOrdinal`；停止/碰撞不累计，换图重置余数 | RPG-018 |
| `sfx_encounter` | EncounterTransitionService 的建战事务成功、attach 战斗 Scene 之前 | `battleId` 一次；prepare/保存失败不播放 | RPG-018 |
| `sfx_attack` | AnimationDefinition/InlineEffectVisual 的 melee preset 开始 | 对应领域 eventId/动画调用一次 | RPG-020 |
| `sfx_skill` | AnimationDefinition/InlineEffectVisual 的 projectile/area preset 开始 | 对应领域 eventId/动画调用一次 | RPG-020 |
| `sfx_heal` | AnimationDefinition/InlineEffectVisual 的 heal/shield preset 开始 | 对应领域 eventId/动画调用一次 | RPG-020 |
| `sfx_status` | AnimationDefinition/InlineEffectVisual 的 status/summon preset 开始 | 对应领域 eventId/动画调用一次 | RPG-020 |
| `sfx_hit` | 一组非零 `damageKind='direct'` 的 DAMAGE_RESOLVED 到达 impact 时 | 连续且 `rootActionId+triggerSource+effectIndex+hitIndex` 相同的多目标事件只播一次；多段按 hitIndex 各一次；全零和 periodic 不播 | RPG-020 |
| `sfx_combo_unlock` | 每张首次发现 Combo 的 900ms 卡片开始 | `comboId` 一次；以已保存 discoveredComboIds 为真源 | RPG-021 |
| `sfx_combo_trigger` | 本场某 Combo 第一条 COMBO_TRIGGERED 横幅开始 | `battleId:comboId` 一次；同根/后续触发静音但仍更新日志 | RPG-020 |
| `sfx_loot_rare` | rare 或 epic 装备/铭石关键奖励卡开始揭示 | `transactionId:instanceId` 一次；common/magic/堆叠物不播 | RPG-020 |
| `sfx_loot_abyss` | abyss 装备/铭石关键奖励卡开始揭示 | `transactionId:instanceId` 一次 | RPG-020 |
| `sfx_boss_phase` | STATUS_CHANGED 首次 applied `status_boss_phase_2`、`status_boss_phase_3` 或 `status_boss_enrage` | `battleId:statusId` 一次；刷新/叠层/移除不播 | RPG-020 |
| `sfx_battle_result` | BATTLE_FINISHED 投影胜利、战败或撤退结果 | `battleId` 一次 | RPG-020 |

同一 Damage 分组要求事件在 `events.sequence` 中连续，`triggerSource` 按判别联合全部字段深比较；组内只要一个事件的 `shieldDamage+hpDamage>0` 就在该组首个 impact 播一次 hit。BattleAnimator 点击跳过时丢弃所有尚未开始的动作/hit/status/Combo SFX，不补播音频队列；若跳过区间包含 BATTLE_FINISHED，仅在最终状态投影后播放一次 `sfx_battle_result`。已开始的短音效不强制截断。×2 只压缩调度时间，不增减调用次数；reducedFlashes/reducedScreenShake 不改音频。

用户手势尚未解锁 AudioContext 时，SFX 直接丢弃且解锁后不补播；解锁时只启动当前 Scene 指定的 BGM。页面 hidden 时 suspend，恢复后不追赶 SFX。music 有效 gain 固定为 `baseGainBps/10000 × userMusicVolume/100 × sceneMusicGainBps/10000`；sfx 有效 gain 固定为 `baseGainBps/10000 × userSfxVolume/100`。同一 BGM 只把 sceneMusicGainBps 在 200ms 内线性 ramp；BGM ID 改变时旧/新轨也做 200ms 线性交叉淡化。AudioContext 未解锁时直接从目标 gain 开始，不回放淡化过程。

## 5. Bundle 依赖与场景映射

| 场景 | 必需 bundle | 音乐 |
| --- | --- | --- |
| Boot/标题 | `boot`,`core_ui` | `bgm_title` |
| 城镇 | `boot`,`core_ui`,`player_common`,`town` | `bgm_town` |
| 第 1～5 层探索 | 常驻三包 + `floor_NN` | `bgm_field` |
| 第 6～9 层探索 | 常驻三包 + `abyss_common`,`floor_NN` | `bgm_abyss` |
| 第 10 层探索 | 常驻三包 + `abyss_common`,`floor_10` | `bgm_abyss` |
| 普通/精英战斗 | 当前探索包 + `battle_common` | 保持当前探索 BGM，`sceneMusicGainBps=4000` |
| 第 1～9 层 Boss | 当前探索包 + `battle_common` | `bgm_boss` |
| 第 10 层 Boss | 当前探索包 + `battle_common` | `bgm_final_boss` |
| Boss 重试 | 常驻三包 + 对应 floor/abyss owner + `battle_common` | 按对应 Boss 层使用 `bgm_boss`/`bgm_final_boss` |
| 深渊回响 | 常驻三包 + `abyss_common` + 对应 floor owner + `battle_common` | 第 6～9 层 `bgm_boss`，第 10 层 `bgm_final_boss` |

“常驻三包”指 `boot`,`core_ui`,`player_common`。离开标题进入新游戏/继续游戏时加载 `player_common`；返回标题时可卸载。floor 对首次出现于其他 floor 的敌人资源，通过 manifest 的 `dependsOn` 指向 owner bundle；资源引用计数归零前不得卸载 owner。

1.2 的 Boss 意图、远征模式和深渊回响不新增逻辑资源 ID：意图卡使用 BitmapText、现有状态/元素色和 Graphics 几何标识，不声称存在技能图标；回响卡复用对应 Boss battle sheet，开始战斗时按上表加载 owner bundle。若未来加入独立意图/回响图标，必须先提升 ASSET/contentVersion 和本节计数。

## 6. 占位资源与正式替换门禁

1. RPG-022 的占位集至少覆盖垂直切片所引用的全部逻辑 ID；可使用程序生成的纯色像素轮廓，sourceKind=generated、licenseId=`project-original-placeholder`。
2. 占位图必须用不同轮廓/颜色区分玩家、NPC、普通、精英、Boss、物品品质和交互标记；不能所有对象都是同一方块，否则视觉/E2E 无法识别。
3. RPG-024/025 随内容批次补齐对应逻辑 ID。`validationMode=batch` 只检查该累计批次集合；候选构建 `final` 检查 302 个内容派生 ID、11 个地图 tileset、5 个系统图形/字体资源和 22 个音频 ID 的完整集合。
4. 替换正式资源只能修改 manifest 的物理 URL/source 登记或同规格文件内容；若需改尺寸、clip、ID 或 bundle，必须提升 ASSET/contentVersion 并重新确认。
5. `font_pixel_zh_cn` 缺少实际字符时 `verify:assets` 输出缺失码点并失败；开发模式可用系统字体显示诊断，但候选构建不能因此通过。

## 7. 验证门禁

1. 以 568×320 和 844×390 截图验证：逻辑坐标与布局边界取整、CSS contain 可小数缩放、nearest 采样下无半像素纹理模糊、无图集边缘渗色、帧切换不抖锚点；不得以强制整数倍缩放牺牲冻结的最小可用视口。
2. final 模式自动遍历 63 个 fieldActorSheet、41 个 battleActorSheet、101 个 singleFrame 图标/装备资源、11 个 tileset、5 个系统图形/字体资源、97 个动画定义和 22 个音频 ID；即 `assets.length=243`、`animations.length=97`、逻辑 ID 总数 340。不得出现缺 ID、额外 ID、重复逻辑 ID或错误 bundle。
3. 63=6 角色+50 遭遇+7 NPC；41=6 角色+35 敌人；101=60 装备+18 状态+18 Combo+5 物品。系统图形资源与 core UI frame 另行校验，不混入以上计数。
4. 每个动画在 ×1、×2、跳过和减少闪烁模式各执行一次；额外断言六条指定角色被动唯一派生为 `passive/physical/0/none/null`，其余 91 条音效非空，零时长不入队且不调用音频；同一固定 battle trace 的最终规则状态必须完全一致。
5. 首次手势前、手势解锁后、后台/恢复、音乐/音效音量 0/100 各验证一次；逐个覆盖 16 个 SFX 路由、direct 多目标/多段去重、跳过不回放与 BGM 200ms 切换。音频状态不能阻塞输入、重复领域事件或篡改用户音量。
