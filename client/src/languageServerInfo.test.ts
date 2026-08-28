import { formatLanguageServerInfo } from "./languageServerInfo";
import type { ProjectServerSession } from "./projectLanguageServers";

const running: ProjectServerSession = {
  valRoot: "/repo/apps/web",
  resolved: {
    entry: "/repo/apps/web/node_modules/@valbuild/language-server/bin.js",
    version: "0.98.0",
    via: "@valbuild/next",
    override: null,
  },
  valVersion: { version: "0.98.0", packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
  capabilities: {
    protocolVersion: 1,
    versions: { core: "0.98.0", languageServer: "0.98.0" },
    valRoot: "/repo/apps/web",
    features: ["diagnostics", "fix/metadata"],
    commands: [],
  },
  features: ["diagnostics", "fix/metadata"],
  state: "running",
};

describe("formatLanguageServerInfo", () => {
  test("reports path, version, anchor and negotiated protocol", () => {
    const report = formatLanguageServerInfo({
      sessions: [running],
      workspaceRoots: ["/repo/apps/web"],
    });
    expect(report).toContain(
      "/repo/apps/web/node_modules/@valbuild/language-server/bin.js",
    );
    expect(report).toContain("resolved via:     @valbuild/next");
    expect(report).toContain("protocol version: 1");
    expect(report).toContain("diagnostics, fix/metadata");
    expect(report).toContain("override:         none");
  });

  test("names the override, so it is never invisible", () => {
    // The failure this prevents: debugging against a stale local checkout for an
    // hour because a setting from last week is still pointing at it.
    const report = formatLanguageServerInfo({
      workspaceRoots: ["/repo"],
      sessions: [
        {
          ...running,
          resolved: {
            entry: "/checkout/packages/language-server/bin.js",
            version: "0.99.0-dev",
            via: "valBuild.languageServerPath",
            override: {
              kind: "setting",
              source: "valBuild.languageServerPath",
              path: "/checkout/packages/language-server/bin.js",
            },
          },
        },
      ],
    });
    expect(report).toContain(
      "override:         valBuild.languageServerPath = /checkout/packages/language-server/bin.js",
    );
    expect(report).toContain("0.99.0-dev");
  });

  test("explains an idle root rather than looking broken", () => {
    // A Val root with no server is the "not a Val project, or dependencies are
    // not installed" case, which is silent by design. The report is the only
    // place that says so, so it has to say which of the two happened.
    const report = formatLanguageServerInfo({
      sessions: [],
      workspaceRoots: ["/repo"],
    });
    expect(report).toContain("No language servers running.");
    expect(report).toContain("skipped silently by design");
  });

  test("says so when the workspace has no Val root at all", () => {
    const report = formatLanguageServerInfo({
      sessions: [],
      workspaceRoots: [],
    });
    expect(report).toContain("Val roots in workspace: none");
    expect(report).toContain("No Val root was found in this workspace.");
  });

  test("reports why a root failed instead of omitting it", () => {
    const report = formatLanguageServerInfo({
      workspaceRoots: ["/repo"],
      sessions: [
        {
          valRoot: "/repo",
          resolved: {
            entry: "",
            version: null,
            via: "unresolved",
            override: null,
          },
          valVersion: { version: "0.97.7", packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
          capabilities: null,
          features: [],
          state: "failed",
          detail:
            "@valbuild/language-server ships with @valbuild/next 0.98.0 and later",
        },
      ],
    });
    expect(report).toContain("state:            failed");
    expect(report).toContain("0.97.7 (from @valbuild/next)");
    expect(report).toContain("ships with @valbuild/next 0.98.0 and later");
  });

  test("lists every root in a multi-root workspace", () => {
    const report = formatLanguageServerInfo({
      workspaceRoots: ["/repo/a", "/repo/b"],
      sessions: [
        running,
        { ...running, valRoot: "/repo/b", state: "incompatible" },
      ],
    });
    expect(report).toContain("--- /repo/apps/web ---");
    expect(report).toContain("--- /repo/b ---");
    expect(report).toContain("/repo/a, /repo/b");
  });
});
