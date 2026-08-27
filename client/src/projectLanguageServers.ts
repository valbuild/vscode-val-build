import * as path from "path";
import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  TransportKind,
  type CloseHandlerResult,
  type ErrorHandler,
  type ErrorHandlerResult,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { VAL_BUILD_URL, VAL_CONTENT_URL, VAL_REMOTE_HOST } from "./envConstants";
import { findValRoots } from "./findValRoots";
import {
  describeIncompatibility,
  diagnoseLanguageServer,
  type DiagnosisAction,
} from "./languageServerDiagnosis";
import { detectPackageManager } from "./packageManager";
import {
  resolveLanguageServer,
  type ResolvedLanguageServer,
} from "./resolveLanguageServer";
import { detectValVersion, type DetectedValVersion } from "./valVersion";
import { ValClientCapabilitiesFeature } from "./valClientCapabilitiesFeature";
import {
  CLIENT_PROTOCOL_VERSIONS,
  VAL_INPUT_REQUEST,
  VAL_PICK_REQUEST,
  type ValInitializationOptions,
  type ValInputParams,
  type ValInputResult,
  type ValPickParams,
  type ValPickResult,
  type ValServerCapabilities,
} from "./valProtocol";

/**
 * Launching the language server that ships with the Val in the user's project.
 *
 * One server per Val root, not one server for the workspace: roots in a monorepo
 * may pin different versions of Val and therefore need different servers. Each
 * client's `documentSelector` is confined to its own root so two of them can
 * never both claim a file.
 *
 * Off by default — see `valBuild.useProjectLanguageServer`. Nothing here runs
 * unless the user opts in.
 */

export const EXTENSION_ID = "valbuild.vscode-val-build";

/** What this client can do, announced to the server during `initialize`. */
const CLIENT_CAPABILITIES = { pick: true, input: true } as const;

export type ProjectServerSession = {
  valRoot: string;
  resolved: ResolvedLanguageServer;
  valVersion: DetectedValVersion | null;
  /** Negotiated capabilities, or `null` while `initialize` is still in flight. */
  capabilities: ValServerCapabilities | null;
  /** Features actually served — empty until `initialize` returns. */
  features: string[];
  state: "starting" | "running" | "incompatible" | "failed";
  /** Why it is not running, for `val.showLanguageServerInfo`. */
  detail?: string;
};

/**
 * The Val roots this manager knows about and, for each, either a running server
 * or the reason there is not one.
 */
export class ProjectLanguageServers implements vscode.Disposable {
  private readonly clients = new Map<string, LanguageClient>();
  private readonly sessionsByRoot = new Map<string, ProjectServerSession>();
  /**
   * Roots already reported to the user. A root that cannot start is worth one
   * notification, not one per activation event.
   */
  private readonly reported = new Set<string>();
  /** Roots with no Val at all, so they are not re-resolved on every refresh. */
  private readonly skipped = new Set<string>();
  /**
   * Roots whose client we are shutting down on purpose, so its closing is not
   * reported to the user as a failure.
   */
  private readonly stopping = new Set<string>();

  constructor(
    private readonly output: vscode.OutputChannel,
    /**
     * The channel the language clients log to.
     *
     * Owned here rather than left to `LanguageClient`, which disposes a channel
     * it created as part of `stop()` — and then logs the server process's `exit`
     * to it, throwing "Channel has been closed" at the user for a shutdown they
     * asked for. A client-supplied channel is never disposed by the client
     * (`_disposeOutputChannel` is false), so the race cannot happen.
     *
     * A `LogOutputChannel` because that is what v10 requires, and separate from
     * `output` because its timestamp and level prefixes would mangle the
     * `val.showLanguageServerInfo` report.
     */
    private readonly serverOutput: vscode.LogOutputChannel,
    /**
     * Called whenever a root's session changes state, so the UI can follow.
     *
     * This used to carry the served feature list, which the bundled server
     * needed in order to stop publishing what this one had taken over. There is
     * no second server any more, so there is nothing to arbitrate — only a
     * status bar to refresh.
     */
    private readonly onSessionsChanged: () => void,
  ) {}

  sessions(): ProjectServerSession[] {
    return [...this.sessionsByRoot.values()];
  }

