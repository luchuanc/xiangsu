# 世界、NPC 与遭遇冻结表

## 文档状态

- 版本：WORLD-1.2
- 状态：CONFIRMED（随 REQ-1.2 冻结）
- 规范性：本文件冻结 10 层、11 张地图的玩法拓扑、7 个 NPC、7 段基础对话、1 个任务、5 条招募、1 个商店、50 组遭遇、8 个遭遇修正和 10 个深渊回响
- 美术可替换部分：ground/decor 的逐格视觉 tile 可由内容任务在不改变 2.4 碰撞蓝图的前提下绘制；不得改变 collision、锚点、对象 ID、数量或业务引用

## 1. FloorDefinition 冻结表

| floorId | floorNumber | mapId | bossEncounterId | assetBundleId | itemLevel | 推荐 Boss Lv | 推荐 ilv | 狂暴回合 | gate | isAbyss | firstClearRewardTableId |
| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `floor_01` | 1 | `map_floor_01` | `encounter_floor_01_boss` | `floor_01` | 1～5 | 4 | 3 | 12 | tutorial | false | `drop_floor_01_first_clear` |
| `floor_02` | 2 | `map_floor_02` | `encounter_floor_02_boss` | `floor_02` | 6～10 | 8 | 8 | 11 | currentTier | false | `drop_floor_02_first_clear` |
| `floor_03` | 3 | `map_floor_03` | `encounter_floor_03_boss` | `floor_03` | 11～15 | 12 | 13 | 12 | currentTier | false | `drop_floor_03_first_clear` |
| `floor_04` | 4 | `map_floor_04` | `encounter_floor_04_boss` | `floor_04` | 16～20 | 16 | 18 | 14 | currentTier | false | `drop_floor_04_first_clear` |
| `floor_05` | 5 | `map_floor_05` | `encounter_floor_05_boss` | `floor_05` | 21～25 | 21 | 23 | 11 | currentTier | false | `drop_floor_05_first_clear` |
| `floor_06` | 6 | `map_floor_06` | `encounter_floor_06_boss` | `floor_06` | 26～30 | 25 | 28 | 12 | currentTier | true | `drop_floor_06_first_clear` |
| `floor_07` | 7 | `map_floor_07` | `encounter_floor_07_boss` | `floor_07` | 31～35 | 31 | 33 | 13 | currentTier | true | `drop_floor_07_first_clear` |
| `floor_08` | 8 | `map_floor_08` | `encounter_floor_08_boss` | `floor_08` | 36～40 | 37 | 38 | 14 | currentTier | true | `drop_floor_08_first_clear` |
| `floor_09` | 9 | `map_floor_09` | `encounter_floor_09_boss` | `floor_09` | 41～45 | 43 | 43 | 11 | currentTier | true | `drop_floor_09_first_clear` |
| `floor_10` | 10 | `map_floor_10` | `encounter_floor_10_boss` | `floor_10` | 46～50 | 50 | 48 | 14 | breakthrough | true | `drop_floor_10_first_clear` |

每个 itemLevel 区间严格展开为 minItemLevel/maxItemLevel；推荐列依次展开为 `recommendedBossLevel`、`recommendedItemLevel`、`bossEnrageRound`、`bossGateType`。每行 `nameKey=floor.<floorId>.name`，例如 `floor_01→floor.floor_01.name`；floorNumber 唯一且连续；mapId、bossEncounterId、assetBundleId 与 firstClearRewardTableId 必须存在。

每行还必须完整保存两组字段：

- `bossPhaseThresholdBps`：`floor_01`～`floor_09` 均为 `[5000]`，`floor_10` 为 `[7000,3500]`；严格降序、每项 1～9999，并与 SKILL-1.2 的阶段 AI 条件逐项相等。
- `shortRouteObjectIds`：对两位楼层号 `NN` 恰好展开为 `[obj_fNN_n01,obj_fNN_n02,obj_fNN_n03,obj_fNN_e01,obj_fNN_chest01]`；顺序固定，必须引用本层 3 个 normal、1 个 elite、1 个 chest。运行时不从 suffix 猜路由。

## 2. MapDefinition 尺寸与固定锚点

### 2.1 城镇

- mapId=`map_town`，nameKey=`map.map_town.name`，widthTiles=80，heightTiles=60，tileSize=16，assetBundleId=`town`，spawnPoint=`{x:640,y:800}`。
- 固定 8 个 objects，全部坐标为逻辑像素：

