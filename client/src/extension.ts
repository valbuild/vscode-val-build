import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import { findValRoots } from "./findValRoots";
import { formatLanguageServerInfo } from "./languageServerInfo";
import { ProjectLanguageServers } from "./projectLanguageServers";

/**
 * The Val extension: a launcher, and nothing else.
 *
 * Everything Val-specific — evaluating modules, validating them, computing
 * quick fixes, completing media paths, uploading to Val Remote, logging in —
 * lives in `@valbuild/language-server`, which ships inside the Val the user's
 * own project depends on. This extension resolves that server and runs it.
 *
 * That is the whole design, and it is what fixes the problem this replaced. The
 * old extension carried a second implementation of Val pinned to one version: a
 * `node:vm` re-do of `createService`, its own schema walker, its own copy of
 * Val's mime table, its own remote-upload client. So one extension release
 * worked against one Val release, Val-specific fixes shipped on this
 * repository's cadence rather than Val's, and editors other than VS Code got
 * nothing.
 *
 * Now the contract is plain LSP. A feature Val gains appears here without an
 * extension release, and a Neovim or Zed user gets the same features by pointing
 * their client at the same binary — see `packages/language-server/README.md` in
 * the Val repository.
 *
 * The one thing that stays here is what LSP cannot express: finding which
 * directories are Val roots, resolving the right server for each, and saying
 * something useful when there isn't one.
 */

let projectServers: ProjectLanguageServers | undefined;
let output: vscode.OutputChannel;
/** Where the language clients and their servers log. See ProjectLanguageServers. */
let serverOutput: vscode.LogOutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: ExtensionContext) {
  output = vscode.window.createOutputChannel("Val Build");
  serverOutput = vscode.window.createOutputChannel("Val Language Server", {
    log: true,
  });
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = SHOW_INFO_COMMAND;

  context.subscriptions.push(
    output,
    serverOutput,
    statusBarItem,
    vscode.commands.registerCommand(SHOW_INFO_COMMAND, () => {
      const report = formatLanguageServerInfo({
        sessions: projectServers?.sessions() ?? [],
        workspaceRoots: findValRoots(workspaceFolderPaths()),
      });
      output.clear();
      output.appendLine(report);
      output.show(true);
      // Returned as well as shown: an output channel's contents cannot be read
      // back through the extension API, so this is what makes the report
      // assertable from an integration test.
      return report;
    }),
    vscode.commands.registerCommand(LOGIN_COMMAND, () => login()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("valBuild.languageServerPath")) {
        void restartProjectServers(context);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // A folder added to the workspace may be a Val root of its own, and it may
      // pin a different Val than every other root.
      void projectServers?.start();
    }),
  );

  void startProjectServers(context);
}

/**
 * The command ids this extension owns live under `valBuild.`, and the server's
 * live under `val.`.
 *
 * Not cosmetic: VS Code's command registry is global, and an LSP client has to
 * register every command name its server announces — so a name used on both
 * sides is a duplicate registration, which `registerCommand` answers with a
 * throw. It throws from inside `initialize`, so the cost is not one command but
 * the whole handshake.
 *
 * That is exactly what 1.1.0 did: it registered `val.login` for its palette
 * entry, and Val 0.103 and later announce a `val.login` command of their own. The
 * result was an extension that started and then served nothing. Namespacing the
 * two sides apart is what makes the collision impossible rather than unlikely,
 * and `contributedCommands.test.ts` checks it against the published server.
 */

/** Palette entry: `Val: Show Language Server Info`. */
const SHOW_INFO_COMMAND = "valBuild.showLanguageServerInfo";
/**
 * Palette entry: `Val: Log In`.
 *
 * The work happens in the language server (it owns the device flow and writes
 * the token next to the project). This forwards to whichever server serves the
 * active file's Val root — a monorepo can have several, and they can be logged
 * in separately.
 *
 * Kept as an entry of this extension's own, rather than left to the `val.login`
 * the language client registers, because only this side can tell the user *why*
 * nothing happened when no server is running, and can pick a root when several
 * are.
 */
const LOGIN_COMMAND = "valBuild.login";
/** The server-side command name. Advertised in the handshake's `commands`. */
const SERVER_LOGIN_COMMAND = "val.login";

async function login(): Promise<void> {
  const session = activeSession();
  if (!session) {
    void vscode.window.showWarningMessage(
      "Val: no Val language server is running. Run “Val: Show Language Server Info” to see why.",
    );
    return;
  }
  if (!session.capabilities?.commands.includes(SERVER_LOGIN_COMMAND)) {
    // A missing command means this Val version does not serve it. Say so rather
    // than sending a request that will be refused.
    void vscode.window.showWarningMessage(
      `Val: the language server in ${session.valRoot} does not support logging in. Update Val in that project.`,
    );
    return;
  }
  try {
    await projectServers?.executeCommand(
      session.valRoot,
      SERVER_LOGIN_COMMAND,
      [],
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Val: login failed. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The running session for the active editor's Val root, falling back to the only
 * running one.
 *
 * The fallback is what makes the palette entry work from a file that is not
 * itself a Val module, which is most of them.
 */
function activeSession() {
  const sessions = (projectServers?.sessions() ?? []).filter(
    (session) => session.state === "running",
  );
  const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activePath) {
    const match = sessions
      .filter((session) => activePath.startsWith(session.valRoot))
      // The innermost root wins in a nested workspace.
      .sort((a, b) => b.valRoot.length - a.valRoot.length)[0];
    if (match) {
      return match;
    }
  }
  return sessions.length === 1 ? sessions[0] : undefined;
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
}

async function startProjectServers(context: ExtensionContext): Promise<void> {
  if (projectServers) {
    return;
  }
  projectServers = new ProjectLanguageServers(output, serverOutput, () =>
    updateStatusBar(),
  );
  context.subscriptions.push(projectServers);
  await projectServers.start();
  updateStatusBar();
}

async function restartProjectServers(context: ExtensionContext): Promise<void> {
  const existing = projectServers;
  projectServers = undefined;
  existing?.dispose();
  await startProjectServers(context);
}

/**
 * What the status bar says.
 *
 * The Val version being served, because that is the thing a user cannot
 * otherwise see and the thing that decides which features exist. Deliberately
 * not login state: reading `.val/pat.json` would be Val-specific knowledge in a
 * launcher, and the server reports login results itself.
 */
function updateStatusBar(): void {
  const sessions = projectServers?.sessions() ?? [];
  if (sessions.length === 0) {
    statusBarItem.hide();
    return;
  }
  const running = sessions.filter((session) => session.state === "running");
  if (running.length === 0) {
    statusBarItem.text = "$(warning) Val";
    statusBarItem.tooltip =
      "No Val language server is running. Click for details.";
    statusBarItem.show();
    return;
  }
  const versions = new Set(
    running.map(
      (session) => session.capabilities?.versions.languageServer ?? "?",
    ),
  );
  statusBarItem.text =
    versions.size === 1
      ? `$(check) Val ${[...versions][0]}`
      : `$(check) Val (${running.length} roots)`;
  statusBarItem.tooltip = running
    .map(
      (session) =>
        `${session.valRoot}: Val ${session.capabilities?.versions.languageServer ?? "?"}`,
    )
    .join("\n");
  statusBarItem.show();
}

export function deactivate(): Thenable<void> | undefined {
  projectServers?.dispose();
  projectServers = undefined;
  return undefined;
}
