import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("src/dashboard/public");
const targetDir = path.resolve("dist/dashboard/public");
const assetSourceDir = path.resolve("src/assets");
const assetTargetDir = path.resolve("dist/assets");

copyDirectory(sourceDir, targetDir);
if (existsSync(assetSourceDir)) {
  copyDirectory(assetSourceDir, assetTargetDir);
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`dashboard asset source missing: ${source}`);
  }
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source)) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    if (statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    copyFileSync(sourcePath, targetPath);
  }
}
