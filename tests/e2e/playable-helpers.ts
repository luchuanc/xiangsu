import { expect, type Locator, type Page } from "@playwright/test";

const AUTO_ENCOUNTER_OBSERVATION_TIMEOUT_MS = 250;

// 观测动态场景节点时使用短超时，避免转场后旧 locator 的读取拖满整条 E2E 超时。
async function readLocatorText(locator: Locator): Promise<string> {
  try {
    return (await locator.textContent({ timeout: AUTO_ENCOUNTER_OBSERVATION_TIMEOUT_MS })) ?? "<null>";
  } catch {
    return "<missing>";
  }
}

async function readLocatorVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout: AUTO_ENCOUNTER_OBSERVATION_TIMEOUT_MS });
  } catch {
    return false;
  }
}

async function readLocatorDisabled(locator: Locator): Promise<string> {
  try {
    if (await locator.count() === 0) return "<missing>";
    return String(await locator.isDisabled({ timeout: AUTO_ENCOUNTER_OBSERVATION_TIMEOUT_MS }));
  } catch {
    return "<missing>";
  }
}

async function readLocatorEnabled(locator: Locator): Promise<boolean> {
  try {
    return await locator.isEnabled({ timeout: AUTO_ENCOUNTER_OBSERVATION_TIMEOUT_MS });
  } catch {
    return false;
  }
}

export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  return errors;
}

export async function startNewGame(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#game-root canvas")).toBeVisible();
  // Pixi 生产资源首次解码可能超过 Playwright 默认 5 秒，等待真实标题状态而非依赖热缓存。
  await expect(page.getByTestId("flow-status")).toContainText("标题", { timeout: 30_000 });
  await page.getByTestId("new-game").click();
  await expect(page.getByTestId("flow-status")).toContainText("城镇", { timeout: 30_000 });
}

/**
 * 在真实 canvas 上拖动 Pixi HUD 摇杆；不使用隐藏的 move-* 语义按钮。
 * 坐标只从 640×360 逻辑画布换算到当前 canvas 的 CSS rect，保持移动端 contain 合同。
 */
export async function dragPixiJoystick(
  page: Page,
  direction: { readonly x: number; readonly y: number },
  holdMs = 1_000,
): Promise<void> {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("PIXI_CANVAS_NOT_MEASURABLE");
  const scale = box.width / 640;
  const origin = { x: box.x + 60 * scale, y: box.y + 300 * scale };
  const length = 46 * scale;
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + direction.x * length, origin.y + direction.y * length, { steps: 2 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** 点击 Pixi HUD 的交互按钮；按钮动作最终由 InputState 在固定步消费。 */
export async function tapPixiInteraction(page: Page): Promise<void> {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("PIXI_CANVAS_NOT_MEASURABLE");
  const scale = box.width / 640;
  await page.mouse.click(box.x + 603 * scale, box.y + 274 * scale);
}

/** 点击右下角 Pixi 菜单键；管理系统必须从真实画布入口打开。 */
export async function tapPixiMenu(page: Page): Promise<void> {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("PIXI_CANVAS_NOT_MEASURABLE");
  const scale = box.width / 640;
  // ExplorationHud 的 menu 中心在 640×360 逻辑画布的 (536, 274)。
  await page.mouse.click(box.x + 536 * scale, box.y + 274 * scale);
}

export async function arrangeGuardFront(page: Page): Promise<void> {
  const partyEntry = page.getByTestId("management-party");
  await expect(partyEntry).toBeVisible({ timeout: 10_000 });
  await expect(partyEntry).toBeEnabled({ timeout: 10_000 });
  await partyEntry.click();

  const summary = page.getByTestId("management-summary");
  const frontSlot = page.getByTestId("management-party-slot-0");
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(frontSlot).toBeVisible({ timeout: 10_000 });

  const guardPlacement = page.getByTestId("management-party-place-char_iron_guard-slot-0");
  await expect(guardPlacement).toHaveCount(1);
  if (await guardPlacement.isEnabled()) {
    // 移动端管理页可能超出可视区，使用 Playwright 原生滚动而非注入点击。
    await guardPlacement.scrollIntoViewIfNeeded();
    await guardPlacement.click();
    await expect(guardPlacement).toBeDisabled({ timeout: 10_000 });
  }
  await expect(frontSlot).toContainText("char_iron_guard");

  const confirm = page.getByTestId("management-party-confirm");
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeEnabled({ timeout: 10_000 });
  await confirm.click();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText("char_iron_guard");

  const returnTown = page.getByTestId("return-town");
  await expect(returnTown).toBeVisible({ timeout: 10_000 });
  // click 自带移动端滚动；按钮已经由可见性断言确认存在，避免异步重绘期间旧节点脱离。
  await returnTown.click();
  await expect(page.getByTestId("flow-status")).toContainText("城镇", { timeout: 30_000 });
}

export async function enterFloor(page: Page, floorNumber: number): Promise<void> {
  const floorId = `floor_${String(floorNumber).padStart(2, "0")}`;
  const testId = floorNumber === 1 ? "enter-floor" : `enter-floor-${floorId}-exploration`;
  const entry = page.getByTestId(testId);
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await expect(entry).toBeEnabled({ timeout: 10_000 });
  await entry.click();
  await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 10_000 });
}