| objectId | kind/reference | position | 其他字段 |
| --- | --- | --- | --- |
| `obj_town_tavern` | npc:`npc_tavern_keeper` | 320,320 | blocking=true |
| `obj_town_blacksmith` | npc:`npc_blacksmith` | 512,320 | blocking=true |
| `obj_town_skill_mentor` | npc:`npc_skill_mentor` | 704,320 | blocking=true |
| `obj_town_merchant` | npc:`npc_merchant` | 896,320 | blocking=true |
| `obj_town_innkeeper` | npc:`npc_innkeeper` | 416,576 | blocking=true |
| `obj_town_cartographer` | npc:`npc_cartographer` | 704,576 | blocking=true |
| `obj_town_abyss_watcher` | npc:`npc_abyss_watcher` | 992,576 | blocking=true |
| `obj_town_floor_portal` | portal:`openFloorSelect` | 640,128 | frameId=`object_portal_floor` |

最终 ContentRoot 的 `map_town.objects` 必须是表内 8 个对象。RPG-022 的未发布垂直切片构建只物化前 5 个 NPC object 加 floor portal，共 6 个；RPG-024 在同一内容录入任务中替换为最终 8 个。`visibleByContentBatch` 不是合法字段，批次条件不得进入运行时 MapDefinition，也不得出现在 RPG-026 候选构建。

### 2.2 十张野外地图

所有野外图 widthTiles=96、heightTiles=64、tileSize=16，spawnPoint=`{x:96,y:896}`。`map_floor_NN.nameKey` 必须逐行写为对应 `floor_NN` 的 FloorDefinition.nameKey（即 `floor.floor_NN.name`），不是在 UI 拼接。每张图固定 15 个 objects：8 个普通遭遇、2 个精英遭遇、3 个宝箱、1 个 Boss、1 个回城 portal。

构建期以 floorNumber 的两位十进制 `NN` 和下表展开 objectId/reference；最终 MapDefinition 保存完整字符串，不在运行时解析模板。

| suffix | kind/reference | position | 行为/掉落 |
| --- | --- | --- | --- |
| `obj_fNN_n01` | encounter normal_a | 256,800 | patrol |
| `obj_fNN_n02` | encounter normal_b | 480,864 | wander |
| `obj_fNN_n03` | encounter normal_c | 736,736 | stationary |
| `obj_fNN_n04` | encounter normal_a | 1024,832 | patrol |
| `obj_fNN_n05` | encounter normal_b | 1248,704 | wander |
| `obj_fNN_n06` | encounter normal_c | 352,512 | stationary |
| `obj_fNN_n07` | encounter normal_a | 800,480 | patrol |
| `obj_fNN_n08` | encounter normal_b | 1184,448 | wander |
| `obj_fNN_e01` | encounter elite | 576,288 | stationary |
| `obj_fNN_e02` | encounter elite | 1120,256 | stationary |
| `obj_fNN_chest01` | chest | 192,320 | `drop_floor_NN_chest`；frameId=`object_chest_closed` |
| `obj_fNN_chest02` | chest | 768,160 | `drop_floor_NN_chest`；frameId=`object_chest_closed` |
| `obj_fNN_chest03` | chest | 1344,352 | `drop_floor_NN_chest`；frameId=`object_chest_closed` |
| `obj_fNN_boss` | encounter boss | 1408,128 | stationary |
| `obj_fNN_return` | portal:`returnTown` | 64,928 | frameId=`object_portal_return` |

EncounterBehavior 精确展开：

- patrol：patrolPoints=`[{x:spawnX-32,y:spawnY},{x:spawnX+32,y:spawnY}]`，wanderRadius=0，detectionRadius=80，leashRadius=160，moveSpeed=36。
- wander：patrolPoints=[]，wanderRadius=64，detectionRadius=80，leashRadius=160，moveSpeed=36。
- 普通 stationary：patrolPoints=[]，wanderRadius=0，detectionRadius=64，leashRadius=160，moveSpeed=36。
- elite stationary：patrolPoints=[]，wanderRadius=0，detectionRadius=96，leashRadius=192，moveSpeed=32。
- boss stationary：patrolPoints=[]，wanderRadius=0，detectionRadius=0，leashRadius=0，moveSpeed=0；玩家主动接触固定 Boss 精灵才触发。

以上数值之外没有隐藏 behavior 字段。所有 encounter 的 position 是 `12×8` 脚底 AABB 中心；普通/精英触发体可追击但不阻挡玩家，Boss 固定不动。预警/追击/脱战、30/18/60 固定步、row-major 游荡候选、同帧 objectId 裁决与保护递减顺序只按 `game-design.md` 3.3。城镇唯一 portal 必须为 openFloorSelect；十张野外图各自唯一 portal 必须为 returnTown，首版不配置地图直连 portal。

### 2.3 地图逐格生产门禁

