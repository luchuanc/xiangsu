/**
 * 单槽 IndexedDB 存档仓库。
 *
 * revision CAS 的读取、比较和 put 必须位于同一个 readwrite transaction；
 * 只有 transaction.oncomplete 才向上层报告成功，不能以 request.onsuccess
 * 代替事务提交。仓库不删除数据库，测试也只能注入测试数据库名。
 */
import type { ContentRootV1, GameSaveV1 } from "../../content/contracts";
import type { Clock } from "../common/DomainContext";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { migrateSave, SUPPORTED_CONTENT_VERSION, SUPPORTED_SAVE_SCHEMA_VERSION } from "./SaveMigration";
import { validateGameSave } from "./GameSave";

export const SAVE_DATABASE_NAME = "affix_abyss_game";
export const SAVE_STORE_NAME = "save_slots";
export const SAVE_SLOT_KEY = "slot_1";
export const SAVE_DATABASE_VERSION = 1;

type SaveOperation = "create" | "load" | "save" | "replace";

export interface IndexedDbSaveRepositoryOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  clock?: Clock;
  content?: ContentRootV1;
}

function failureFor(operation: SaveOperation): ReturnType<typeof failure> {
  return failure(createDomainError("SAVE_FAILED", { operation }));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getActualRevision(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return 0;
  const revision = (raw as Record<string, unknown>).revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 1 ? revision : 0;
}

/** 将 IDB transaction 的完成/失败统一收口，避免 request 成功早于提交。 */
function waitForTransaction(
  transaction: IDBTransaction,
  getResult: () => DomainResult<GameSaveV1>,
  getAbortResult: () => DomainResult<GameSaveV1>,
): Promise<DomainResult<GameSaveV1>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DomainResult<GameSaveV1>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    transaction.oncomplete = () => finish(getResult());
    transaction.onerror = () => finish(getAbortResult());
    transaction.onabort = () => finish(getAbortResult());
  });
}

export class IndexedDbSaveRepository {
  private readonly indexedDB: IDBFactory | undefined;
  private readonly databaseName: string;
  private readonly clock: Clock;
  private readonly content: ContentRootV1 | undefined;
  private database: IDBDatabase | null = null;
  private opening: Promise<DomainResult<void>> | null = null;

  public constructor(options: IndexedDbSaveRepositoryOptions = {}) {
    this.indexedDB = options.indexedDB ?? globalThis.indexedDB;
    this.databaseName = options.databaseName ?? SAVE_DATABASE_NAME;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.content = options.content;
  }