/**
 * 等待自动寻怪真正进入战斗，同时把自动会话提前失败的原因完整暴露出来。
 * 不把生产有界自动会话的硬上限伪装成更长的 Playwright 等待。
 */
export async function waitForAutoEncounterBattle(page: Page, context: string): Promise<void> {
  const status = page.getByTestId("flow-status");
  const autoEncounter = page.getByTestId("auto-encounter");
  const autoError = page.getByTestId("auto-encounter-error");
  const flowErrorDetail = page.getByTestId("flow-error-detail");
  const position = page.getByTestId("exploration-position");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const statusText = await readLocatorText(status);
    if (statusText.includes("战斗")) return;
    if (statusText.includes("当前操作失败")) {
      const detail = await readLocatorText(flowErrorDetail);
      throw new Error(`${context} 自动寻怪进入错误态：flow-error-detail=${detail}`);
    }

    // 先短暂读取按钮，再重新读取状态；转战斗时按钮可能正好在两次 DOM 读取之间卸载。
    const autoCountBefore = await autoEncounter.count();
    const autoEnabled = autoCountBefore > 0 && await readLocatorEnabled(autoEncounter);
    const latestStatusText = await readLocatorText(status);
    if (latestStatusText.includes("战斗")) return;
    if (latestStatusText.includes("当前操作失败")) {
      const detail = await readLocatorText(flowErrorDetail);
      throw new Error(`${context} 自动寻怪进入错误态：flow-error-detail=${detail}`);
    }
    const autoCountAfter = await autoEncounter.count();
    const errorVisible = await readLocatorVisible(autoError);
    const autoStableAndEnabled = autoCountBefore > 0 && autoCountAfter > 0 && autoEnabled;
    if (latestStatusText.includes("野外") && (errorVisible || autoStableAndEnabled)) {
      const positionText = await readLocatorText(position);
      const errorText = await readLocatorText(autoError);
      const disabled = await readLocatorDisabled(autoEncounter);
      throw new Error(
        `${context} 自动寻怪提前结束：flow-status=${latestStatusText}; exploration-position=${positionText}; `
        + `auto-encounter-error=${errorText}; auto-encounter-disabled=${disabled}`,
      );
    }
    await page.waitForTimeout(250);
  }

  const statusText = await readLocatorText(status);
  const positionText = await readLocatorText(position);
  const errorText = await readLocatorText(autoError);
  const disabled = await readLocatorDisabled(autoEncounter);
  throw new Error(
    `${context} 自动寻怪等待 60 秒仍未进入战斗：flow-status=${statusText}; `
    + `exploration-position=${positionText}; auto-encounter-error=${errorText}; auto-encounter-disabled=${disabled}`,
  );
}

export type BattleOutcome = "victory" | "defeat";

/**
 * 驱动真实战斗指令直到胜负终局；不读取内部存档，也不绕过页面按钮。
 * 训练流程需要保留战败结果，因此胜利断言由下面的兼容 wrapper 单独完成。
 */