1. 四个 layer 长度必须等于 widthTiles×heightTiles；tile index 只来自该 bundle 的 tileset manifest。
2. spawn、portal、全部遭遇和宝箱锚点落在 walkable tile；NPC 脚底 tile 的 blocking 由 object 负责，collisionLayer 不重复封死相邻交互位。
3. 用 4 邻接 BFS 从 spawn 验证 return portal、3 宝箱、2 elite 和 Boss 相邻接触位全部可达；Boss 接触位至少有 2 个可达格。
4. 主路径最窄处至少 2 tiles；任何需要 12×8 脚底盒通过的转角不得只在对角相接。
5. 地图主题、tile 美术和分支形状允许各层不同，但不得移动本节业务锚点；如正式美术必须移动，先提升 WORLD/contentVersion 并重新确认。
6. RPG-002 提供一个仅用于单元/E2E 的 `openFieldFixture`：外圈一格 collision=1、内部 collision=0、ground 全填测试 tileset 的 index 0、decor 全填 0；正式 town/floor bundle 禁止引用该夹具。这样领域、相机和流程开发不等待美术，而候选构建仍必须使用各层手工 layer。
7. 每张正式野外图必须包含从 spawn 到 Boss 的一条 2 格宽主路、至少 2 条通向宝箱的支路和至少 1 条把精英放在绕行路线上的分叉；BFS 只验证可达，人工截图再验证不是一张无障碍空场。

### 2.4 冻结碰撞蓝图与构建算法

玩法碰撞不再交给实现者现场设计。内容构建脚本必须按本节生成 `collisionLayer`；生成结果进入 canonical JSON/SHA-256。视觉 tile 可以替换，但不得反向改变该数组。

#### 城镇

城镇先把 80×60 全部设为 walkable=0，再把最外一圈设为 collision=1。随后把以下闭区间矩形设为 collision=1；矩形格式为 `[minTileX,minTileY,maxTileX,maxTileY]`，按列出顺序写入：

`[5,5,15,13]`、`[18,5,28,13]`、`[31,5,41,13]`、`[44,5,54,13]`、`[57,5,69,13]`、`[5,25,18,33]`、`[31,25,48,33]`、`[61,25,74,33]`、`[8,43,24,52]`、`[55,43,71,52]`。

最后以 spawn、portal 和 7 个 NPC 的脚底 tile 为中心清出 3×3 walkable 方块；清除优先级高于矩形，但低于最外圈。所有 NPC 仍由 object 自身 blocking，周围至少 8 个交互格可站立。城镇 `groundLayer` 的可开工占位规则为：walkable 填 tileset index 0、collision 填 index 1；两个 decor 层全 0。正式美术可替换 ground/decor，但 collision hash 不变。

#### 十张野外图

把 96×64 全部设为 collision=1，并保持最外一圈为 1。使用下列节点缩写，坐标为上一节像素坐标除以 16：`S=spawn`、`R=return`、`N1..N8=normal 01..08`、`E1..E2=elite 01..02`、`C1..C3=chest 01..03`、`B=boss`。

对每个节点先清出以节点为中心、tile 半径 2 的 5×5 walkable 房间。随后按该层表格中的 `main → branchA → branchB → return` 顺序展开相邻节点为边；每条边以原表出现顺序得到零基 `edgeIndex`。若 `(floorNumber + edgeIndex) % 2 == 0`，先走 X 再走 Y；否则先走 Y 再走 X。中心线经过的每个 tile 连同上下左右一格全部清为 walkable，形成 3 tile 宽曼哈顿走廊。最后重新把最外一圈写回 1。不得额外开洞或封路。

| floor | main path | branchA（含绕路精英） | branchB（第二宝箱支路） | return |
| ---: | --- | --- | --- | --- |
| 1 | `S-N1-N2-N3-N4-N5-N8-E2-B` | `N1-C1-N6-E1-C2-N7-N3` | `N5-C3-N8` | `S-R` |
| 2 | `S-N2-N3-N4-N5-N8-E2-B` | `N2-N1-C1-N6-E1-N7-C2-N3` | `N5-C3-B` | `S-R` |
| 3 | `S-N1-N2-N3-N7-N4-N5-N8-E2-B` | `N1-N6-C1-E1-C2-N7` | `N8-C3-B` | `S-R` |
| 4 | `S-N2-N3-N4-N7-N5-N8-E2-B` | `N2-N1-C1-N6-E1-C2-N7` | `N5-C3-B` | `S-R` |
| 5 | `S-N1-N2-N3-N7-N4-N5-N8-E2-B` | `N2-N6-C1-E1-C2-N7` | `N5-C3-N8` | `S-R` |
| 6 | `S-N2-N3-N4-N5-N8-E2-B` | `N2-N1-C1-N6-E1-C2-N3` | `N5-C3-N8` | `S-R` |
| 7 | `S-N1-N2-N3-N4-N5-N8-E2-B` | `N2-N6-C1-E1-C2-N7-N4` | `N8-C3-B` | `S-R` |
| 8 | `S-N2-N3-N4-N5-N8-E2-B` | `N2-N1-N6-E1-C1-C2-N3` | `N5-C3-N8` | `S-R` |
| 9 | `S-N1-N2-N3-N7-N4-N5-N8-E2-B` | `N2-N6-E1-C1-C2-N7` | `N8-C3-B` | `S-R` |
| 10 | `S-N2-N3-N7-N4-N5-N8-E2-B` | `N2-N1-C1-N6-E1-C2-N7` | `N5-C3-E2` | `S-R` |

