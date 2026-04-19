import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const SKILL_MD_RE = /^skill\.md$/i;

export async function walkSkillMarkdown(rootDir, onFile, options = {}) {
  const stopAtSkillDir = options.stopAtSkillDir ?? true;

  async function scan(dirPath, namespace) {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    if (stopAtSkillDir && entries.some((entry) => entry.isFile() && SKILL_MD_RE.test(entry.name))) {
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          await onFile(join(dirPath, entry.name), namespace);
        }
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, [...namespace, entry.name]);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        await onFile(fullPath, namespace);
      }
    }
  }

  await scan(rootDir, []);
}

export async function loadSkills(rootDir) {
  const skills = [];
  await walkSkillMarkdown(rootDir, async (fullPath, namespace) => {
    if (!SKILL_MD_RE.test(basename(fullPath))) {
      return;
    }
    const content = await readFile(fullPath, "utf8");
    const parsed = parseFrontmatter(content);
    const body = parsed.body.trim();
    skills.push({
      name: parsed.frontmatter.name ?? namespace.at(-1) ?? basename(fullPath, ".md"),
      description: parsed.frontmatter.description ?? firstSentence(body),
      path: fullPath,
      namespace,
      body,
    });
  });
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function parseFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatter = {};
  let index = 1;
  while (index < lines.length && lines[index] !== "---") {
    const line = lines[index];
    const split = line.indexOf(":");
    if (split !== -1) {
      const key = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      frontmatter[key] = value;
    }
    index += 1;
  }
  const body = lines.slice(index + 1).join("\n");
  return { frontmatter, body };
}

function firstSentence(text) {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? "";
}
