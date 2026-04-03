#!/usr/bin/env node

/**
 * Release automation script for Tuckd
 * 
 * Run after merging dev into main. Does:
 * 1. Collects commits since last tag
 * 2. Determines version bump (major/minor/patch)
 * 3. Updates manifest.json, package.json versions
 * 4. Updates CHANGELOG.md with categorized notes
 * 5. Updates README.md version badge
 * 6. Creates and pushes git tag
 *
 * Usage:
 *   node scripts/release.js          # auto-determine bump type
 *   node scripts/release.js patch    # force patch
 *   node scripts/release.js minor    # force minor
 *   node scripts/release.js major    # force major
 *   node scripts/release.js 1.2.3    # set exact version
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// --- Helpers ---

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", ...opts }).trim();
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf-8"));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(data, null, 2) + "\n");
}

function readFile(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf-8");
}

function writeFile(file, content) {
  fs.writeFileSync(path.join(ROOT, file), content);
}

// --- Version logic ---

function getLastTag() {
  try {
    return run("git describe --tags --abbrev=0");
  } catch {
    return null;
  }
}

function getCommitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = run(`git log ${range} --pretty=format:"%H|%s|%an|%ae|%aI"`);
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [hash, subject, author, email, date] = line.split("|");
    return { hash, subject, author, email, date };
  });
}

function categorizeCommits(commits) {
  const categories = {
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    chore: [],
    other: [],
  };

  const typeMap = {
    feat: "feat",
    feature: "feat",
    fix: "fix",
    bugfix: "fix",
    perf: "perf",
    performance: "perf",
    refactor: "refactor",
    docs: "docs",
    chore: "chore",
    style: "chore",
    test: "chore",
    tests: "chore",
    ci: "chore",
    build: "chore",
  };

  for (const commit of commits) {
    let subject = commit.subject;
    // Strip conventional commit prefix
    const match = subject.match(/^(?:\w+\(!?\))?:\s*(.+)/);
    const cleanMatch = subject.match(/^(?:\w+\(!?\))?:\s*(.+)/);
    let clean = cleanMatch ? cleanMatch[1] : subject;
    // Capitalize first letter
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);

    // Determine type
    let type = "other";
    const prefixMatch = subject.match(/^(\w+)/);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      type = typeMap[prefix] || "other";
    }

    if (categories[type]) {
      categories[type].push(clean);
    } else {
      categories.other.push(clean);
    }
  }

  return categories;
}

function determineBump(commits, forceBump) {
  if (forceBump) {
    // Check if it's a full version string
    if (forceBump.match(/^\d+\.\d+\.\d+$/)) {
      return { type: "exact", version: forceBump };
    }
    return { type: forceBump };
  }

  // Auto-determine from commit types
  const hasBreaking = commits.some((c) =>
    c.subject.includes("BREAKING") || c.subject.includes("!:")
  );
  const hasFeatures = commits.some((c) =>
    c.subject.match(/^(feat|feature)(\(!?\))?:/)
  );

  if (hasBreaking) return { type: "major" };
  if (hasFeatures) return { type: "minor" };
  return { type: "patch" };
}

function bumpVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);

  if (bump.type === "exact") return bump.version;
  if (bump.type === "major") return `${major + 1}.0.0`;
  if (bump.type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function formatChangelog(categories, version, date) {
  const sectionLabels = {
    feat: "### Added",
    fix: "### Fixed",
    perf: "### Performance",
    refactor: "### Changed",
    docs: "### Documentation",
    chore: "### Internal",
    other: "### Other",
  };

  let sections = "";
  for (const [type, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    const label = sectionLabels[type] || "### Other";
    sections += `\n${label}\n`;
    for (const item of items) {
      sections += `- ${item}\n`;
    }
  }

  return `## [${version}] - ${date}\n${sections}`;
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const forceBump = args[0] || null;

  // Check we're on main
  const branch = run("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") {
    console.error("❌ Must be on 'main' branch to release.");
    console.error("   Merge dev into main first.");
    process.exit(1);
  }

  // Get commits since last tag
  const lastTag = getLastTag();
  const commits = getCommitsSince(lastTag);

  if (commits.length === 0) {
    console.log("ℹ️  No new commits since last tag. Nothing to release.");
    process.exit(0);
  }

  console.log(`📦 Found ${commits.length} commits since ${lastTag || "beginning"}`);

  // Categorize
  const categories = categorizeCommits(commits);

  // Determine version
  const currentVersion = readJSON("manifest.json").version;
  const bump = determineBump(commits, forceBump);
  const newVersion = bumpVersion(currentVersion, bump);

  console.log(`📌 Version: ${currentVersion} → ${newVersion} (${bump.type})`);

  // Confirm
  console.log("\n📋 Changes:");
  for (const [type, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    console.log(`  ${type}: ${items.length} commit(s)`);
  }

  // --- Apply updates ---

  const today = new Date().toISOString().split("T")[0];

  // 1. Update manifest.json
  const manifest = readJSON("manifest.json");
  manifest.version = newVersion;
  writeJSON("manifest.json", manifest);
  console.log("✅ Updated manifest.json");

  // 2. Update package.json
  const pkg = readJSON("package.json");
  pkg.version = newVersion;
  writeJSON("package.json", pkg);
  console.log("✅ Updated package.json");

  // 3. Update CHANGELOG.md
  const changelog = readFile("CHANGELOG.md");
  const newEntry = formatChangelog(categories, newVersion, today);
  // Insert new entry after the header lines (before first existing version entry)
  const headerEnd = changelog.match(/^## \[/m);
  let updatedChangelog;
  if (headerEnd) {
    updatedChangelog =
      changelog.slice(0, headerEnd.index) +
      newEntry +
      "\n\n" +
      changelog.slice(headerEnd.index);
  } else {
    updatedChangelog = changelog.trimEnd() + "\n\n" + newEntry + "\n";
  }
  writeFile("CHANGELOG.md", updatedChangelog);
  console.log("✅ Updated CHANGELOG.md");

  // 4. Commit version bumps
  run("git add manifest.json package.json CHANGELOG.md");
  run(`git commit -m "chore: release v${newVersion}"`);
  console.log("✅ Committed version bumps");

  // 5. Create and push tag
  run(`git tag -a v${newVersion} -m "Release v${newVersion}"`);
  run(`git push origin main`);
  run(`git push origin v${newVersion}`);
  console.log(`✅ Tagged and pushed v${newVersion}`);

  console.log(`\n🎉 Release v${newVersion} published!`);
  console.log(`   GitHub Actions will now create the release and publish to Chrome Web Store.`);
}

main();