export async function playCurrentBattleAndClaim(page: Page, maxCommands = 128): Promise<BattleOutcome> {
  const status = page.getByTestId("flow-status");
  const reward = page.getByTestId("claim-reward");
  const flowErrorDetail = page.getByTestId("flow-error-detail");
  const potion = page.getByTestId("minor-potion");
  const equippedSkill = page.getByTestId("equipped-skill");
  let battlePotionUsed = false;
  let observedFlowErrorDetail = "<missing>";

  type CommandOutcome = "ready" | "reward" | "defeat" | "error";
  let outcome: CommandOutcome = "ready";
  const waitForBattleOutcome = async (action: string): Promise<Exclude<CommandOutcome, "error">> => {
    // 每次命令都等待真实 UI 回到我方待命；若队伍败北回城或流程报错，直接给出可诊断失败。
    try {
      await expect.poll(async () => {
        if (await reward.isVisible()) {
          outcome = "reward";
          return outcome;
        }
        const text = await status.textContent();
        // IndexedDB 提交完成前，奖励按钮可能还未挂载；胜利状态本身已足以判定进入奖励页。
        if (text?.includes("战斗胜利")) {
          outcome = "reward";
          return outcome;
        }
        if (text?.includes("城镇")) {
          outcome = "defeat";
          return outcome;
        }
        if (text?.includes("当前操作失败")) {
          observedFlowErrorDetail = await readLocatorText(flowErrorDetail);
          outcome = "error";
          return outcome;
        }
        const attack = page.getByTestId("basic-attack");
        if (await attack.count() > 0 && await attack.isVisible() && await attack.isEnabled()) {
          outcome = "ready";
          return outcome;
        }
        return "busy";
      }, { timeout: 60_000 }).toMatch(/^(ready|reward|defeat|error)$/);
    } catch (error) {
      // 轮询刚好压过 60 秒时，终局 UI 可能已经完成渲染；以同一组可见节点做最后一次确定性分类。
      const finalStatus = await readLocatorText(status);
      const claimRewardVisible = await readLocatorVisible(reward);
      const finalFlowErrorDetail = await readLocatorText(flowErrorDetail);
      if (claimRewardVisible || finalStatus.includes("战斗胜利")) {
        outcome = "reward";
        return outcome;
      }
      if (finalStatus.includes("城镇")) {
        outcome = "defeat";
        return outcome;
      }
      if (finalStatus.includes("当前操作失败")) {
        throw new Error(`${action} 后战斗流程进入错误态：${finalStatus}; flow-error-detail=${finalFlowErrorDetail}`);
      }
      const finalAttack = page.getByTestId("basic-attack");
      if (await readLocatorVisible(finalAttack) && await readLocatorEnabled(finalAttack)) {
        outcome = "ready";
        return outcome;
      }
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
      throw new Error(`${action} 后战斗结果等待超时：flow-status=${finalStatus ?? "<null>"}; `
        + `claim-reward-visible=${claimRewardVisible}; flow-error-detail=${finalFlowErrorDetail}; `
        + `observed-flow-error-detail=${observedFlowErrorDetail}; ${detail}`);
    }

    // 轮询正常返回错误态时，不能再交给通用断言吞掉生产侧的错误详情。
    if (outcome === "error") {
      throw new Error(`${action} 后战斗流程进入错误态：flow-error-detail=${observedFlowErrorDetail}`);
    }
    expect(outcome, `${action} 后战斗未能继续：流程进入错误态`).toMatch(/^(ready|reward|defeat)$/);
    return outcome as Exclude<CommandOutcome, "error">;
  };

  for (let command = 0; command < maxCommands; command += 1) {
    if (await reward.isVisible()) break;
    const statusText = await status.textContent();
    if (statusText?.includes("城镇")) {
      await waitForTownReady(page);
      return "defeat";
    }
    if (statusText?.includes("当前操作失败")) {
      const detail = await readLocatorText(flowErrorDetail);
      throw new Error(`战斗操作失败：流程已进入错误态；flow-error-detail=${detail}`);
    }
    await expect(status).toContainText("战斗", { timeout: 30_000 });

    // 战斗药水也必须走真实按钮和 Gateway；每场最多使用一瓶，其余恢复交给野外药水。
    // 按钮不可用（无药水、敌方回合或已进入终局）时不强行点击，让断言暴露真实阻塞。
    if (command === 2 && !battlePotionUsed && await potion.count() > 0 && await potion.isEnabled()) {
      battlePotionUsed = true;
      await potion.click();
      const potionOutcome = await waitForBattleOutcome("使用药水");
      if (potionOutcome === "defeat") {
        await waitForTownReady(page);
        return "defeat";
      }
      if (potionOutcome === "reward") break;
      continue;
    }

    // 初始主角已装备主动技能；技能按钮可用时优先真实施放，能量/冷却不足再回退普攻。
    if (await equippedSkill.count() > 0 && await equippedSkill.isEnabled()) {
      await equippedSkill.click();
      const skillOutcome = await waitForBattleOutcome("使用主动技能");
      if (skillOutcome === "defeat") {
        await waitForTownReady(page);
        return "defeat";
      }
      if (skillOutcome === "reward") break;
      continue;
    }

    // 等待普攻可用也必须复用同一套终局分类；战斗可能在等待期间直接胜利、战败或报错。
    const attackReadyOutcome = await waitForBattleOutcome("等待普攻");
    if (attackReadyOutcome === "defeat") {
      await waitForTownReady(page);
      return "defeat";
    }
    if (attackReadyOutcome === "reward") break;
    // 分类返回 ready 后重新取得 locator，避免异步渲染替换旧节点；点击前只做
    // 可见/可用确认，不用 force click 绕过移动端真实交互门禁。
    const currentAttack = page.getByTestId("basic-attack");
    await expect(currentAttack).toBeVisible({ timeout: 30_000 });
    await expect(currentAttack).toBeEnabled({ timeout: 30_000 });
    await currentAttack.click();
    const attackOutcome = await waitForBattleOutcome("普攻");
    if (attackOutcome === "defeat") {
      await waitForTownReady(page);
      return "defeat";
    }
    if (attackOutcome === "reward") break;
  }
  await expect(reward).toBeVisible({ timeout: 60_000 });
  await reward.click();
  await expect(status).toContainText("野外", { timeout: 30_000 });
  return "victory";
}

