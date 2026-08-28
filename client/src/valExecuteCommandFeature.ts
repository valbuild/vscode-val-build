import { ExecuteCommandRequest } from "vscode-languageclient";
import type {
  ClientCapabilities,
  DynamicFeature,
  ExecuteCommandRegistrationOptions,
  FeatureState,
  RegistrationData,
  RegistrationType,
  ServerCapabilities,
} from "vscode-languageclient";
import type {
  ServerCommandExecutor,
  ServerCommandRouter,
} from "./serverCommands";

/**
 * Registers one server's commands through {@link ServerCommandRouter} instead of
 * with VS Code directly.
 *
 * This replaces `vscode-languageclient`'s own `ExecuteCommandFeature`, which
 * calls `commands.registerCommand` once per server for every name the server
 * announces. VS Code's command registry is global and `registerCommand` throws
 * on a duplicate, so with one server per Val root that is a collision — thrown
 * from inside `initialize`, which fails the handshake and leaves the user with no
 * Val at all rather than with one missing command. See `serverCommands.ts`.
 *
 * Everything else about it is deliberately the same, including announcing
 * `workspace.executeCommand` support: dropping the built-in feature must not
 * make this client look like one that cannot run commands, or a server would be
 * right to stop offering them.
 */
export class ValExecuteCommandFeature
  implements DynamicFeature<ExecuteCommandRegistrationOptions>
{
  /** Registration ids handed to the router, so `clear()` can take them back. */
  private readonly registrationIds = new Set<string>();
  private nextStaticId = 0;

  constructor(
    private readonly valRoot: string,
    private readonly router: ServerCommandRouter,
    private readonly execute: ServerCommandExecutor,
  ) {}

  get registrationType(): RegistrationType<ExecuteCommandRegistrationOptions> {
    return ExecuteCommandRequest.type;
  }

  fillClientCapabilities(capabilities: ClientCapabilities): void {
    const workspace = capabilities.workspace ?? {};
    workspace.executeCommand = {
      ...workspace.executeCommand,
      dynamicRegistration: true,
    };
    capabilities.workspace = workspace;
  }

  initialize(capabilities: ServerCapabilities): void {
    if (!capabilities.executeCommandProvider) {
      return;
    }
    this.register({
      // A static registration has no server-supplied id, and the protocol says
      // nothing about what one should look like.
      id: `static-${this.nextStaticId++}`,
      registerOptions: { ...capabilities.executeCommandProvider },
    });
  }

  register(data: RegistrationData<ExecuteCommandRegistrationOptions>): void {
    const commands = data.registerOptions.commands ?? [];
    if (commands.length === 0) {
      return;
    }
    this.registrationIds.add(data.id);
    this.router.add({
      id: data.id,
      valRoot: this.valRoot,
      commands,
      execute: this.execute,
    });
  }

  unregister(id: string): void {
    this.registrationIds.delete(id);
    this.router.remove(this.valRoot, id);
  }

  getState(): FeatureState {
    return {
      kind: "workspace",
      id: ExecuteCommandRequest.method,
      registrations: this.registrationIds.size > 0,
    };
  }

  /** Called when the client stops or restarts: this root serves nothing now. */
  clear(): void {
    for (const id of this.registrationIds) {
      this.router.remove(this.valRoot, id);
    }
    this.registrationIds.clear();
  }
}
