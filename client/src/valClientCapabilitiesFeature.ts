import type {
  ClientCapabilities,
  FeatureState,
  StaticFeature,
} from "vscode-languageclient";
import type { ValClientCapabilities } from "./valProtocol";

/**
 * Announces this client's Val capabilities under
 * `capabilities.experimental.val`, so the server knows whether it may offer
 * flows that need user interaction.
 *
 * A `StaticFeature` rather than a hand-built `InitializeParams`, because
 * `LanguageClient` owns the params it sends and merging into them afterwards
 * would be overwritten.
 */
export class ValClientCapabilitiesFeature implements StaticFeature {
  constructor(private readonly capabilities: ValClientCapabilities) {}

  fillClientCapabilities(capabilities: ClientCapabilities): void {
    // Merge rather than assign: `experimental` is a shared bag, and other
    // features may have written to it already.
    const experimental = (capabilities.experimental ?? {}) as Record<
      string,
      unknown
    >;
    experimental.val = this.capabilities;
    capabilities.experimental = experimental;
  }

  initialize(): void {
    // Nothing to wire up: the request handlers are registered on the client
    // itself, because they must outlive any single feature's lifecycle.
  }

  getState(): FeatureState {
    return { kind: "static" };
  }

  clear(): void {
    // Called when the client stops or restarts. There is no state to drop: what
    // this feature announces is a constant.
  }

  dispose(): void {
    // Nothing to dispose.
  }
}