/** 旧的全胜场景仍使用强断言，避免其它 E2E 悄悄吞掉战败。 */
export async function winCurrentBattleAndClaim(page: Page, maxCommands = 128): Promise<void> {
  const outcome = await playCurrentBattleAndClaim(page, maxCommands);
  expect(outcome, "战斗尚未完成：队伍已败北并回到城镇").toBe("victory");
}

export async function returnRetainedExpedition(page: Page): Promise<void> {
  const returnButton = page.getByTestId("return-town");
  if (await returnButton.count() > 0) {
    await expect(returnButton).toBeVisible({ timeout: 10_000 });
    await returnButton.click();
    await expect(page.getByTestId("flow-status")).toContainText("城镇", { timeout: 30_000 });
  }
  await waitForTownReady(page);
}

/** 战败后的城镇必须完成 COMPLETE 清理，才能开始下一次真实成长尝试。 */
export async function waitForTownReady(page: Page): Promise<void> {
  await expect(page.getByTestId("flow-status")).toContainText("城镇", { timeout: 60_000 });
  const partyManagement = page.getByTestId("management-party");
  await expect(partyManagement).toBeVisible({ timeout: 60_000 });
  await expect(partyManagement).toBeEnabled({ timeout: 60_000 });
}

type ManagementWaitResult = { readonly kind: "success" } | { readonly kind: "error"; readonly code: string };

