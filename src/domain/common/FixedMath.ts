/** 统一校验领域层只能持久化整数。 */
export function assertInteger(value: number, name = "value"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} 必须是安全整数`);
  }
}

/** 将整数钳制到闭区间，禁止隐式修正非法边界。 */
export function clampInt(value: number, min: number, max: number): number {
  assertInteger(value, "value");
  assertInteger(min, "min");
  assertInteger(max, "max");
  if (min > max) {
    throw new RangeError("clampInt 要求 min 不大于 max");
  }

  return Math.min(max, Math.max(min, value));
}

/** 计算数学意义上的向下整除，负数不会向零截断。 */
export function floorDiv(numerator: number, denominator: number): number {
  assertInteger(numerator, "numerator");
  assertInteger(denominator, "denominator");
  if (denominator === 0) {
    throw new RangeError("整除分母不能为 0");
  }

  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator % denominator;
  if (remainder !== 0 && (remainder > 0) !== (denominator > 0)) {
    return quotient - 1;
  }

  return quotient;
}

/** 计算数学意义上的向上整除，负数不会向零截断。 */
export function ceilDiv(numerator: number, denominator: number): number {
  assertInteger(numerator, "numerator");
  assertInteger(denominator, "denominator");
  if (denominator === 0) {
    throw new RangeError("整除分母不能为 0");
  }

  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator % denominator;
  if (remainder !== 0 && (remainder > 0) === (denominator > 0)) {
    return quotient + 1;
  }

  return quotient;
}

/** 对 basis point 做精确向下乘法，使用 BigInt 避免中间值浮点化。 */
export function mulBpsFloor(value: number, bps: number): number {
  assertInteger(value, "value");
  assertInteger(bps, "bps");

  const product = BigInt(value) * BigInt(bps);
  const denominator = 10_000n;
  let quotient = product / denominator;
  const remainder = product % denominator;
  if (remainder !== 0n && product < 0n) {
    quotient -= 1n;
  }

  const result = Number(quotient);
  assertInteger(result, "result");
  return result;
}