  /**
   * Start a server for every Val root in the workspace that does not have one.
   *
   * Idempotent, so it is safe to call on activation and again when workspace
   * folders change.
   */
  async start(): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === "file")
      .map((folder) => folder.uri.fsPath);
    const valRoots = findValRoots(folders);
    this.log(
      `Found ${valRoots.length} Val root(s): ${valRoots.join(", ") || "none"}`,
    );
    await Promise.all(valRoots.map((valRoot) => this.startOne(valRoot)));
  }

  private async startOne(valRoot: string): Promise<void> {
    if (this.clients.has(valRoot) || this.skipped.has(valRoot)) {
      return;
    }

    const configuration = vscode.workspace.getConfiguration("valBuild");
    const resolved = resolveLanguageServer(valRoot, {
      settingPath: configuration.get<string>("languageServerPath") ?? null,
      envPath: process.env.VAL_LANGUAGE_SERVER_PATH ?? null,
    });
    const valVersion = detectValVersion(valRoot);
    const packageManager = detectPackageManager(valRoot);
    const diagnosis = diagnoseLanguageServer({
      resolved,
      detected: valVersion,
      packageManager,
    });

    if (diagnosis.kind === "silent") {
      // No @valbuild/* at all: not a Val project, or dependencies are not
      // installed. Say nothing — do not nag.
      this.log(`${valRoot}: no @valbuild/* installed, ignoring`);
      this.skipped.add(valRoot);
      return;
    }
    if (diagnosis.kind === "problem") {
      this.log(`${valRoot}: ${diagnosis.reason}: ${diagnosis.message}`);
      this.sessionsByRoot.set(valRoot, {
        valRoot,
        resolved: {
          entry: "",
          version: null,
          via: "unresolved",
          override: null,
        },
        valVersion,
        capabilities: null,
        features: [],
        state: "failed",
        detail: diagnosis.message,
      });
      this.onSessionsChanged();
      this.report(valRoot, diagnosis.message, diagnosis.actions);
      return;
    }

    const session: ProjectServerSession = {
      valRoot,
      resolved: diagnosis.resolved,
      valVersion,
      capabilities: null,
      features: [],
      state: "starting",
    };
    this.sessionsByRoot.set(valRoot, session);

    const client = createClient(
      valRoot,
      diagnosis.resolved,
      this.output,
      this.serverOutput,
      () => this.stopping.has(valRoot),
    );
    this.clients.set(valRoot, client);
    registerUiPrimitives(client);

    try {
      await client.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.state = "failed";
      session.detail = message;
      this.clients.delete(valRoot);
      this.log(`${valRoot}: failed to start: ${message}`);
      this.onSessionsChanged();
      this.report(
        valRoot,
        `The Val language server in ${path.basename(valRoot)} failed to start: ${message}`,
        [],
      );
      return;
    }

    const capabilities = readValCapabilities(client);
    session.capabilities = capabilities;

    // Check `incompatible` FIRST, and never infer compatibility from which
    // capabilities are present: `vscode-languageserver` injects
    // `textDocumentSync` into the InitializeResult on its own, so its presence
    // proves nothing.
    //
    // A server that reported no `experimental.val` at all is the same kind of
    // failure and gets the same directional message: it is older than anything
    // this client can talk to.
    const incompatible = capabilities
      ? capabilities.incompatible
      : ({
          status: "server-too-old",
          server: { min: 0, max: 0 },
          client: CLIENT_PROTOCOL_VERSIONS,
        } as const);

    if (incompatible) {
      const { message, actions } = describeIncompatibility(
        incompatible,
        capabilities?.versions ?? { core: null, languageServer: null },
        packageManager,
      );
      session.state = "incompatible";
      session.detail = message;
      this.log(`${valRoot}: ${incompatible.status}: ${message}`);
      this.onSessionsChanged();
      await this.stopOne(valRoot);
      this.report(valRoot, message, actions);
      return;
    }

    session.state = "running";
    session.features = capabilities.features;
    this.log(
      `${valRoot}: serving with @valbuild/language-server ` +
        `${capabilities.versions.languageServer ?? "?"} ` +
        `(core ${capabilities.versions.core ?? "?"}, ` +
        `protocol v${capabilities.protocolVersion}, via ${diagnosis.resolved.via})`,
    );
    this.log(`${valRoot}: features: ${capabilities.features.join(", ") || "none"}`);
    this.onSessionsChanged();
  }

  /**
   * Run one of the server's own commands, for a palette entry.
   *
   * A code action's `command` is forwarded by `LanguageClient` on its own, so
   * this exists only for the commands a user invokes directly rather than
   * through a diagnostic.
   */
  async executeCommand(
    valRoot: string,
    command: string,
    args: unknown[],
  ): Promise<unknown> {
    const client = this.clients.get(valRoot);
    if (!client) {
      throw new Error(`No Val language server is running for ${valRoot}.`);
    }
    return client.sendRequest("workspace/executeCommand", {
      command,
      arguments: args,
    });
  }

  private async stopOne(valRoot: string): Promise<void> {
    const client = this.clients.get(valRoot);
    if (!client) {
      return;
    }
    this.clients.delete(valRoot);
    // Set before stopping, so the error handler knows the closure is expected.
    this.stopping.add(valRoot);
    this.onSessionsChanged();
    try {
      await client.stop();
    } catch {
      // A server that will not stop cleanly is already being discarded.
    } finally {
      this.stopping.delete(valRoot);
    }
  }

  /** One notification per root: a problem is worth saying once. */
  private report(
    valRoot: string,
    message: string,
    actions: DiagnosisAction[],
  ): void {
    if (this.reported.has(valRoot)) {
      return;
    }
    this.reported.add(valRoot);
    void vscode.window
      .showWarningMessage(message, ...actions.map((action) => action.title))
      .then((picked) => {
        const action = actions.find(({ title }) => title === picked);
        if (action) {
          runAction(action, valRoot);
        }
      });
  }

  private log(message: string): void {
    this.output.appendLine(`[project-server] ${message}`);
  }

  dispose(): void {
    for (const valRoot of [...this.clients.keys()]) {
      void this.stopOne(valRoot);
    }
    this.sessionsByRoot.clear();
  }
}

