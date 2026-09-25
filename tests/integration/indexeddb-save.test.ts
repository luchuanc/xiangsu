import { describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import { fixtureContentRoot } from "../../src/content/data";
import {
  IndexedDbSaveRepository,
  SAVE_SLOT_KEY,
  SAVE_STORE_NAME,
} from "../../src/domain/save/IndexedDbSaveRepository";
import { createNewGameSave } from "../../src/domain/save/GameSave";

const timestamp = "2026-08-21T00:00:00.000Z";
const content = fixtureContentRoot;

function repository(name: string) {
  return new IndexedDbSaveRepository({
    indexedDB,
    databaseName: name,
    content,
    clock: { now: () => "2026-08-21T00:00:01.000Z" },
  });
}

async function putRaw(name: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SAVE_STORE_NAME)) request.result.createObjectStore(SAVE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SAVE_STORE_NAME, "readwrite");
    transaction.objectStore(SAVE_STORE_NAME).put(value, SAVE_SLOT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

describe("IndexedDbSaveRepository", () => {
  it("commits revision in one transaction and rejects stale multi-tab writes", async () => {
    const name = `save-cas-${Date.now()}-a`;
    const first = repository(name);
    const second = repository(name);
    const initial = createNewGameSave(content, timestamp);

    expect((await first.save(0, initial)).ok).toBe(true);
    const loadedByFirst = await first.get();
    const loadedBySecond = await second.get();
    expect(loadedByFirst.ok && loadedByFirst.value?.revision).toBe(1);
    expect(loadedBySecond.ok && loadedBySecond.value?.revision).toBe(1);
    if (!loadedByFirst.ok || !loadedByFirst.value || !loadedBySecond.ok || !loadedBySecond.value) throw new Error("save missing");

    const next = structuredClone(loadedByFirst.value);
    next.gold = 201;
    const committed = await first.save(1, next);
    expect(committed.ok && committed.value.revision).toBe(2);

    const stale = structuredClone(loadedBySecond.value);
    stale.gold = 999;
    const rejected = await second.save(1, stale);
    expect(rejected).toEqual({ ok: false, error: { code: "STALE_REVISION", details: { expectedRevision: 1, actualRevision: 2 } } });

    const authoritative = await first.get();
    expect(authoritative.ok && authoritative.value?.gold).toBe(201);
    first.close();
    second.close();
  });

  it("blocks unknown versions without reading business fields or overwriting the raw record", async () => {
    const name = `save-version-${Date.now()}-b`;
    const unknown = { schemaVersion: 99, contentVersion: "content-9.9.9", gold: 777, unknownBusiness: true };
    await putRaw(name, unknown);
    const repo = repository(name);

    const loaded = await repo.get();
    expect(loaded).toEqual({ ok: false, error: { code: "UNSUPPORTED_SAVE_VERSION", details: { schemaVersion: 99, contentVersion: "content-9.9.9" } } });
    const attempted = await repo.save(0, createNewGameSave(content, timestamp));
    expect(attempted).toEqual(loaded);

    const rawAfter = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(SAVE_STORE_NAME, "readonly");
        const read = transaction.objectStore(SAVE_STORE_NAME).get(SAVE_SLOT_KEY);
        read.onsuccess = () => { resolve(read.result); db.close(); };
        read.onerror = () => reject(read.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(rawAfter).toEqual(unknown);
    repo.close();
  });

  it("uses an explicit replacement path for a confirmed overwrite", async () => {
    const name = `save-replace-${Date.now()}-c`;
    const repo = repository(name);
    const replacement = createNewGameSave(content, timestamp);
    replacement.gold = 321;
    const result = await repo.replaceAfterConfirmation(replacement);
    expect(result.ok && result.value.gold).toBe(321);
    const loaded = await repo.get();
    expect(loaded.ok && loaded.value?.revision).toBe(1);
    repo.close();
  });
});
