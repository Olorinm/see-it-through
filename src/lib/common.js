import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readText(path) {
  return readFile(path, "utf8");
}

export async function writeJson(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, value, "utf8");
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function slugify(value) {
  return String(value || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
}

export function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeStrings(value) {
  return normalizeArray(value)
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

export function uniqueStrings(value) {
  return [...new Set(normalizeStrings(value))];
}

export function coerceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function copyMaybe(filePath, targetDir) {
  const absolutePath = resolve(filePath);
  const fileName = basename(absolutePath);
  const targetPath = join(targetDir, fileName);
  await ensureDir(targetDir);
  await copyFile(absolutePath, targetPath);
  return targetPath;
}

export async function hashFile(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

export async function fileInfo(path) {
  const info = await stat(path);
  return {
    path,
    size: info.size,
    extension: extname(path),
    sha256: await hashFile(path),
  };
}
