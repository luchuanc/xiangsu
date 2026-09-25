import { describe, expect, it } from "vitest";

import { assertFrozenBlueprint, buildAllMapBlueprints, buildMapBlueprint, collisionHash, type MapBlueprint } from "../../src/content/builders/mapBlueprint";

function cloneBlueprint(blueprint: MapBlueprint): MapBlueprint {
  return {
    ...blueprint,
    collisionLayer: [...blueprint.collisionLayer],
    validation: {
      anchors: Object.fromEntries(Object.entries(blueprint.validation.anchors).map(([key, point]) => [key, { ...point }])),
      routePaths: blueprint.validation.routePaths.map((path) => [...path]),
    },
  };
}

describe("map blueprint", () => {
  it("uses the standard SHA-256 byte encoding without Node-only APIs", () => {
    expect(collisionHash([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(collisionHash([0])).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    );
  });

  it("builds the frozen collision dimensions and hashes", () => {
    const town = buildMapBlueprint("map_town");
    expect(town.collisionLayer).toHaveLength(80 * 60);
    expect(town.walkableTiles).toBe(3266);
    expect(collisionHash(town.collisionLayer)).toBe(
      "bf421d7a56f0afb60dfb2a5c72f3ccf5233d2d540a11bde32fe1ea748a7754de",
    );
  });

  it("rejects a collision layer byte mutation", () => {
    const floor = buildMapBlueprint("map_floor_01");
    const mutated = [...floor.collisionLayer] as Array<0 | 1>;
    mutated[mutated.findIndex((value) => value === 0)] = 1;
    expect(collisionHash(mutated)).not.toBe(floor.collisionSha256);
  });

  it("matches all eleven frozen collision snapshots", () => {
    for (const blueprint of buildAllMapBlueprints()) assertFrozenBlueprint(blueprint);
  });

  it("rejects route edge and bend-order mutations", () => {
    const edgeMutation = cloneBlueprint(buildMapBlueprint("map_floor_01"));
    edgeMutation.validation = { ...edgeMutation.validation, routePaths: edgeMutation.validation.routePaths.map((route, index) => index === 0 ? route.filter((node) => node !== "N3") : route) };
    expect(() => assertFrozenBlueprint(edgeMutation)).toThrow(/路径定义/);

    const bendMutation = cloneBlueprint(buildMapBlueprint("map_floor_01"));
    const branch = [...bendMutation.validation.routePaths[1]];
    [branch[1], branch[2]] = [branch[2], branch[1]];
    bendMutation.validation = { ...bendMutation.validation, routePaths: bendMutation.validation.routePaths.map((route, index) => index === 1 ? branch : route) };
    expect(() => assertFrozenBlueprint(bendMutation)).toThrow(/路径定义/);
  });

  it("rejects an anchor moved away from the walkable graph", () => {
    const mutation = cloneBlueprint(buildMapBlueprint("map_floor_01"));
    mutation.validation = { ...mutation.validation, anchors: { ...mutation.validation.anchors, C1: { x: 0, y: 0 } } };
    expect(() => assertFrozenBlueprint(mutation)).toThrow(/锚点不可达/);
  });

  it("rejects a collision byte even if the caller recomputes derived fields", () => {
    const mutation = cloneBlueprint(buildMapBlueprint("map_floor_01"));
    const walkableIndex = mutation.collisionLayer.findIndex((value) => value === 0);
    mutation.collisionLayer[walkableIndex] = 1;
    mutation.walkableTiles -= 1;
    mutation.collisionSha256 = collisionHash(mutation.collisionLayer);
    expect(() => assertFrozenBlueprint(mutation)).toThrow(/快照/);
  });
});
