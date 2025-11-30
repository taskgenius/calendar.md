#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import semver from "semver";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 自定义 changelog 生成器，合并所有 beta 版本的提交到单个版本条目
 */
export function generateMergedChangelog(targetVersion, options = {}) {
  const { dryRun = false } = options;

  // 获取上一个正式版本标签
  function getLastStableTag() {
    try {
      const allTags = execSync("git tag -l", { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);

      const stableTags = [];
      for (const tag of allTags) {
        try {
          execSync(`git merge-base --is-ancestor ${tag} HEAD`, {
            encoding: "utf8",
          });
          const versionString = tag.replace(/^v/, "");
          const version = semver.valid(versionString);
          if (version && !semver.prerelease(version)) {
            stableTags.push({ tag, version });
          }
        } catch (e) {
          // 标签不在当前分支历史中，跳过
        }
      }

      if (stableTags.length === 0) {
        // 没有标签，获取第一个提交作为起点
        try {
          const firstCommit = execSync("git rev-list --max-parents=0 HEAD", {
            encoding: "utf8",
          })
            .trim()
            .split("\n")[0];
          return firstCommit;
        } catch (e) {
          // 如果连第一个提交都获取不到，返回空（将使用所有提交）
          return null;
        }
      }

      const sortedTags = stableTags.sort((a, b) => {
        return semver.rcompare(a.version, b.version);
      });

      return sortedTags[0].tag;
    } catch (error) {
      return null;
    }
  }

  const lastStableTag = getLastStableTag();
  console.log(
    `📦 Generating changelog from ${lastStableTag || "initial commit"} to ${targetVersion}`,
  );

  // 获取所有提交
  let rawCommits;
  try {
    const gitLogCmd = lastStableTag
      ? `git log ${lastStableTag}..HEAD --pretty=format:"%H|||%s|||%b|||%an|||%ae|||%ad" --no-merges`
      : `git log HEAD --pretty=format:"%H|||%s|||%b|||%an|||%ae|||%ad" --no-merges`;
    rawCommits = execSync(gitLogCmd, { encoding: "utf8" }).trim();
  } catch (e) {
    console.log("⚠️  No commits found, creating empty changelog");
    rawCommits = "";
  }

  const commits = rawCommits ? rawCommits.split("\n").filter(Boolean) : [];

  // 按类型分组提交
  const groupedCommits = {
    Features: [],
    "Bug Fixes": [],
    Performance: [],
    Refactors: [],
    Documentation: [],
    Styles: [],
    Tests: [],
    Reverts: [],
    "Breaking Changes": [],
  };

  const typeMap = {
    feat: "Features",
    fix: "Bug Fixes",
    perf: "Performance",
    refactor: "Refactors",
    docs: "Documentation",
    style: "Styles",
    test: "Tests",
    revert: "Reverts",
  };

  // 解析提交
  commits.forEach((commit) => {
    const parts = commit.split("|||");
    if (parts.length < 2) return;

    const [hash, subject, body] = parts;
    if (!subject) return;

    // 解析 conventional commit 格式
    const match = subject.match(/^(\w+)(?:\(([^)]+)\))?: (.+)$/);
    if (!match) return;

    const [, type, scope, description] = match;

    // 过滤掉 beta release commits
    if (
      type === "chore" &&
      description &&
      (description.includes("beta") ||
        description.includes("-beta.") ||
        description.match(/v\d+\.\d+\.\d+-beta/))
    ) {
      return;
    }

    // 检查是否有 BREAKING CHANGE
    if (body && body.includes("BREAKING CHANGE")) {
      groupedCommits["Breaking Changes"].push({
        hash: hash.substring(0, 7),
        scope,
        description,
        body,
      });
    }

    const section = typeMap[type];
    if (section) {
      groupedCommits[section].push({
        hash: hash.substring(0, 7),
        scope,
        description,
        body: body?.trim() || "",
      });
    }
  });

  // 生成 changelog 内容
  const date = new Date().toISOString().split("T")[0];
  const compareUrl = `https://github.com/taskgenius/calendar.md/compare/${lastStableTag}...${targetVersion}`;

  let newChangelog = `## [${targetVersion}](${compareUrl}) (${date})\n\n`;

  // 按顺序输出各个分组（Breaking Changes 优先）
  const sectionOrder = [
    "Breaking Changes",
    "Features",
    "Bug Fixes",
    "Performance",
    "Refactors",
    "Documentation",
    "Tests",
    "Styles",
    "Reverts",
  ];

  sectionOrder.forEach((section) => {
    const sectionCommits = groupedCommits[section];
    if (sectionCommits && sectionCommits.length > 0) {
      newChangelog += `### ${section}\n\n`;
      sectionCommits.forEach((commit) => {
        const commitUrl = `https://github.com/taskgenius/calendar.md/commit/${commit.hash}`;
        const scopePrefix = commit.scope ? `**${commit.scope}:** ` : "";
        newChangelog += `* ${scopePrefix}${commit.description} ([${commit.hash}](${commitUrl}))\n`;

        // Add commit body as sub-items if present
        if (commit.body) {
          if (section === "Breaking Changes") {
            // Handle BREAKING CHANGE specially
            const breakingDetail = commit.body
              .split("BREAKING CHANGE:")[1]
              ?.trim();
            if (breakingDetail) {
              newChangelog += `  ${breakingDetail}\n`;
            }
          } else {
            // Parse body lines and add as sub-list items
            const bodyLines = commit.body
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith("BREAKING CHANGE"));

            if (bodyLines.length > 0) {
              bodyLines.forEach((line) => {
                // Remove leading "- " if present to avoid double bullets
                const cleanLine = line.replace(/^[-*]\s*/, "");
                if (cleanLine) {
                  newChangelog += `  - ${cleanLine}\n`;
                }
              });
            }
          }
        }
      });
      newChangelog += "\n";
    }
  });

  // 读取现有的 changelog
  const changelogPath = path.join(__dirname, "..", "CHANGELOG.md");
  let existingChangelog = "";
  try {
    existingChangelog = readFileSync(changelogPath, "utf8");
  } catch (e) {
    // 文件不存在，创建新的
    existingChangelog =
      "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
  }

  // 确保不重复添加相同版本
  if (existingChangelog.includes(`## [${targetVersion}]`)) {
    console.log(`⚠️  Version ${targetVersion} already exists in CHANGELOG.md`);
    return existingChangelog;
  }

  // 插入新的 changelog 到文件开头（在 header 之后）
  const header =
    "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
  const restContent = existingChangelog.replace(header, "").trim();
  const updatedChangelog = header + "\n" + newChangelog + restContent;

  if (!dryRun) {
    writeFileSync(changelogPath, updatedChangelog);
    console.log(`✅ CHANGELOG.md updated with version ${targetVersion}`);
  } else {
    console.log("📋 Preview (dry-run mode):");
    console.log(newChangelog);
  }

  return updatedChangelog;
}

// 如果直接运行此脚本
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] || "9.8.0";
  const dryRun = process.argv.includes("--dry-run");
  generateMergedChangelog(version, { dryRun });
}