每张图的 C1/C2 位于包含 E1 的可选绕路，C3 位于第二条支路，满足两条宝箱支路和精英绕行。E2 位于 Boss 前主路，是高概率接触的构筑预检；遭遇对象仍按真实碰撞盒与追击 AI 工作，不额外生成隐形门墙。每次遭遇胜利后对象移除；撤退/战败返回时对象仍在。

野外 `groundLayer` 的可开工占位规则同城镇：walkable index 0、collision index 1，decor 两层全 0。正式美术可替换为各层主题 tile 与 decor；不得覆盖对象脚底/交互格、改变 collision hash，或用不透明前景长期遮住玩家。地图生产验证必须记录 11 个 collision SHA-256；同 contentVersion 下 hash 变化直接失败。

hash 输入固定为 row-major `Uint8Array` 的原始 0/1 字节，不含 JSON 标点或换行。上述算法的冻结结果如下，walkable 用于额外防止“hash 算法写错但快照被整体替换”：

| mapId | walkable tiles | collision SHA-256 |
| --- | ---: | --- |
| `map_town` | 3266 | `bf421d7a56f0afb60dfb2a5c72f3ccf5233d2d540a11bde32fe1ea748a7754de` |
| `map_floor_01` | 1073 | `dbb7994555dda3ef12fa669075d86a62630ca7d9b85cbf43b3eccf259ebd81c0` |
| `map_floor_02` | 1131 | `3f724a632713fe3bd6672335713be75dcad0f6e057978951240a9a728c7d2533` |
| `map_floor_03` | 1077 | `4c125ac8f277d70f5bfc606dc5dd99d5464e9d03fe97b9969bc16430f3273d8f` |
| `map_floor_04` | 1161 | `27d00d4976c98c6e10cbcf8fa4e5e234d40be0de88c0bb5a39dafa13a6448572` |
| `map_floor_05` | 1072 | `a1c5b9c21f4da9287c30e744ad8e35fddf46bd2e95a2a82b2be35e844d0e1c02` |
| `map_floor_06` | 1133 | `2a291e49028044be0a052afb47a857893724438097a62fbd28eb17749036a9c7` |
| `map_floor_07` | 1067 | `03f960c9b69424fb304c082d276812bbb31a76a40ef8a66d21ed0257e87d026b` |
| `map_floor_08` | 1169 | `7a2568f02ceced11ce69104615fa25247eaeafbb9c8c26276af20c0df3c46734` |
| `map_floor_09` | 1182 | `381c7066ed671590fd4acf8d1c0f9980d7e28288f8aed43233e0e61f76adca07` |
| `map_floor_10` | 1161 | `482e11862ec1c049212293a7384c427a6e3d62b8560d5c31127fcfc7e10cfeca` |

## 3. NPC、对话与商店

### 3.1 七个 NpcDefinition

| npcId | function | unlockCondition | lockReasonKey | dialogueId | spriteId |
| --- | --- | --- | --- | --- | --- |
| `npc_tavern_keeper` | tavern | always | `lock.none` | `dialogue_tavern_keeper` | `sprite_npc_tavern_keeper` |
| `npc_blacksmith` | blacksmith | always | `lock.none` | `dialogue_blacksmith` | `sprite_npc_blacksmith` |
| `npc_skill_mentor` | skillMentor | always | `lock.none` | `dialogue_skill_mentor` | `sprite_npc_skill_mentor` |
| `npc_merchant` | merchant | always | `lock.none` | `dialogue_merchant` | `sprite_npc_merchant` |
| `npc_innkeeper` | inn | always | `lock.none` | `dialogue_innkeeper` | `sprite_npc_innkeeper` |
| `npc_cartographer` | cartographer | always | `lock.none` | `dialogue_cartographer` | `sprite_npc_cartographer` |
| `npc_abyss_watcher` | abyssWatcher | floorCleared:5 | `lock.abyss_watcher.floor_05` | `dialogue_abyss_watcher` | `sprite_npc_abyss_watcher` |

`nameKey=npc.<npcId>.name`。always/floorCleared 是 UnlockCondition 的精确展开，不保存短字符串。

### 3.2 七段基础 DialogueDefinition

每段固定一页；speakerNpcId 为同名 NPC，textKey 如下。后续剧情页可通过新内容版本追加，首版不得缺少本页。

