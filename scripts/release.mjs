/**
 * Cut a release of the extension.
 *
 * Publishing is done by `.github/workflows/publish.yml`, which fires on a `v*`
 * tag and ships to both the Visual Studio Marketplace and the Open VSX
 * Registry. So a release is really just "bump the version, tag it, push the
 * tag" — three steps that are easy to get subtly wrong, in ways that are only
 * visible after the publish job has already half-run:
 *
 *  - **The three versions must agree.** `publish.yml` asserts that the tag
 *    matches `package.json` AND `package-lock.json`, and fails the job if not.
 *    Discovering that in CI means a tag pointing at a commit that can never
 *    publish, and a tag is awkward to take back once pushed. This checks the
 *    same three values before pushing anything.
 *  - **A tag is the trigger, so it is the point of no return.** Everything that
 *    can be checked is checked first: the tree is clean, the branch is the
 *    release branch and up to date, the tag does not already exist, and the
 *    build actually works.
 *  - **Both marketplaces publish from one tag.** There is no staging step and
 *    no unpublish, so a broken VSIX is public until the next release. That is
 *    why `verify-vsix.mjs` runs here and not only in CI.
 *
 * Usage:
 *
 *   npm run release -- patch            # 1.0.23 -> 1.0.24
 *   npm run release -- minor            # 1.0.23 -> 1.1.0
 *   npm run release -- 2.0.0            # an explicit version
 *   npm run release -- minor --dry-run  # say what would happen, change nothing
 *
 * Flags:
 *   --dry-run       Print the plan; make no commit, tag, or push.
 *   --yes           Skip the final confirmation prompt (for CI or a rerun).
 *   --skip-checks   Do not rebuild and retest. Only when they just passed.
 *   --branch <name> Release from a branch other than main.
 *   --remote <name> Push somewhere other than origin.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUMPS = new Set(["patch", "minor", "major"]);

function fail(message) {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    fail(`\`${command} ${args.join(" ")}\` exited ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(
      `\`${command} ${args.join(" ")}\` exited ${result.status}: ${
        result.stderr?.trim() || "(no stderr)"
      }`,
    );
  }
  return result.stdout.trim();
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"));
}

/**
 * The next version.
 *
 * Computed here rather than left to `npm version`'s own keyword handling, so the
 * version this script *prints* and the version it *writes* cannot disagree — and
 * so `--dry-run` can report the real answer without touching any file.
 */
