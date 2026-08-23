import {
  addCommand,
  installCommand,
  upgradeCommand,
  type PackageManager,
} from "./packageManager";
import type { ResolvedLanguageServer } from "./resolveLanguageServer";
import {
  isTooOldForLanguageServer,
  VAL_LANGUAGE_SERVER,
  type DetectedValVersion,
} from "./valVersion";
import type { ProtocolNegotiationResult } from "./valProtocol";

/**
 * Turning "the language server did not start" into something the user can act
 * on.
 *
 * The behaviour is a hard fail with an actionable message: no bundled fallback
 * pretending to be the project's Val, and no silent version mismatch. But "not
 * resolvable" covers several different situations whose fixes have nothing in
 * common — a Val upgrade, a dependency reinstall, an extension update — so this
 * module's job is to keep them apart. A generic "could not start the Val
 * language server" would be worse than nothing.
 *
 * Kept free of `vscode` imports, and returning message text rather than showing
 * it, so every branch of the table is unit-testable.
 */

export const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=valbuild.vscode-val-build";

/** An action offered on the notification. */
export type DiagnosisAction = {
  /** Button label. */
  title: string;
  /**
   * What the action does. `run-command` executes a shell command the user can
   * see first; `open-url` opens a link.
   */
  kind: "run-command" | "open-url";
  /** The shell command, or the URL. */
  value: string;
};

export type LanguageServerDiagnosis =
  | {
      kind: "ok";
      resolved: ResolvedLanguageServer;
      valVersion: DetectedValVersion | null;
    }
  /**
   * No `@valbuild/*` resolves at all: not a Val project, or dependencies are not
   * installed. Say nothing — every TypeScript project in the workspace would
   * otherwise get nagged.
   */
  | { kind: "silent"; reason: "not-a-val-project" }
  | {
      kind: "problem";
      reason: "val-too-old" | "no-carrier-package" | "server-unresolvable";
      message: string;
      actions: DiagnosisAction[];
    };

/**
 * Decide what to tell the user, given what resolution found.
 *
 * `resolved` is the result of `resolveLanguageServer`, `detected` the result of
 * `detectValVersion` — both are passed in rather than looked up here so that
 * every row of the table can be exercised without a filesystem.
 */
export function diagnoseLanguageServer({
  resolved,
  detected,
  packageManager,
}: {
  resolved: ResolvedLanguageServer | null;
  detected: DetectedValVersion | null;
  packageManager: PackageManager;
}): LanguageServerDiagnosis {
  if (resolved) {
    return { kind: "ok", resolved, valVersion: detected };
  }
  if (!detected) {
    return { kind: "silent", reason: "not-a-val-project" };
  }
  if (!detected.carriesLanguageServer) {
    // The project has Val libraries but nothing that ships a language server.
    // Usually a project depending on @valbuild/core directly. Nothing to
    // upgrade: the server travels inside a framework or CLI package, so one has
    // to be added. Telling this project to "upgrade @valbuild/core" would point
    // it at a release that may never exist — core is versioned separately and
    // cannot carry the server at all, since the server depends on it.
    return {
      kind: "problem",
      reason: "no-carrier-package",
      message:
        `${VAL_LANGUAGE_SERVER} could not be resolved from this project. ` +
        `It ships inside Val's framework and CLI packages — @valbuild/next for Next.js, ` +
        `@valbuild/tanstackstart-react for TanStack Start, or @valbuild/cli for any project. ` +
        `This project has ${detected.packageName} ${detected.version} but none of those.`,
      actions: [
        {
          title: "Add @valbuild/cli",
          kind: "run-command",
          value: addCommand(packageManager, "@valbuild/cli"),
        },
      ],
    };
  }
  if (isTooOldForLanguageServer(detected)) {
    // The common case, and the only one where the fix is a Val upgrade rather
    // than anything to do with this extension. Deliberately an *upgrade* of the
    // package the project already depends on — whichever that is — not an add of
    // a new one.
    return {
      kind: "problem",
      reason: "val-too-old",
      message:
        `${VAL_LANGUAGE_SERVER} ships with ${detected.packageName} ` +
        `${detected.shipsSince} and later — this project has ${detected.version}.`,
      actions: [
        {
          title: `Upgrade ${detected.packageName}`,
          kind: "run-command",
          value: upgradeCommand(packageManager, detected.packageName),
        },
      ],
    };
  }
  // The project depends on a package that should ship the language server, and
  // either it is new enough or there is no known floor to judge it by — so the
  // server should be there and is not. Upgrading is still the most likely fix
  // (this build may simply not know when that package started shipping it);
  // beyond that it is a broken install, or Yarn PnP, where there is no
  // `node_modules` for path resolution to walk at all.
  return {
    kind: "problem",
    reason: "server-unresolvable",
    message:
      `${VAL_LANGUAGE_SERVER} could not be resolved from this project, ` +
      `though ${detected.packageName} ${detected.version} should include it. ` +
      `Upgrading ${detected.packageName} or reinstalling dependencies usually fixes this. ` +
      `Under Yarn PnP there is no node_modules to resolve through — set ` +
      `valBuild.languageServerPath to the server entry instead.`,
    actions: [
      {
        title: `Upgrade ${detected.packageName}`,
        kind: "run-command",
        value: upgradeCommand(packageManager, detected.packageName),
      },
      {
        title: "Reinstall dependencies",
        kind: "run-command",
        value: installCommand(packageManager),
      },
      {
        title: `Add ${VAL_LANGUAGE_SERVER}`,
        kind: "run-command",
        value: addCommand(packageManager, VAL_LANGUAGE_SERVER),
      },
    ],
  };
}

/**
 * Describe a failed protocol negotiation.
 *
 * The direction is the entire point: `client-too-old` means update this
 * extension, `server-too-old` means update Val in the project. Both versions go
 * in the message so a bug report has them.
 */
export function describeIncompatibility(
  incompatible: Exclude<ProtocolNegotiationResult, { status: "ok" }>,
  versions: { core: string | null; languageServer: string | null },
  packageManager: PackageManager,
): { message: string; actions: DiagnosisAction[] } {
  const serverVersion =
    versions.languageServer ?? versions.core ?? "unknown version";
  const range = (r: { min: number; max: number }) =>
    r.min === r.max ? `v${r.min}` : `v${r.min}-v${r.max}`;
  const detail =
    `Val ${serverVersion} speaks protocol ${range(incompatible.server)}; ` +
    `this extension speaks ${range(incompatible.client)}.`;

  if (incompatible.status === "client-too-old") {
    return {
      message: `Update the Val extension to work with the Val in this project. ${detail}`,
      actions: [
        {
          title: "Open Marketplace",
          kind: "open-url",
          value: MARKETPLACE_URL,
        },
      ],
    };
  }
  return {
    message: `Update Val in this project to work with this version of the Val extension. ${detail}`,
    actions: [
      {
        title: "Upgrade @valbuild/next",
        kind: "run-command",
        value: upgradeCommand(packageManager, "@valbuild/next"),
      },
    ],
  };
}