| dialogueId | speakerNpcId | textKey |
| --- | --- | --- |
| `dialogue_tavern_keeper` | `npc_tavern_keeper` | `dialogue.tavern_keeper.greeting` |
| `dialogue_blacksmith` | `npc_blacksmith` | `dialogue.blacksmith.greeting` |
| `dialogue_skill_mentor` | `npc_skill_mentor` | `dialogue.skill_mentor.greeting` |
| `dialogue_merchant` | `npc_merchant` | `dialogue.merchant.greeting` |
| `dialogue_innkeeper` | `npc_innkeeper` | `dialogue.innkeeper.greeting` |
| `dialogue_cartographer` | `npc_cartographer` | `dialogue.cartographer.greeting` |
| `dialogue_abyss_watcher` | `npc_abyss_watcher` | `dialogue.abyss_watcher.greeting` |

### 3.3 ShopDefinition

| shopId | npcId | tiers 原数组顺序 | minHighestUnlockedFloor |
| --- | --- | --- | --- |
| `shop_town_merchant` | `npc_merchant` | `shop_t1`,`shop_t2`,`shop_t3`,`shop_t4` | 1,3,6,9 |

- tiers 的其余完整字段按 BAL-1.2 同名行展开。
- offer、itemLevel、stackable/equipment/skillStone 池与品质权重只按 `balance-tables.md` 5.4/5.5 展开。

## 4. Quest 与 Recruitment

唯一 QuestDefinition：

| questId | nameKey | descriptionKey | unlockCondition | completionCondition |
| --- | --- | --- | --- | --- |
| `quest_first_elite` | `quest.quest_first_elite.name` | `quest.quest_first_elite.description` | always | encounterCleared:`encounter_floor_01_elite_boar` |

五个 RecruitmentDefinition 固定如下；`game-design.md` 4.4 仅为玩法说明镜像，本表为内容真源。

| recruitmentId | characterId | condition |
| --- | --- | --- |
| `recruit_iron_guard_tavern` | `char_iron_guard` | `{kind:'gold',goldCost:0,minimumClearedFloor:0}` |
| `recruit_ember_mage_tavern` | `char_ember_mage` | `{kind:'gold',goldCost:0,minimumClearedFloor:0}` |
| `recruit_priest_first_elite` | `char_priest` | `{kind:'questCompleted',questId:'quest_first_elite'}` |
| `recruit_ranger_floor_02` | `char_ranger` | `{kind:'firstClear',floorNumber:2}` |
| `recruit_frost_floor_04` | `char_frost_seer` | `{kind:'firstClear',floorNumber:4}` |

ContentCatalog 必须断言非主角角色集合与 recruitment.characterId 集合完全相等。

## 5. 50 个 EncounterDefinition

每行额外按纯函数生成 `fieldSpriteId=sprite_field_<EncounterId>`；地图怪物直接使用该资源，禁止根据 `enemyIdsBySlot` 的首个单位或 encounter kind 猜一张探索图。

### 5.1 记法

- `E[a,b,c,d,e,f]` 逐格展开为长度 6 的 enemyIdsBySlot；`-` 为 null。
- 每层三组 normal、一个 elite、一个 boss，ID 如表。xpReward、goldRewardMin/goldRewardMax、dropTableId、canRetreat 只按 BAL-1.2 2.1/5.6 的 floor+rank 纯函数展开。
- `kind` 与列名一致；boss Encounter 的 enemyIdsBySlot 恰好一个初始 Boss，召唤物由技能产生。

### 5.2 第 1～5 层