/**
 * Keep a language server's failures out of the user's face.
 *
 * `LanguageClient`'s default handler pops up a modal-ish error notification, and
 * it fires on the child's exit as well as on real protocol errors — so simply
 * stopping a server produces "Channel has been closed" at the user, for
 * something they asked for. This routes everything to the extension's output
 * channel instead (`handled: true` is what suppresses the popup) and refuses to
 * restart a server that was stopped on purpose.
 */
class ProjectServerErrorHandler implements ErrorHandler {
  private restarts = 0;

  constructor(
    private readonly valRoot: string,
    private readonly log: (message: string) => void,
    /** Whether this client is being shut down deliberately. */
    private readonly isStopping: () => boolean,
  ) {}

  error(error: Error, _message: unknown, count: number | undefined): ErrorHandlerResult {
    this.log(`${this.valRoot}: ${error.message}`);
    if (this.isStopping() || (count ?? 0) > 3) {
      return { action: ErrorAction.Shutdown, handled: true };
    }
    return { action: ErrorAction.Continue, handled: true };
  }

  closed(): CloseHandlerResult {
    if (this.isStopping()) {
      // Expected: the user turned the setting off, changed the override, or the
      // window is closing.
      return { action: CloseAction.DoNotRestart, handled: true };
    }
    this.restarts += 1;
    if (this.restarts > 3) {
      this.log(
        `${this.valRoot}: the language server keeps closing; giving up. ` +
          `Run "Val: Show Language Server Info" to see what resolved.`,
      );
      return { action: CloseAction.DoNotRestart, handled: true };
    }
    this.log(`${this.valRoot}: the language server closed; restarting.`);
    return { action: CloseAction.Restart, handled: true };
  }
}