/** 等待管理页真实 DOM 的成功或错误结果；不把 click 返回当作 CAS 完成信号。 */
async function waitForManagementResult(
  page: Page,
  successTestId: string,
  errorTestId: string,
  context: string,
): Promise<ManagementWaitResult> {
  let observedErrorCode = "<missing>";
  try {
    await expect.poll(async () => {
      const error = page.getByTestId(errorTestId);
      if (await readLocatorVisible(error)) {
        const code = (await readLocatorText(error)).trim();
        observedErrorCode = code.length > 0 ? code : "<empty>";
        return `error:${observedErrorCode}`;
      }
      if (await readLocatorVisible(page.getByTestId(successTestId))) return "success";
      return "pending";
    }, { timeout: 30_000 }).toMatch(/^(success|error:.+)$/);
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
    throw new Error(`${context} 等待结果超时：error=${observedErrorCode}; ${detail}`);
  }
  return observedErrorCode === "<missing>"
    ? { kind: "success" }
    : { kind: "error", code: observedErrorCode };
}

async function closeManagementPage(page: Page): Promise<void> {
  const returnTown = page.getByTestId("return-town");
  await expect(returnTown).toBeVisible({ timeout: 30_000 });
  await returnTown.click();
  await waitForTownReady(page);
}

/**
 * 通过真实城镇页面维护祭司编队和技能；每一步都依赖可见状态，重复调用只补缺失项。
 * 未满足招募条件时仅跳过本轮，不能伪造角色或技能收益。
 */