| encounterId | kind | E[0..5] |
| --- | --- | --- |
| `encounter_floor_01_normal_a` | normal | E[`enemy_grass_slime`,`enemy_thorn_rat`,-,-,-,-] |
| `encounter_floor_01_normal_b` | normal | E[`enemy_fang_wolf`,-,-,`enemy_goblin_scout`,-,-] |
| `encounter_floor_01_normal_c` | normal | E[`enemy_grass_slime`,`enemy_fang_wolf`,-,`enemy_goblin_scout`,-,-] |
| `encounter_floor_01_elite_boar` | elite | E[-,`enemy_stonehide_boar`,-,`enemy_goblin_scout`,-,-] |
| `encounter_floor_01_boss` | boss | E[-,`boss_horned_king`,-,-,-,-] |
| `encounter_floor_02_normal_a` | normal | E[`enemy_sporeling`,`enemy_sporeling`,-,-,-,-] |
| `encounter_floor_02_normal_b` | normal | E[`enemy_venom_spider`,`enemy_venom_spider`,-,-,-,-] |
| `encounter_floor_02_normal_c` | normal | E[`enemy_sporeling`,`enemy_venom_spider`,-,`enemy_sporeling`,-,-] |
| `encounter_floor_02_elite_guardian` | elite | E[`enemy_sporeling`,`enemy_fungal_guardian`,-,`enemy_venom_spider`,-,-] |
| `encounter_floor_02_boss` | boss | E[-,`boss_brood_spider`,-,-,-,-] |
| `encounter_floor_03_normal_a` | normal | E[`enemy_cave_bat`,`enemy_cave_bat`,-,`enemy_cave_bat`,-,-] |
| `encounter_floor_03_normal_b` | normal | E[`enemy_bomb_goblin`,-,-,`enemy_bomb_goblin`,-,-] |
| `encounter_floor_03_normal_c` | normal | E[`enemy_cave_bat`,-,-,`enemy_bomb_goblin`,-,-] |
| `encounter_floor_03_elite_golem` | elite | E[`enemy_cave_bat`,`enemy_ore_golem`,-,`enemy_cave_bat`,-,-] |
| `encounter_floor_03_boss` | boss | E[-,`boss_iron_devourer`,-,-,-,-] |
| `encounter_floor_04_normal_a` | normal | E[`enemy_bog_leech`,`enemy_bog_leech`,-,-,-,-] |
| `encounter_floor_04_normal_b` | normal | E[`enemy_bog_leech`,`enemy_bog_leech`,-,`enemy_bog_leech`,-,-] |
| `encounter_floor_04_normal_c` | normal | E[`enemy_bog_leech`,-,-,`enemy_bog_leech`,`enemy_bog_leech`,-] |
| `encounter_floor_04_elite_wraith` | elite | E[`enemy_bog_leech`,-,-,`enemy_mist_wraith`,`enemy_bog_leech`,-] |
| `encounter_floor_04_boss` | boss | E[-,`boss_bog_witch`,-,-,-,-] |
| `encounter_floor_05_normal_a` | normal | E[`enemy_ember_hound`,`enemy_ember_hound`,-,-,-,-] |
| `encounter_floor_05_normal_b` | normal | E[`enemy_ember_hound`,-,-,`enemy_ember_hound`,-,-] |
| `encounter_floor_05_normal_c` | normal | E[`enemy_ember_hound`,`enemy_ember_hound`,-,`enemy_ember_hound`,-,-] |
| `encounter_floor_05_elite_cultist` | elite | E[`enemy_ember_hound`,`enemy_ember_hound`,-,`enemy_ash_cultist`,-,-] |
| `encounter_floor_05_boss` | boss | E[-,`boss_ember_guardian`,-,-,-,-] |

### 5.3 第 6～10 层

| encounterId | kind | E[0..5] |
| --- | --- | --- |
| `encounter_floor_06_normal_a` | normal | E[-,-,-,`enemy_dread_eye`,-,-] |
| `encounter_floor_06_normal_b` | normal | E[-,-,-,`enemy_dread_eye`,`enemy_dread_eye`,-] |
| `encounter_floor_06_normal_c` | normal | E[-,-,-,`enemy_dread_eye`,`enemy_dread_eye`,`enemy_dread_eye`] |
| `encounter_floor_06_elite_mauler` | elite | E[-,`enemy_abyss_mauler`,-,`enemy_dread_eye`,`enemy_dread_eye`,-] |
| `encounter_floor_06_boss` | boss | E[-,`boss_abyss_butcher`,-,-,-,-] |
| `encounter_floor_07_normal_a` | normal | E[`enemy_blood_ghoul`,`enemy_blood_ghoul`,-,-,-,-] |
| `encounter_floor_07_normal_b` | normal | E[`enemy_blood_ghoul`,-,-,`enemy_blood_ghoul`,-,-] |
| `encounter_floor_07_normal_c` | normal | E[`enemy_blood_ghoul`,`enemy_blood_ghoul`,-,`enemy_blood_ghoul`,-,-] |
| `encounter_floor_07_elite_acolyte` | elite | E[`enemy_blood_ghoul`,`enemy_blood_ghoul`,-,`enemy_crimson_acolyte`,-,-] |
| `encounter_floor_07_boss` | boss | E[-,`boss_crimson_knight`,-,-,-,-] |
| `encounter_floor_08_normal_a` | normal | E[-,-,-,`enemy_ice_revenant`,-,-] |
| `encounter_floor_08_normal_b` | normal | E[-,-,-,`enemy_ice_revenant`,`enemy_ice_revenant`,-] |
| `encounter_floor_08_normal_c` | normal | E[-,-,-,`enemy_ice_revenant`,`enemy_ice_revenant`,`enemy_ice_revenant`] |
| `encounter_floor_08_elite_warden` | elite | E[-,`enemy_frost_warden`,-,`enemy_ice_revenant`,`enemy_ice_revenant`,-] |
| `encounter_floor_08_boss` | boss | E[-,`boss_pale_jailer`,-,-,-,-] |
| `encounter_floor_09_normal_a` | normal | E[`enemy_void_spark`,-,-,`enemy_void_spark`,-,-] |
| `encounter_floor_09_normal_b` | normal | E[-,-,-,`enemy_void_spark`,`enemy_void_spark`,-] |
| `encounter_floor_09_normal_c` | normal | E[`enemy_void_spark`,-,-,`enemy_void_spark`,`enemy_void_spark`,-] |
| `encounter_floor_09_elite_shard` | elite | E[`enemy_void_spark`,-,-,`enemy_watcher_shard`,`enemy_void_spark`,-] |
| `encounter_floor_09_boss` | boss | E[-,`boss_thousand_eye`,-,-,-,-] |
| `encounter_floor_10_normal_a` | normal | E[-,-,-,`enemy_abyss_herald`,-,-] |
| `encounter_floor_10_normal_b` | normal | E[-,-,-,`enemy_abyss_herald`,`enemy_abyss_herald`,-] |
| `encounter_floor_10_normal_c` | normal | E[-,-,-,`enemy_abyss_herald`,`enemy_abyss_herald`,`enemy_abyss_herald`] |
| `encounter_floor_10_elite_knight` | elite | E[-,`enemy_throne_knight`,-,`enemy_abyss_herald`,`enemy_abyss_herald`,-] |
| `encounter_floor_10_boss` | boss | E[-,`boss_abyss_king`,-,-,-,-] |