function nextVersion(current, request) {
  if (!BUMPS.has(request)) {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(request)) {
      fail(
        `\`${request}\` is neither patch, minor, major, nor an X.Y.Z version.`,
      );
    }
    return request;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) {
    fail(`Cannot bump the current version \`${current}\`: not X.Y.Z.`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (request === "major") return `${major + 1}.0.0`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function parseArgs(argv) {
  const options = {
    request: undefined,
    dryRun: false,
    yes: false,
    skipChecks: false,
    branch: "main",
    remote: "origin",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--skip-checks") options.skipChecks = true;
    else if (arg === "--branch") options.branch = argv[++i];
    else if (arg === "--remote") options.remote = argv[++i];
    else if (arg.startsWith("-")) fail(`Unknown flag \`${arg}\`.`);
    else if (options.request === undefined) options.request = arg;
    else fail(`Unexpected argument \`${arg}\`.`);
  }
  if (!options.request) {
    fail(
      "Say what to release: patch, minor, major, or an explicit X.Y.Z.\n" +
        "  npm run release -- patch",
    );
  }
  if (!options.branch) fail("--branch needs a branch name.");
  if (!options.remote) fail("--remote needs a remote name.");
  return options;
}

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

const options = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// What we are releasing
// ---------------------------------------------------------------------------

const current = readJson("package.json").version;
const version = nextVersion(current, options.request);
const tag = `v${version}`;

if (version === current) {
  fail(
    `package.json is already ${current}. A tag must point at a new version, ` +
      `because ${tag} may already have been published.`,
  );
}

console.log(`\nreleasing ${current} -> ${version}  (tag ${tag})\n`);

// ---------------------------------------------------------------------------
// Preflight: everything that can be checked before the tag exists
// ---------------------------------------------------------------------------

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== options.branch) {
  fail(
    `On \`${branch}\`, but releases are cut from \`${options.branch}\`.\n` +
      `  Check it out, or pass --branch ${branch} if that is deliberate.`,
  );
}

if (capture("git", ["status", "--porcelain"]) !== "") {
  // A dirty tree means the tag would not describe what gets published: `vsce
  // package` reads the working tree, not the commit.
  fail(
    "The working tree is not clean. Commit or stash first — `vsce package` " +
      "packages the working tree, so uncommitted changes would ship without " +
      "being in the tagged commit.",
  );
}

console.log(`fetching ${options.remote}…`);
run("git", ["fetch", "--tags", options.remote, options.branch], {
  stdio: "ignore",
});

const localHead = capture("git", ["rev-parse", "HEAD"]);
const remoteHead = capture("git", [
  "rev-parse",
  `${options.remote}/${options.branch}`,
]);
if (localHead !== remoteHead) {
  const ahead = capture("git", [
    "rev-list",
    "--count",
    `${options.remote}/${options.branch}..HEAD`,
  ]);
  const behind = capture("git", [
    "rev-list",
    "--count",
    `HEAD..${options.remote}/${options.branch}`,
  ]);
  // Both directions are a problem, for different reasons, so say which one.
  const why =
    Number(behind) > 0
      ? "Releasing from a branch that is behind publishes an older tree than " +
        "the one on the remote. Pull first."
      : "The tagged commit is not on the remote yet, so the publish job would " +
        "check out something nobody has seen. Push first.";
  fail(
    `\`${branch}\` and \`${options.remote}/${options.branch}\` have diverged ` +
      `(${ahead} ahead, ${behind} behind).\n  ${why}`,
  );
}

const existingTag = capture("git", ["tag", "--list", tag]);
if (existingTag !== "") {
  fail(`Tag ${tag} already exists locally. Pick another version.`);
}
const remoteTag = capture("git", [
  "ls-remote",
  "--tags",
  options.remote,
  `refs/tags/${tag}`,
]);
if (remoteTag !== "") {
  fail(
    `Tag ${tag} already exists on ${options.remote}, so ${version} has been ` +
      `published. Pick another version.`,
  );
}

// ---------------------------------------------------------------------------
// Checks. Both marketplaces publish from one tag and there is no unpublish.
// ---------------------------------------------------------------------------

if (options.skipChecks) {
  console.log("skipping checks (--skip-checks)\n");
} else {
  console.log("compiling…");
  run("npm", ["run", "compile"]);
  console.log("linting…");
  run("npm", ["run", "lint"]);
  console.log("testing the client…");
  run("npm", ["test"], { cwd: path.join(REPO_ROOT, "client") });
  run("npm", ["run", "typecheck"], { cwd: path.join(REPO_ROOT, "client") });
  // Packages a real VSIX and checks it ships no bundled server and no leaked
  // language-server import. This is the check that would catch a VSIX which
  // installs but does nothing.
  console.log("verifying the VSIX…");
  run("node", ["scripts/verify-vsix.mjs"]);
}

// ---------------------------------------------------------------------------
// Bump, commit, tag
// ---------------------------------------------------------------------------

if (options.dryRun) {
  console.log("\n--dry-run, so stopping here. It would have:");
  console.log(`  1. set package.json and package-lock.json to ${version}`);
  console.log(`  2. committed "Release ${tag}" and tagged ${tag}`);
  console.log(
    `  3. pushed ${branch} and ${tag} to ${options.remote}, which starts ` +
      `publish.yml`,
  );
  process.exit(0);
}

// `npm version` is what keeps package-lock.json in step with package.json --
// including `packages[""].version`, which a hand-edit reliably forgets and
// which publish.yml checks.
console.log(`\nbumping to ${version}…`);
run("npm", ["version", version, "-m", "Release v%s"]);

// The same three-way assertion publish.yml makes, made here instead, where the
// answer is still cheap to act on.
const bumped = readJson("package.json").version;
const lock = readJson("package-lock.json");
const mismatches = [
  ["package.json", bumped],
  ["package-lock.json (version)", lock.version],
  ['package-lock.json (packages[""])', lock.packages?.[""]?.version],
].filter(([, value]) => value !== version);
if (mismatches.length > 0) {
  fail(
    `The bump did not land everywhere publish.yml checks:\n` +
      mismatches
        .map(([where, value]) => `  ${where}: ${value ?? "missing"}`)
        .join("\n") +
      `\n  Expected ${version}. The commit and tag were created — undo with:\n` +
      `    git tag -d ${tag} && git reset --hard HEAD~1`,
  );
}
console.log("package.json and package-lock.json agree with the tag.");

// ---------------------------------------------------------------------------
// Push: the point of no return
// ---------------------------------------------------------------------------

if (!options.yes) {
  console.log(
    `\nPushing ${tag} starts publish.yml, which publishes ${version} to the\n` +
      `Visual Studio Marketplace and Open VSX. There is no unpublish.\n`,
  );
  const ok = await confirm("Push and publish? [y/N] ");
  if (!ok) {
    console.log(
      `\nNot pushed. The commit and tag exist locally; undo them with:\n` +
        `  git tag -d ${tag} && git reset --hard HEAD~1\n`,
    );
    process.exit(1);
  }
}

// Branch before tag, so the tagged commit is already on the remote when the
// workflow checks it out.
console.log(`\npushing ${branch}…`);
run("git", ["push", options.remote, branch]);
console.log(`pushing ${tag}…`);
run("git", ["push", options.remote, tag]);

const repoUrl = capture("git", ["remote", "get-url", options.remote])
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");

console.log(`\nreleased ${tag}.`);
console.log(`  ${repoUrl}/actions   — publish.yml is running`);
console.log(`  ${repoUrl}/releases/tag/${tag}`);