export async function prepareTownRosterAndSkills(page: Page): Promise<void> {
  await waitForTownReady(page);
  const partyEntry = page.getByTestId("management-party");
  await expect(partyEntry).toBeEnabled({ timeout: 30_000 });
  await partyEntry.click();
  await expect(page.getByTestId("management-summary")).toBeVisible({ timeout: 30_000 });

  let priestPlacement = page.getByTestId("management-party-place-char_priest-slot-3");
  if (await priestPlacement.count() === 0) {
    const evaluate = page.getByTestId("management-party-evaluate-recruitment");
    await expect(evaluate).toHaveCount(1);
    await expect(evaluate).toBeEnabled({ timeout: 30_000 });
    await evaluate.click();
    const evaluation = await waitForManagementResult(
      page,
      "management-party-recruitment-state",
      "management-party-error",
      "祭司招募评估",
    );
    if (evaluation.kind === "error") {
      if (evaluation.code === "RECRUITMENT_LOCKED") {
        await closeManagementPage(page);
        return;
      }
      throw new Error(`祭司招募评估失败：code=${evaluation.code}`);
    }
    await expect(page.getByTestId("management-party-recruitment-state")).toContainText("char_priest", { timeout: 10_000 });

    const confirmRecruitment = page.getByTestId("management-party-confirm-recruitment");
    await expect(confirmRecruitment).toBeVisible({ timeout: 10_000 });
    await expect(confirmRecruitment).toBeEnabled({ timeout: 10_000 });
    await confirmRecruitment.click();
    const recruited = await waitForManagementResult(
      page,
      "management-party-place-char_priest-slot-3",
      "management-party-error",
      "祭司招募确认",
    );
    if (recruited.kind === "error") {
      throw new Error(`祭司招募确认失败：code=${recruited.code}`);
    }
    priestPlacement = page.getByTestId("management-party-place-char_priest-slot-3");
  }

  await expect(priestPlacement).toHaveCount(1);
  const slot3 = page.getByTestId("management-party-slot-3");
  const hadPriestInSlot3 = (await readLocatorText(slot3)).includes("char_priest");
  if (!hadPriestInSlot3 && await priestPlacement.isEnabled()) {
    await priestPlacement.scrollIntoViewIfNeeded();
    await priestPlacement.click();
    await expect(page.getByTestId("management-party-place-char_priest-slot-3")).toBeDisabled({ timeout: 30_000 });

    const confirmParty = page.getByTestId("management-party-confirm");
    await expect(confirmParty).toBeEnabled({ timeout: 10_000 });
    await confirmParty.click();
    // 先撤销本地草稿再观察结果，避免 slot3 原本的 draft 文本把尚未完成的 CAS 误判为成功。
    const cancelParty = page.getByTestId("management-party-cancel");
    await expect(cancelParty).toBeVisible({ timeout: 10_000 });
    await cancelParty.click();
    let observedPartyError = "<missing>";
    try {
      await expect.poll(async () => {
        const error = page.getByTestId("management-party-error");
        if (await readLocatorVisible(error)) {
          const code = (await readLocatorText(error)).trim();
          observedPartyError = code.length > 0 ? code : "<empty>";
          return `error:${observedPartyError}`;
        }
        return (await readLocatorText(page.getByTestId("management-party-slot-3"))).includes("char_priest")
          ? "success"
          : "pending";
      }, { timeout: 30_000 }).toMatch(/^(success|error:.+)$/);
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
      throw new Error(`祭司编队保存等待超时：slot=3; management-party-error=${observedPartyError}; ${detail}`);
    }
    if (observedPartyError !== "<missing>") {
      throw new Error(`祭司编队保存失败：code=${observedPartyError}`);
    }
    // 取消草稿后再次读取槽位，确认刚才的 slot3 来自权威 CAS 存档而非未提交 draft。
    await expect(page.getByTestId("management-party-slot-3")).toContainText("char_priest", { timeout: 10_000 });
  }

  await closeManagementPage(page);
  const skillEntry = page.getByTestId("management-skill");
  await expect(skillEntry).toBeVisible({ timeout: 30_000 });
  await expect(skillEntry).toBeEnabled({ timeout: 30_000 });
  await skillEntry.click();
  const summary = page.getByTestId("management-summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });

  const priestCharacter = page.getByTestId("management-skill-character-char_priest");
  await expect(priestCharacter).toHaveCount(1);
  if (await priestCharacter.isEnabled()) {
    await priestCharacter.click();
    await expect(summary).toContainText("char_priest", { timeout: 10_000 });
  } else {
    await expect(summary).toContainText("char_priest", { timeout: 10_000 });
  }

  const upgrade = page.getByTestId("management-skill-upgrade-skill_priest_mend");
  await expect(upgrade).toHaveCount(1);
  if (await upgrade.isEnabled()) {
    const beforeUpgrade = (await upgrade.textContent()) ?? "";
    await upgrade.click();
    try {
      await expect.poll(async () => (await readLocatorText(upgrade)) !== beforeUpgrade ? "changed" : "pending", { timeout: 30_000 }).toBe("changed");
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
      throw new Error(`祭司技能升级未完成：skill=skill_priest_mend; button=${await readLocatorText(upgrade)}; ${detail}`);
    }
  }

  const mendEquip = page.getByTestId("management-skill-equip-skill_priest_mend");
  await expect(mendEquip).toHaveCount(1);
  const hasMendEquipped = (await readLocatorText(summary)).includes("skill_priest_mend");
  if (!hasMendEquipped && await mendEquip.isEnabled()) {
    await mendEquip.click();
    try {
      await expect.poll(async () => (await readLocatorText(summary)).includes("skill_priest_mend") ? "equipped" : "pending", { timeout: 30_000 }).toBe("equipped");
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
      throw new Error(`祭司技能装备未完成：skill=skill_priest_mend; summary=${await readLocatorText(summary)}; ${detail}`);
    }
  }
  await closeManagementPage(page);
}

async function readTestIds(page: Page, selector: string): Promise<string[]> {
  const matches = page.locator(selector);
  const ids: string[] = [];
  for (let index = 0; index < await matches.count(); index += 1) {
    const testId = await matches.nth(index).getAttribute("data-testid");
    if (testId) ids.push(testId);
  }
  return ids;
}

/**
 * 在真实城镇管理页做一轮装备决策，再通过旅店恢复队伍。
 * 每次点击前后都重新查询 locator，避免管理页重绘造成 detached handle。
 */
export async function prepareTownLoadoutAndRest(page: Page): Promise<void> {
  await waitForTownReady(page);
  await prepareTownRosterAndSkills(page);
  const inventoryEntry = page.getByTestId("management-inventory");
  await expect(inventoryEntry).toBeVisible({ timeout: 30_000 });
  await expect(inventoryEntry).toBeEnabled({ timeout: 30_000 });
  await inventoryEntry.click();
  await expect(page.getByTestId("management-summary")).toBeVisible({ timeout: 30_000 });

  const itemIds = (await readTestIds(page, '[data-testid^="management-inventory-select-"]'))
    .filter((testId) => testId !== "management-inventory-select-first");
  const inventoryError = page.getByTestId("management-inventory-error");
  const waitForEquipmentResult = async (
    itemId: string,
    equipId: string,
  ): Promise<"success" | "affix-conflict"> => {
    let observedErrorCode = "<missing>";
    try {
      await expect.poll(async () => {
        // 先读可见错误；失败候选的按钮可能仍保留在页面，不能把它误判为成功。
        if (await readLocatorVisible(inventoryError)) {
          const code = (await readLocatorText(inventoryError)).trim();
          observedErrorCode = code.length > 0 ? code : "<empty>";
          return `error:${observedErrorCode}`;
        }
        // 保存成功后的管理页会重绘，必须按 test id 重新取按钮再判断 disabled。
        if (await readLocatorDisabled(page.getByTestId(equipId)) === "true") return "success";
        return "pending";
      }, { timeout: 30_000 }).toMatch(/^(success|error:.+)$/);
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "UNKNOWN_EXCEPTION";
      throw new Error(
        `装备操作等待超时：itemId=${itemId}; equipId=${equipId}; `
        + `management-inventory-error=${observedErrorCode}; ${detail}`,
      );
    }
    if (observedErrorCode === "AFFIX_CONFLICT") return "affix-conflict";
    if (observedErrorCode !== "<missing>") {
      throw new Error(`装备操作失败：itemId=${itemId}; equipId=${equipId}; code=${observedErrorCode}`);
    }
    return "success";
  };
  for (const itemId of itemIds) {
    // 选择按钮和保存后的管理页都可能被重绘；只保留字符串 ID，不持有节点句柄。
    const selector = page.getByTestId(itemId);
    if (await selector.count() === 0) continue;
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await selector.scrollIntoViewIfNeeded();
    await selector.click();
    await expect(page.getByTestId("management-inventory-detail")).toBeVisible({ timeout: 10_000 });

    const equipIds = await readTestIds(page, '[data-testid^="management-inventory-equip-"]');
    for (const equipId of equipIds) {
      const characterId = equipId.slice("management-inventory-equip-".length);
      const compare = page.getByTestId(`management-inventory-compare-${characterId}`);
      const equip = page.getByTestId(equipId);
      if (await compare.count() === 0 || await equip.count() === 0) continue;
      const compareText = (await compare.textContent()) ?? "";
      // 只消费页面可见的明确正向静态差值，不解析存档也不猜测机制词条收益。
      if (!/\+\s*\d+/.test(compareText) || !(await equip.isVisible()) || !(await equip.isEnabled())) continue;
      await equip.scrollIntoViewIfNeeded();
      await equip.click();
      const result = await waitForEquipmentResult(itemId, equipId);
      if (result === "affix-conflict") {
        // AFFIX_CONFLICT 是当前选择的合法冲突；重新通过真实 selectItem
        // 清理 Screen 错误态后，再尝试同一装备的下一个角色。
        await selector.click();
        await expect(page.getByTestId("management-inventory-detail")).toBeVisible({ timeout: 10_000 });
        continue;
      }
      break;
    }
  }

  const closeInventory = page.getByTestId("return-town");
  await expect(closeInventory).toBeVisible({ timeout: 30_000 });
  await closeInventory.click();
  await waitForTownReady(page);

  const inn = page.getByTestId("npc-npc_innkeeper");
  await expect(inn).toBeVisible({ timeout: 30_000 });
  await expect(inn).toBeEnabled({ timeout: 30_000 });
  await inn.click();
  await expect(page.getByTestId("npc-route-status")).toContainText("旅店：队伍已恢复", { timeout: 30_000 });
  const closeNpc = page.getByTestId("close-npc-panel");
  if (await closeNpc.count() > 0) {
    await closeNpc.click();
  }
  await waitForTownReady(page);
}

/** 真实训练指定楼层的一场普通遭遇，结束远征后才允许回城管理。 */
export async function trainFloorEncounter(page: Page, floorNumber: number): Promise<void> {
  await enterFloor(page, floorNumber);
  const autoEncounter = page.getByTestId("auto-encounter");
  await expect(autoEncounter).toBeVisible({ timeout: 30_000 });
  await expect(autoEncounter).toBeEnabled({ timeout: 30_000 });
  await autoEncounter.click();
  await waitForAutoEncounterBattle(page, `floor${floorNumber}-training`);
  const outcome = await playCurrentBattleAndClaim(page);
  if (outcome !== "victory") throw new Error(`楼层 ${floorNumber} 训练遭遇战败，未伪造训练收益`);
  await returnRetainedExpedition(page);
  await prepareTownLoadoutAndRest(page);
}

/** 旧的首层训练入口保留给已有 E2E，核心逻辑统一走可指定楼层的 helper。 */
export async function trainFirstFloorEncounter(page: Page): Promise<void> {
  await trainFloorEncounter(page, 1);
}

export async function clearFloorThroughBoss(page: Page, floorNumber: number): Promise<BattleOutcome> {
  await enterFloor(page, floorNumber);
  // 当前正式地图固定为 8 normal + 2 elite + 1 boss；宝箱由玩家交互，不计入遭遇序列。
  for (let encounter = 0; encounter < 11; encounter += 1) {
    const autoEncounter = page.getByTestId("auto-encounter");
    await expect(autoEncounter).toBeVisible({ timeout: 30_000 });
    await expect(autoEncounter).toBeEnabled({ timeout: 30_000 });
    await autoEncounter.click();
    await waitForAutoEncounterBattle(page, `floor${floorNumber}-encounter${encounter + 1}`);
    const outcome = await playCurrentBattleAndClaim(page);
    if (outcome === "defeat") {
      await waitForTownReady(page);
      return "defeat";
    }

    // 只有第 11 场是 Boss。领奖后明确结束远征回城，再检查下一层入口。
    if (encounter === 10) {
      await returnRetainedExpedition(page);
      if (floorNumber < 10) {
        const nextFloorId = `floor_${String(floorNumber + 1).padStart(2, "0")}`;
        const nextEntry = page.getByTestId(`enter-floor-${nextFloorId}-exploration`);
        await expect(nextEntry).toBeVisible({ timeout: 30_000 });
        await expect(nextEntry).toBeEnabled({ timeout: 30_000 });
      } else {
        const echoButtons = page.locator('[data-testid^="enter-abyss-echo-"]');
        await expect.poll(async () => await echoButtons.count(), { timeout: 30_000 }).toBeGreaterThan(0);
        await expect.poll(async () => {
          for (let index = 0; index < await echoButtons.count(); index += 1) {
            if (await echoButtons.nth(index).isEnabled()) return true;
          }
          return false;
        }, { timeout: 30_000 }).toBe(true);
      }
      return "victory";
    }

    await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 10_000 });

    // 野外药水按钮只在探索态投影；继续远征回到地图后，按真实按钮循环治疗至不可用。
    const fieldPotion = page.getByTestId("field-potion");
    const fieldPotionError = page.getByTestId("field-potion-error");
    for (let potionAttempt = 0; potionAttempt < 16; potionAttempt += 1) {
      if (await fieldPotion.count() === 0 || !(await fieldPotion.isEnabled())) break;
      const beforePotionText = await fieldPotion.textContent();
      await fieldPotion.click();
      await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 10_000 });
      let completion: "changed" | "error" | null = null;
      await expect.poll(async (): Promise<"changed" | "error" | "pending"> => {
        if (await fieldPotionError.count() > 0 && await fieldPotionError.isVisible()) {
          completion = "error";
          return "error";
        }
        if (await fieldPotion.count() === 0) {
          completion = "changed";
          return "changed";
        }
        const afterPotionText = await fieldPotion.textContent();
        if (afterPotionText !== beforePotionText) {
          completion = "changed";
          return "changed";
        }
        return "pending";
      }, { timeout: 10_000 }).toMatch(/^(changed|error)$/);
      if (completion === "error") {
        throw new Error(`楼层 ${floorNumber} 野外药水提交失败`);
      }
    }
    if (await fieldPotion.count() > 0 && await fieldPotion.isEnabled()) {
      throw new Error(`楼层 ${floorNumber} 野外药水连续提交未收口`);
    }
  }
  throw new Error(`楼层 ${floorNumber} 在限定遭遇次数内未完成 Boss 首通`);
}