## 6. 八个 EncounterModifierDefinition

名称/说明 key 固定为 `encounter_modifier.<modifierId>.name/description`。rule 是 strict 判别联合；数值之外无隐藏持续时间、触发概率或状态 ID。

| modifierId | rule | 玩家可见效果 |
| --- | --- | --- |
| `modifier_assault` | `timedStat(enemy,attack,+1000,round 1..2)` | 敌方前两轮攻击 +10% |
| `modifier_swift` | `timedStat(enemy,speed,+1200,round 1..2)` | 敌方前两轮速度 +12% |
| `modifier_bulwark` | `timedStat(enemy,defense,+1200,round 1..3)` | 敌方前三轮防御 +12% |
| `modifier_mire` | `timedStat(party,speed,-1000,round 1..2)` | 我方前两轮速度 -10% |
| `modifier_abyss_execution` | `executeDamage(enemy,targetHpAtMostBps=3000,damageBonusBps=1500)` | 敌方对 30% 及以下生命目标直接伤害 +15% |
| `modifier_abyss_fortress` | `battleStartShield(enemy,maxHpBps=1200)` | 敌方开战获得最大生命 12% 护盾 |
| `modifier_abyss_pressure` | `escalatingStat(enemy,attack,perRoundBps=400,capBps=2000)` | 敌方攻击每轮 +4%，最高 +20% |
| `modifier_abyss_suppression` | `healingSuppression(party,valueBps=1500)` | 我方最终治疗 -15% |

### 6.1 50 个 encounter 的 modifierIds 展开表

下表每格就是该层相应 `normal_a/normal_b/normal_c/elite` 的完整原数组；Boss 固定 `[]`。禁止根据 isAbyss、楼层号或 enemyId 自动追加。

| floor | normal_a | normal_b | normal_c | elite |
| ---: | --- | --- | --- | --- |
| 1 | `[]` | `[modifier_assault]` | `[modifier_swift]` | `[modifier_bulwark]` |
| 2 | `[modifier_assault]` | `[modifier_swift]` | `[modifier_mire]` | `[modifier_bulwark,modifier_assault]` |
| 3 | `[modifier_bulwark]` | `[modifier_swift]` | `[modifier_assault,modifier_bulwark]` | `[modifier_bulwark,modifier_mire]` |
| 4 | `[modifier_assault]` | `[modifier_mire]` | `[modifier_swift]` | `[modifier_assault,modifier_swift]` |
| 5 | `[modifier_bulwark]` | `[modifier_assault]` | `[modifier_mire,modifier_bulwark]` | `[modifier_assault,modifier_bulwark]` |
| 6 | `[modifier_abyss_execution]` | `[modifier_abyss_fortress]` | `[modifier_assault,modifier_abyss_execution]` | `[modifier_abyss_fortress,modifier_abyss_execution]` |
| 7 | `[modifier_abyss_pressure]` | `[modifier_abyss_execution]` | `[modifier_swift,modifier_abyss_pressure]` | `[modifier_abyss_execution,modifier_abyss_pressure]` |
| 8 | `[modifier_abyss_fortress]` | `[modifier_abyss_suppression]` | `[modifier_bulwark,modifier_abyss_fortress]` | `[modifier_abyss_fortress,modifier_abyss_suppression]` |
| 9 | `[modifier_swift,modifier_abyss_pressure]` | `[modifier_abyss_suppression]` | `[modifier_mire,modifier_abyss_pressure]` | `[modifier_swift,modifier_abyss_pressure]` |
| 10 | `[modifier_abyss_execution,modifier_abyss_pressure]` | `[modifier_abyss_fortress,modifier_abyss_suppression]` | `[modifier_swift,modifier_abyss_pressure]` | `[modifier_abyss_execution,modifier_abyss_fortress,modifier_abyss_pressure]` |

