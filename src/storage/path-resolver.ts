import path from "node:path";

export type StoragePathResolver = {
  storageRoot: string | null;
  toStoredPath: (filePath: string | null) => string | null;
  resolveStoredPath: (filePath: string | null) => string | null;
};

export function createStoragePathResolver(
  storageRoot?: string | null,
): StoragePathResolver {
  const root = storageRoot ? path.resolve(storageRoot) : null;

  return {
    storageRoot: root,
    toStoredPath: (filePath) => toStoredPath(root, filePath),
    resolveStoredPath: (filePath) => resolveStoredPath(root, filePath),
  };
}

export function toStoredPath(
  storageRoot: string | null,
  filePath: string | null,
): string | null {
  if (!filePath || !storageRoot) {
    return filePath;
  }

  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(storageRoot, absolutePath);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return normalizeStoredSeparators(relativePath || ".");
  }
  return filePath;
}

export function resolveStoredPath(
  storageRoot: string | null,
  filePath: string | null,
): string | null {
  if (!filePath || !storageRoot || path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(storageRoot, filePath);
}

function normalizeStoredSeparators(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
