# VIS-004A / VIS-004B / VIS-004C / VIS-004D 正式战斗像素角色报告

## 结论

第一层可玩闭环的 10 个战斗身份已生成、打包、激活并接入 Pixi 战斗画面。运行时不再使用通用 `Graphics` 剪影，而是严格通过 `CharacterDefinition.battleSpriteId` 和 `EnemyDefinition.spriteId` 读取正式图集；玩家与敌方的已提交战斗事件都会驱动对应动作。

## 美术与资源

- 4 名角色：流浪剑士、铁卫、炎术师、祭司。
- 5 类普通/精英敌人和 1 名 Boss：草原史莱姆、棘鼠、獠牙狼、哥布林斥候、石皮野猪、角王。
- 每个身份 27 帧：idle 4、attack 6、skill 8、hit 3、down 6；共 270 个源帧、10 张 sheet 和 10 份 atlas JSON。
- 普通单帧 48×48，Boss 64×64；二值 alpha、固定色板、nearest scale、固定脚底锚点。
- vertical slice 资源已切到 `/assets/visual/v1/battle/**`；fixture/candidate 38 项语义不受影响。

## 运行时

- `BattleSceneRenderer` 从横向 sheet 派生帧纹理，存活单位播放 idle 循环，倒下单位停在 down 最终帧。
- 玩家普攻、技能、药水、防御、撤退，敌方 AI 与控制跳过统一经过当前 `BattleScene`；只有 Gateway/CAS 成功后才按事件顺序播放动作，失败不会先播假动画。
- `ACTION_STARTED` 驱动 attack/skill，直接伤害驱动 hit，击倒驱动 down，复活与行动结束恢复 idle；动画期间 HUD 锁定，暂停、离场和销毁会取消队列。
- 战斗期间额外持有当前楼层 `assetBundleId` lease，不把敌人资源偷搬到 `battle_common`；路由失败、离开战斗和销毁都会释放。
- 名称、HP、能量、速度、行动顺序和指令按钮继续使用既有不可变战斗投影。

## 审查修复

首次独立美术审查拦下了敌方二次镜像：主体已镜像，但位移、武器和特效又反号，导致哥布林刀线和 Boss 武器朝右。修复后所有局部坐标只描述右向源姿态，敌方仅在最后整体镜像一次。新测试又抓到獠牙狼与角王 skill 帧触边，已缩回并通过全帧边界检查。

## 验证

- 美术/打包/激活/战斗 renderer focused：5 files / 93 tests PASS。
- `npm run verify:battle-art`：10 assets / 270 frames PASS。
- `npm run verify:art`：PASS。
- `npm run verify:assets -- --batch verticalSlice`：PASS。
- 全量 unit：97 files / 638 tests PASS。
- `npm run typecheck`、`npm run lint`、`npm run build`：PASS；仅既有大 chunk warning。
- `npm run test:e2e -- tests/e2e/visible-battle-ui.spec.ts`：1/1 PASS，真实标题→新游戏→canvas 移动→制图师→第一层→碰怪→战斗→点击 Pixi 普攻。
- 真实 568×320 截图：`vis004c-formal-battle-568.png`、`vis004d-basic-attack-568.png`、`vis004d-second-attack-80ms-568.png`；连续两次画布普攻均推进 HP/行动顺序，console error 0、warning 0。

## VIS-005 真机构图与打击反馈

- 普通角色放大至 1.5 倍、Boss 1.25 倍，保持 manifest 脚底锚点；上下排脚底重排为 150/252，32×31 信息卡移到脚下并与角色保留 5 个逻辑像素间距。
- `ACTION_STARTED` 默认节奏由 300ms 收紧到 160ms；80ms 能看到攻击者前冲与 attack 帧，约 190ms 能看到目标受击、反向位移和 14px 伤害数字。
- 直接伤害、治疗与护盾均有结构化跳字；暴击异色。`reducedFlashes` 会关闭受击染色但保留位移和数字。
- 权威存档仍在 Gateway/CAS 成功后立即生效，但表现快照在事件播放完成后才刷新；因此动作起手不会提前显示结算后的 HP。跳过、暂停、恢复和销毁都会回到权威快照并清理 timer、位移、染色与临时文本。
- focused：3 files / 102 tests PASS；全量 unit：97 files / 641 tests PASS；typecheck、lint、build PASS。
- 真实 `visible-battle-ui.spec.ts`：1/1 PASS；`vis005-battle-layout-current-568.png`、`vis005-attack-80ms-568.png`、`vis005-impact-190ms-568.png`、`vis005-after-attack-568.png` 已覆盖静态构图、起手、命中和动画结束，console error 0、warning 0。

## VIS-006 技能、Combo 与 Boss 意图反馈

- 技能与 Combo 文案由 GameFlow 严格通过当前 `ContentCatalog.getSkill/getCombo` 的 `nameKey` 解析后注入；表现层不根据 ID、角色名或 ownerKey 猜文案。
- 主动/终极技能显示右上安全区像素横幅；直接伤害按事件 `element` 生成硬边爆点，暴击显示更大的金色“暴击”数字。
- `COMBO_TRIGGERED` 以 battle/root/owner/combo 为键折叠同根重复事件，不同根行动可再次显示；普通横幅 700ms，低闪烁 400ms。
- Boss `INTENT_DECLARED` 在来源敌人头顶显示持久蓄力标记，`INTENT_RELEASED/CLEARED` 按 exact intentId 移除；所有横幅、意图、timer 与 Graphics 都随 render/pause/destroy 清理。
- 全量 unit：97 files / 642 tests PASS；typecheck、lint、build PASS。
- 最终代码再次运行真实 `visible-battle-ui.spec.ts`：1/1 PASS；`vis006-skill-banner-reload-100ms-568.png` 和 `vis006-skill-impact-reload-220ms-568.png` 已证明本地化“技能 · 火球术”横幅、元素爆点和伤害数字在真实画布出现，console error 0、warning 0。
