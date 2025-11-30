require("dotenv").config();

const { execSync } = require("child_process");
const semver = require("semver");

// 智能获取上一个正式版本标签（排除预发布版本）
function getLastStableTag() {
  try {
    // 获取所有标签
    const allTags = execSync("git tag -l", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);

    // 过滤出在当前分支历史中的标签，并排除预发布版本
    const stableTags = [];
    for (const tag of allTags) {
      try {
        // 检查标签是否可以从 HEAD 访问到
        execSync(`git merge-base --is-ancestor ${tag} HEAD`, {
          encoding: "utf8",
        });
        // 尝试解析版本号（移除可能的 'v' 前缀）
        const versionString = tag.replace(/^v/, "");
        const version = semver.valid(versionString);
        // 只保留正式版本（排除带有预发布标识的版本）
        if (version && !semver.prerelease(version)) {
          stableTags.push({ tag, version });
        }
      } catch (e) {
        // 标签不在当前分支历史中，跳过
      }
    }

    if (stableTags.length === 0) {
      console.log("No stable version tags found, using HEAD~30");
      return "HEAD~30";
    }

    // 按照 semver 排序，从高到低
    const sortedTags = stableTags.sort((a, b) => {
      return semver.rcompare(a.version, b.version);
    });

    const latestStableTag = sortedTags[0];
    console.log(
      `Using last stable version tag: ${latestStableTag.tag} (version: ${latestStableTag.version})`,
    );

    // 显示将包含的提交数量
    try {
      const commitCount = execSync(
        `git rev-list --count ${latestStableTag.tag}..HEAD`,
        { encoding: "utf8" },
      ).trim();
      console.log(
        `Will include ${commitCount} commits since ${latestStableTag.tag}`,
      );
    } catch (e) {
      // 忽略错误，这只是信息性输出
    }

    return latestStableTag.tag;
  } catch (error) {
    console.warn(
      "Warning: Could not determine last stable tag, using HEAD~30",
      error.message,
    );
    return "HEAD~30";
  }
}

// 在模块开始时获取一次，避免重复调用
const lastStableTag = getLastStableTag();

module.exports = {
  interactive: true,
  hooks: {
    "before:init": ["node esbuild.config.mjs production"],
    "after:bump": [
      "node esbuild.config.mjs production",
      "node ./scripts/zip.mjs",
      // 使用自定义 changelog 生成器替代 conventional-changelog
      "node ./scripts/custom-changelog.mjs ${version}",
      "git add .",
    ],
    "after:release":
      "echo Successfully released Task Genius v${version} to ${repo.repository}.",
  },
  git: {
    requireBranch: "main",
    requireCleanWorkingDir: true,
    pushArgs: "--follow-tags -o ci.skip",
    commitMessage: "chore(release): bump version to ${version}",
    tagName: "${version}",
    tagAnnotation: "Release ${version}",
    addUntrackedFiles: true,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: "conventionalcommits",
      // 禁用 conventional-changelog 的 changelog 生成，使用我们的自定义脚本
      infile: false,
      // 仍然使用 conventional commits 来推荐版本号
      strictSemVer: false,
    },
    "./scripts/ob-bumper.mjs": {
      indent: 2,
      copyTo: "./dist",
    },
  },
  npm: {
    publish: false,
  },
  github: {
    release: true,
    assets: [
      "dist/main.js",
      "dist/manifest.json",
      "dist/styles.css",
      "dist/task-genius-${version}.zip",
    ],
    proxy: process.env.HTTPS_PROXY,
    releaseName: "${version}",
  },
};