## 7. 十个 AbyssEchoDefinition

`nameKey/descriptionKey` 固定为 `abyss_echo.<echoId>.name/description`。倍率 10000 表示不变；目标三项中 null 表示不限，`requiredAnyComboTriggers=1` 表示任意已激活 Combo 在本场至少实际触发一次，不指定唯一 Combo。首通材料均在同一奖励事务追加。

| echoId | floor/boss | HP/ATK/DEF/SPD bps | enrageDelta | itemLimit | maxRounds | maxKnockouts | anyCombo | abyss bonus | 首通 forge/dust |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `echo_f06_iron` | `floor_06/encounter_floor_06_boss` | `11500/11000/10000/10000` | -1 | 2 | 11 | 2 | 0 | 800 | `10/10` |
| `echo_f06_hunger` | `floor_06/encounter_floor_06_boss` | `12000/11500/10500/10000` | -1 | 1 | 12 | 0 | 1 | 1200 | `12/12` |
| `echo_f07_red_tide` | `floor_07/encounter_floor_07_boss` | `11500/11500/10000/10500` | -1 | 2 | 12 | 2 | 0 | 1000 | `12/12` |
| `echo_f07_blood_oath` | `floor_07/encounter_floor_07_boss` | `12500/12000/10500/10500` | -2 | 1 | 13 | 0 | 1 | 1400 | `14/14` |
| `echo_f08_white_wall` | `floor_08/encounter_floor_08_boss` | `12000/11000/11500/10000` | -1 | 2 | 13 | 2 | 0 | 1200 | `14/14` |
| `echo_f08_silent_prison` | `floor_08/encounter_floor_08_boss` | `12500/11500/12000/10500` | -2 | 0 | 14 | 1 | 1 | 1600 | `16/16` |
| `echo_f09_storm_eye` | `floor_09/encounter_floor_09_boss` | `11500/11500/10000/11500` | -1 | 2 | 10 | 2 | 0 | 1400 | `16/16` |
| `echo_f09_rewrite` | `floor_09/encounter_floor_09_boss` | `12500/12000/10500/12000` | -2 | 1 | 11 | 0 | 1 | 1800 | `18/18` |
| `echo_f10_dark_throne` | `floor_10/encounter_floor_10_boss` | `12000/11500/11000/10500` | -1 | 2 | 13 | 2 | 1 | 1800 | `20/20` |
| `echo_f10_endless_king` | `floor_10/encounter_floor_10_boss` | `13000/12000/11500/11000` | -2 | 0 | 14 | 0 | 1 | 2200 | `25/25` |

- `itemLimit` 范围 0～2；达到上限后 USE_ITEM 返回 `ITEM_USE_FORBIDDEN.ECHO_LIMIT`，不产生事件。
- 成功条件在敌方全灭、奖励生成前核对：`round<=maxRounds`、knockouts.length<=maxKnockouts、全体 comboTriggerCounts 求和>=requiredAnyComboTriggers。任一失败输出 challengeFailed 结果并直接回城，无掉落/XP/金币/首通材料。
- `bonusAbyssUpgradeChanceBps` 只叠加对应 Boss 常规 DropTable 中 equipment roll 的非零升格字段；不作用于 firstClear、fixedEquipment、skillStone 或商店。

## 8. 内容批次与校验

| 批次 | floors/maps | encounters | NPC/对话 | quest/recruitment/shop |
| --- | --- | ---: | --- | --- |
| RPG-022 | town + floor_01 | 5 + 4 组 modifierIds + 1 intent | 前 5 NPC + 前 5 dialogue | quest 1、recruitment 前 3、shop 1 |
| RPG-024 | floor_02～05 | 20 + 16 组 modifierIds + 4 intents | cartographer + abyssWatcher 及对话 | recruitment 后 2 |
| RPG-025 | floor_06～10 | 25 + 20 组 modifierIds + 5 intents | 0 | 0 |
| RPG-028 | 不新增地图 | 10 echo；复用 5 个 Boss encounter | 复用 abyssWatcher | 10 echo |

最终门禁：floors=10、maps=11、encounters=50、encounterModifiers=8、abyssEchoes=10、npcs=7、dialogues=7、quests=1、recruitments=5、shops=1。每张野外图的 15 个 objectId 唯一；每个 encounter 至少被一个 map object、FloorDefinition 或 AbyssEchoDefinition 引用；不允许通过表外对象补数量。
