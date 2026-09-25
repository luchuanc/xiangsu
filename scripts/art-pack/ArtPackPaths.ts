import { promises as fs } from "node:fs";
import path from "node:path";
import { ArtPackError } from "./ArtPackSchema";

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** 检查根目录、目标及所有已存在祖先，拒绝 symlink 越界。 */
export async function assertContainedPath(root: string, target: string): Promise<void> {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (!isWithin(absoluteRoot, absoluteTarget)) throw new ArtPackError("ART_PACK_PATH_INVALID", absoluteTarget);
  let cursor = absoluteTarget;
  let firstExisting: string | undefined;
  let firstExistingIsDirectory = false;
  while (true) {
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw new ArtPackError("ART_PACK_PATH_SYMLINK", cursor);
      firstExisting = cursor;
      firstExistingIsDirectory = stat.isDirectory();
      break;
    } catch (error) {
      if (error instanceof ArtPackError) throw error;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOTDIR") throw new ArtPackError("ART_PACK_PATH_INVALID", cursor);
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new ArtPackError("ART_PACK_PATH_INVALID", cursor);
      cursor = parent;
    }
  }
  // 目标本身可以是待替换的文件，但向下创建时最近祖先必须是目录。
  if (firstExisting !== absoluteTarget && !firstExistingIsDirectory) throw new ArtPackError("ART_PACK_PATH_INVALID", firstExisting ?? absoluteTarget);
  let realRoot: string;
  let realExisting: string;
  try {
    realRoot = await fs.realpath(absoluteRoot);
    realExisting = await fs.realpath(firstExisting);
  } catch {
    throw new ArtPackError("ART_PACK_PATH_INVALID", absoluteRoot);
  }
  if (!isWithin(realRoot, realExisting)) throw new ArtPackError("ART_PACK_PATH_SYMLINK", firstExisting);
  if (firstExisting !== absoluteTarget) {
    const projected = path.resolve(realExisting, path.relative(firstExisting, absoluteTarget));
    if (!isWithin(realRoot, projected)) throw new ArtPackError("ART_PACK_PATH_SYMLINK", absoluteTarget);
  }
}

export async function assertContainedFile(root: string, target: string, missingCode: string, invalidCode: string = "ART_PACK_PATH_INVALID"): Promise<void> {
  await assertContainedPath(root, target);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new ArtPackError(missingCode, target);
  }
  if (stat.isSymbolicLink()) throw new ArtPackError("ART_PACK_PATH_SYMLINK", target);
  if (!stat.isFile()) throw new ArtPackError(invalidCode, target);
}

export async function assertContainedDirectory(root: string, target: string): Promise<void> {
  await assertContainedPath(root, target);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) throw new ArtPackError("ART_PACK_PATH_SYMLINK", target);
  if (!stat.isDirectory()) throw new ArtPackError("ART_PACK_PATH_INVALID", target);
}
