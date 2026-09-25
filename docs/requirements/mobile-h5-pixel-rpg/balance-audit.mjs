import assert from 'node:assert/strict'

// 这是开工前的静态门禁；实现后必须改用真实 ContentCatalog 驱动的无渲染模拟。
const normalRounds = [1.9, 1.9, 2.4, 3.6, 4.2, 2.4, 2.7, 2.5, 3.0, 2.7]
const eliteRounds = [2.9, 4.5, 5.3, 4.8, 5.9, 6.3, 5.4, 7.7, 5.2, 8.6]
const enrageRounds = [12, 11, 12, 14, 11, 12, 13, 14, 11, 14]
const laggingRounds = [9.4, 12.3, 13.4, 15.8, 12.6, 13.3, 14.4, 15.1, 12.3, 19.6]
const readyRounds = [7.1, 9.1, 10.0, 12.3, 9.6, 10.6, 11.5, 12.2, 9.9, 16.1]
const effectiveBossHp = [3194, 5418, 7316, 11227, 10500, 13000, 16675, 18910, 18000, 31003]

const breakthroughRounds = readyRounds.map((rounds) => Number((rounds / 1.35).toFixed(1)))

for (const rounds of normalRounds) assert.ok(rounds >= 1.8 && rounds <= 4.5)
for (const rounds of eliteRounds) assert.ok(rounds >= 2.8 && rounds <= 8.8)
for (let index = 1; index <= 8; index += 1) {
  assert.ok(laggingRounds[index] >= enrageRounds[index], `第 ${index + 1} 层落后档未卡住`)
  assert.ok(readyRounds[index] < enrageRounds[index], `第 ${index + 1} 层整备档未过门槛`)
}
assert.ok(readyRounds[9] >= enrageRounds[9], '第 10 层整备档应进入狂暴')
assert.ok(breakthroughRounds[9] < enrageRounds[9], '第 10 层突破档应在狂暴前结束')

const normalXp = [45, 80, 125, 180, 250, 340, 450, 590, 760, 960]
const eliteXp = [130, 230, 360, 520, 720, 980, 1300, 1700, 2200, 2800]
const bossXp = [450, 800, 1200, 1700, 2300, 3100, 4100, 5300, 6800, 8600]
const fullClearXp = normalXp.map((value, index) => value * 8 + eliteXp[index] * 2 + bossXp[index])
assert.deepEqual(fullClearXp, [1070, 1900, 2920, 4180, 5740, 7780, 10300, 13420, 17280, 21880])

const normalGold = [18, 35, 55, 80, 110, 150, 200, 260, 335, 420]
const eliteGold = [60, 105, 165, 240, 330, 450, 600, 780, 1000, 1260]
const bossGold = [250, 450, 700, 1000, 1350, 1850, 2450, 3200, 4100, 5200]
const fullClearGold = normalGold.map((value, index) => value * 8 + eliteGold[index] * 2 + bossGold[index])
assert.deepEqual(fullClearGold, [514, 940, 1470, 2120, 2890, 3950, 5250, 6840, 8780, 11080])
assert.equal(200 + fullClearGold.reduce((sum, value) => sum + value, 0), 44034)

const expectedPreBossEquipment = 8 * 0.35 + 2 * 1.2 + 3
const expectedShortFarmEquipment = 3 * 0.35 + 1.2 + 1
const expectedNormalMaterials = 8 * 0.7 * 1.5 + 2 * 1.5 + 3 * 1.5
const expectedAbyssMaterials = 8 * 0.7 * 3 + 2 * 3 + 3 * 3
assert.equal(expectedPreBossEquipment, 8.2)
assert.equal(expectedShortFarmEquipment, 3.25)
assert.ok(Math.abs(expectedNormalMaterials - 15.9) < 1e-9)
assert.ok(Math.abs(expectedAbyssMaterials - 31.8) < 1e-9)

// 1.2 新增表只做结构/边界静态门禁；真实战斗强度仍由 6800 场正式模拟确认。
const encounterModifierIds = [
  'modifier_assault',
  'modifier_swift',
  'modifier_bulwark',
  'modifier_mire',
  'modifier_abyss_execution',
  'modifier_abyss_fortress',
  'modifier_abyss_pressure',
  'modifier_abyss_suppression',
]
assert.equal(new Set(encounterModifierIds).size, 8)

const echoRows = [
  [6, 11500, 11000, 10000, 10000, -1, 2, 11, 2, 0, 800, 10, 10],
  [6, 12000, 11500, 10500, 10000, -1, 1, 12, 0, 1, 1200, 12, 12],
  [7, 11500, 11500, 10000, 10500, -1, 2, 12, 2, 0, 1000, 12, 12],
  [7, 12500, 12000, 10500, 10500, -2, 1, 13, 0, 1, 1400, 14, 14],
  [8, 12000, 11000, 11500, 10000, -1, 2, 13, 2, 0, 1200, 14, 14],
  [8, 12500, 11500, 12000, 10500, -2, 0, 14, 1, 1, 1600, 16, 16],
  [9, 11500, 11500, 10000, 11500, -1, 2, 10, 2, 0, 1400, 16, 16],
  [9, 12500, 12000, 10500, 12000, -2, 1, 11, 0, 1, 1800, 18, 18],
  [10, 12000, 11500, 11000, 10500, -1, 2, 13, 2, 1, 1800, 20, 20],
  [10, 13000, 12000, 11500, 11000, -2, 0, 14, 0, 1, 2200, 25, 25],
]
assert.equal(echoRows.length, 10)
for (const [floor, hp, attack, defense, speed, delta, itemLimit, maxRounds, maxKnockouts, anyCombo, bonus, forge, dust] of echoRows) {
  assert.ok(floor >= 6 && floor <= 10)
  for (const multiplier of [hp, attack, defense, speed]) assert.ok(multiplier >= 10000 && multiplier <= 15000)
  assert.ok(delta === -1 || delta === -2)
  assert.ok(itemLimit >= 0 && itemLimit <= 2)
  assert.ok(maxRounds >= 1 && maxKnockouts >= 0)
  assert.ok(anyCombo === 0 || anyCombo === 1)
  assert.ok(bonus >= 0 && bonus <= 5000)
  assert.ok(forge >= 0 && dust >= 0)
}

const audit = effectiveBossHp.map((hp, index) => ({
  floor: index + 1,
  enrage: enrageRounds[index],
  lagging: laggingRounds[index],
  ready: readyRounds[index],
  breakthrough: breakthroughRounds[index],
  effectiveBossHp: hp,
}))

console.table(audit)
console.log('静态平衡门禁通过：普通/精英时长、层主三档、XP、金币、完整/短程掉落期望及 1.2 修正/回响边界均一致。')
