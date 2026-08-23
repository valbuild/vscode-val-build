/**
 * Which of this bundled server's features the project's own Val language server
 * has taken over.
 *
 * While `valBuild.useProjectLanguageServer` is on, two servers can be alive for
 * the same file: this one, and the one that ships with the Val installed in the
 * project. If both publish diagnostics the user sees every problem twice, and if
 * both answer completions the list is doubled. So the client tells us which
 * features the project's server actually advertised, and we stop serving those.
 *
 * Per Val root, because a monorepo may have a project server for one package and
 * none for another.
 *
 * ## Why a notification rather than `initializationOptions`
 *
 * The feature list only exists once the project's server has completed its
 * `initialize` handshake, which cannot have happened before this server's own
 * `initialize`. Sending it later also means a project server that restarts, or
 * that is stopped because its protocol version did not negotiate, can correct
 * the arbitration without restarting this server.
 */

/** Sent by the client whenever a Val root's served features change. */
export const VAL_SUPPRESS_FEATURES_NOTIFICATION = "val/suppressFeatures";

export type SuppressFeaturesParams = {
  valRoot: string;
  /**
   * The `features` array the project's server advertised. Empty means "serve
   * everything again" — no project server, or one that was stopped.
   */
  features: string[];
};

export class SuppressedFeatures {
  private readonly byValRoot = new Map<string, Set<string>>();

  /** Replace what is suppressed for one root. Empty restores everything. */
  set(valRoot: string, features: string[]): void {
    if (features.length === 0) {
      this.byValRoot.delete(valRoot);
      return;
    }
    this.byValRoot.set(valRoot, new Set(features));
  }

  clear(): void {
    this.byValRoot.clear();
  }

  /** Whether any root has anything suppressed — a cheap "nothing to do" check. */
  get isEmpty(): boolean {
    return this.byValRoot.size === 0;
  }

  /**
   * Whether **every** listed feature is served by the project's server for this
   * root, which is the only case in which it is safe to stop serving it here.
   *
   * The "every" is deliberate. Some of this server's features cover more than
   * one flag — route completion also answers richtext hrefs — and dropping it
   * because one of the two is served would silently lose the other. A duplicate
   * entry in a completion list is a nuisance; a missing completion looks like a
   * broken extension.
   *
   * An empty list is never suppressed: a feature that maps to no flag has no
   * counterpart to defer to.
   */
  isSuppressed(valRoot: string, features: readonly string[]): boolean {
    if (features.length === 0) {
      return false;
    }
    const served = this.byValRoot.get(valRoot);
    if (!served) {
      return false;
    }
    return features.every((feature) => served.has(feature));
  }

  /** For logging: what is suppressed for a root, in a stable order. */
  describe(valRoot: string): string[] {
    return [...(this.byValRoot.get(valRoot) ?? [])].sort();
  }
}