function createClient(
  valRoot: string,
  resolved: ResolvedLanguageServer,
  output: vscode.OutputChannel,
  serverOutput: vscode.LogOutputChannel,
  isStopping: () => boolean,
): LanguageClient {
  // `module` + IPC rather than a manual spawn: IPC is faster and more robust
  // than stdio under VS Code, and lets `LanguageClient` own the process.
  const serverOptions: ServerOptions = {
    run: {
      module: resolved.entry,
      transport: TransportKind.ipc,
      options: { cwd: valRoot },
    },
    debug: {
      module: resolved.entry,
      transport: TransportKind.ipc,
      options: { cwd: valRoot },
    },
  };

  const initializationOptions: ValInitializationOptions = {
    client: { name: "vscode-val-build", version: extensionVersion() },
    supportedProtocolVersions: CLIENT_PROTOCOL_VERSIONS,
    valRoot,
    env: {
      VAL_CONTENT_URL,
      VAL_REMOTE_HOST,
      VAL_BUILD_URL,
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Confined to this root so two servers can never both claim a file.
    documentSelector: [
      { scheme: "file", language: "typescript", pattern: rootPattern(valRoot) },
      { scheme: "file", language: "javascript", pattern: rootPattern(valRoot) },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(valRoot, "**/*.val.{ts,js}"),
        ),
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(valRoot, "val.config.{ts,js}"),
        ),
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(valRoot, "val.modules.{ts,js}"),
        ),
      ],
    },
    initializationOptions,
    workspaceFolder: vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(valRoot),
    ),
    // Supplied rather than left to the client — see `serverOutput`. Shared by
    // every root, which also puts the whole picture in one place.
    outputChannel: serverOutput,
    errorHandler: new ProjectServerErrorHandler(
      valRoot,
      (message) => output.appendLine(`[project-server] ${message}`),
      isStopping,
    ),
  };

  const client = new LanguageClient(
    `valBuild:${valRoot}`,
    `Val (${path.basename(valRoot)})`,
    serverOptions,
    clientOptions,
  );
  client.registerFeature(new ValClientCapabilitiesFeature(CLIENT_CAPABILITIES));
  return client;
}

/**
 * A glob confined to one Val root.
 *
 * Forward slashes even on Windows: VS Code's glob matching normalises
 * separators, and a pattern containing backslashes matches nothing.
 */
export function rootPattern(valRoot: string): string {
  return `${valRoot.replace(/\\/g, "/").replace(/\/$/, "")}/**/*`;
}

/**
 * The two UI primitives standard LSP lacks. Both are content-agnostic — they
 * carry no Val types, so they never change when Val changes — and both return
 * `null` when the user dismisses.
 *
 * Registered even though no released Val uses them yet, so that the flip is
 * mechanical rather than another release.
 */
function registerUiPrimitives(client: LanguageClient): void {
  client.onRequest(
    VAL_PICK_REQUEST,
    async (params: ValPickParams): Promise<ValPickResult> => {
      const items = params.items.map((item) => ({
        label: item.label,
        description: item.description,
        detail: item.detail,
        value: item.value,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: params.title,
        placeHolder: params.placeholder,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      return picked ? { value: picked.value } : null;
    },
  );

  client.onRequest(
    VAL_INPUT_REQUEST,
    async (params: ValInputParams): Promise<ValInputResult> => {
      const value = await vscode.window.showInputBox({
        title: params.title,
        prompt: params.prompt,
        value: params.value,
        placeHolder: params.placeholder,
        password: params.password,
      });
      return value === undefined ? null : { value };
    },
  );
}

function readValCapabilities(
  client: LanguageClient,
): ValServerCapabilities | null {
  const experimental = client.initializeResult?.capabilities.experimental as
    | { val?: ValServerCapabilities }
    | undefined;
  const val = experimental?.val;
  // A server that reports no protocol version is not one this client can talk
  // to, whatever else it filled in.
  return val && typeof val.protocolVersion === "number" ? val : null;
}

function extensionVersion(): string | null {
  const version = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON
    ?.version;
  return typeof version === "string" ? version : null;
}

/**
 * Run an action from a notification.
 *
 * A command goes into a terminal rather than a hidden child process: the user
 * asked for it, and they should see exactly what runs and its output.
 */
export function runAction(action: DiagnosisAction, cwd: string): void {
  if (action.kind === "open-url") {
    void vscode.env.openExternal(vscode.Uri.parse(action.value));
    return;
  }
  const terminal = vscode.window.createTerminal({ name: "Val", cwd });
  terminal.show();
  terminal.sendText(action.value);
}