  public async open(): Promise<DomainResult<void>> {
    if (this.database) return success(undefined);
    if (this.opening) return this.opening;
    if (!this.indexedDB) return failureFor("create") as DomainResult<void>;

    this.opening = new Promise<DomainResult<void>>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDB!.open(this.databaseName, SAVE_DATABASE_VERSION);
      } catch {
        resolve(failureFor("create") as DomainResult<void>);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        // 升级只创建当前契约声明的 store，不删除其他应用数据。
        if (!database.objectStoreNames.contains(SAVE_STORE_NAME)) {
          database.createObjectStore(SAVE_STORE_NAME);
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => this.close();
        resolve(success(undefined));
      };
      request.onerror = () => resolve(failureFor("create") as DomainResult<void>);
      request.onblocked = () => resolve(failureFor("create") as DomainResult<void>);
    });
    const result = await this.opening;
    this.opening = null;
    return result;
  }

  public close(): void {
    this.database?.close();
    this.database = null;
  }

  public async get(): Promise<DomainResult<GameSaveV1 | null>> {
    const opened = await this.open();
    if (!opened.ok) return failureFor("load") as DomainResult<GameSaveV1 | null>;
    if (!this.database) return failureFor("load") as DomainResult<GameSaveV1 | null>;

    let raw: unknown = null;
    let result: DomainResult<GameSaveV1 | null> = success(null);
    let transaction: IDBTransaction;
    try {
      transaction = this.database.transaction(SAVE_STORE_NAME, "readonly");
      const request = transaction.objectStore(SAVE_STORE_NAME).get(SAVE_SLOT_KEY);
      request.onsuccess = () => {
        raw = request.result;
        if (raw === undefined) {
          result = success(null);
          return;
        }
        const migrated = migrateSave(raw, this.content);
        result = migrated.ok ? success(migrated.value) : migrated;
      };
      request.onerror = () => { result = failureFor("load") as DomainResult<GameSaveV1 | null>; };
    } catch {
      return failureFor("load") as DomainResult<GameSaveV1 | null>;
    }
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    return result;
  }

  /**
   * 在一个 readwrite transaction 中按数据库实际 revision 做 CAS。
   * 空槽只接受 expectedRevision=0；成功首写 revision=1。
   */
  public async save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    const opened = await this.open();
    if (!opened.ok) return failureFor("save");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return failureFor("save");
    const candidate = validateGameSave(nextSave, this.content);
    if (!candidate.ok) return candidate;
    if (!this.database) return failureFor("save");

    let transaction: IDBTransaction;
    let result: DomainResult<GameSaveV1> | null = null;
    let abortedResult: DomainResult<GameSaveV1> | null = null;
    try {
      transaction = this.database.transaction(SAVE_STORE_NAME, "readwrite");
      const objectStore = transaction.objectStore(SAVE_STORE_NAME);
      const readRequest = objectStore.get(SAVE_SLOT_KEY);
      readRequest.onsuccess = () => {
        const raw = readRequest.result;
        let actualRevision = 0;
        if (raw !== undefined) {
          const migrated = migrateSave(raw, this.content);
          if (!migrated.ok) {
            abortedResult = migrated;
            transaction.abort();
            return;
          }
          actualRevision = migrated.value.revision;
        }
        if (actualRevision !== expectedRevision) {
          abortedResult = failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
          transaction.abort();
          return;
        }
        const persisted: GameSaveV1 = {
          ...clone(candidate.value),
          schemaVersion: SUPPORTED_SAVE_SCHEMA_VERSION,
          contentVersion: SUPPORTED_CONTENT_VERSION,
          saveId: SAVE_SLOT_KEY,
          revision: actualRevision + 1,
          updatedAt: this.clock.now(),
        };
        const parsed = validateGameSave(persisted, this.content);
        if (!parsed.ok) {
          abortedResult = parsed;
          transaction.abort();
          return;
        }
        const writeRequest = objectStore.put(parsed.value, SAVE_SLOT_KEY);
        writeRequest.onerror = () => {
          abortedResult = failureFor("save");
          transaction.abort();
        };
        result = success(parsed.value);
      };
      readRequest.onerror = () => {
        abortedResult = failureFor("save");
        transaction.abort();
      };
    } catch {
      return failureFor("save");
    }
    return waitForTransaction(transaction, () => result ?? failureFor("save"), () => abortedResult ?? failureFor("save"));
  }

  /**
   * 覆盖入口本身不承担 UI 确认，只在调用方已完成确认后强制替换 slot_1。
   * 它与 CAS save 分离，避免把确认语义藏在 repository 中。
   */
  public async replaceAfterConfirmation(nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    const opened = await this.open();
    if (!opened.ok) return failureFor("replace");
    const candidate = validateGameSave(nextSave, this.content);
    if (!candidate.ok) return candidate;
    if (!this.database) return failureFor("replace");
    let transaction: IDBTransaction;
    const result: DomainResult<GameSaveV1> | null = success(candidate.value);
    let abortedResult: DomainResult<GameSaveV1> | null = null;
    try {
      transaction = this.database.transaction(SAVE_STORE_NAME, "readwrite");
      const request = transaction.objectStore(SAVE_STORE_NAME).put(clone(candidate.value), SAVE_SLOT_KEY);
      request.onerror = () => {
        abortedResult = failureFor("replace");
        transaction.abort();
      };
    } catch {
      return failureFor("replace");
    }
    return waitForTransaction(transaction, () => result ?? failureFor("replace"), () => abortedResult ?? failureFor("replace"));
  }

  /** 只读暴露当前配置，便于 UI 将数据库状态与当前槽位绑定。 */
  public get name(): string {
    return this.databaseName;
  }
}

/** 避免未使用的纯函数在编译时被误认为是版本兼容逻辑。 */
export function readStoredRevision(raw: unknown): number {
  return getActualRevision(raw);
}
