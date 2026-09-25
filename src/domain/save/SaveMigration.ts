/**
 * 存档版本门禁。
 *
 * v1 只有一个可读取注册项。门禁阶段只能查看顶层版本字段；未知版本不
 * 尝试猜测业务字段，也不把原始记录改写成当前结构。
 */
import type { ContentRootV1, GameSaveV1 } from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { validateGameSave } from "./GameSave";

export const SUPPORTED_SAVE_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_CONTENT_VERSION = "content-1.2.0" as const;

type RawSaveHeader = { schemaVersion: number; contentVersion: string };

function readHeader(raw: unknown): RawSaveHeader {
  if (typeof raw !== "object" || raw === null) {
    return { schemaVersion: -1, contentVersion: "unknown" };
  }
  const record = raw as Record<string, unknown>;
  return {
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : -1,
    contentVersion: typeof record.contentVersion === "string" ? record.contentVersion : "unknown",
  };
}

/** 只检查版本头，不读取其他业务字段。 */
export function inspectSaveVersion(raw: unknown): DomainResult<RawSaveHeader> {
  const header = readHeader(raw);
  if (header.schemaVersion !== SUPPORTED_SAVE_SCHEMA_VERSION || header.contentVersion !== SUPPORTED_CONTENT_VERSION) {
    return failure(createDomainError("UNSUPPORTED_SAVE_VERSION", header));
  }
  return success(header);
}

/** 迁移注册表入口：当前版本只做 strict parse，不提供猜测式旧字段转换。 */
export function migrateSave(raw: unknown, content?: ContentRootV1): DomainResult<GameSaveV1> {
  const version = inspectSaveVersion(raw);
  if (!version.ok) return version;
  return validateGameSave(raw, content);
}

export function isSupportedSave(raw: unknown): raw is GameSaveV1 {
  return migrateSave(raw).ok;
}
