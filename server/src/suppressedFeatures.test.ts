import { SuppressedFeatures } from "./suppressedFeatures";

describe("SuppressedFeatures", () => {
  test("serves everything until told otherwise", () => {
    const suppressed = new SuppressedFeatures();
    expect(suppressed.isEmpty).toBe(true);
    expect(suppressed.isSuppressed("/repo", ["diagnostics"])).toBe(false);
  });

  test("suppresses a feature the project server advertised", () => {
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", ["diagnostics", "completions/keyOf"]);
    expect(suppressed.isSuppressed("/repo", ["diagnostics"])).toBe(true);
    expect(suppressed.isSuppressed("/repo", ["completions/keyOf"])).toBe(true);
    expect(suppressed.isSuppressed("/repo", ["completions/route"])).toBe(false);
  });

  test("only suppresses a feature covering several flags when all are served", () => {
    // Route completion here also answers richtext hrefs. Dropping it because
    // only one of the two is served would silently lose the other, and a missing
    // completion reads as a broken extension where a duplicate reads as noise.
    const suppressed = new SuppressedFeatures();
    const routeProvider = ["completions/route", "completions/richtextLink"];
    suppressed.set("/repo", ["completions/route"]);
    expect(suppressed.isSuppressed("/repo", routeProvider)).toBe(false);
    suppressed.set("/repo", ["completions/route", "completions/richtextLink"]);
    expect(suppressed.isSuppressed("/repo", routeProvider)).toBe(true);
  });

  test("keeps roots independent, so one package's server cannot mute another", () => {
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo/a", ["diagnostics"]);
    expect(suppressed.isSuppressed("/repo/a", ["diagnostics"])).toBe(true);
    expect(suppressed.isSuppressed("/repo/b", ["diagnostics"])).toBe(false);
  });

  test("an empty list restores everything for that root", () => {
    // What arrives when a project server is stopped as incompatible: this server
    // has to start serving again, or the user is left with no diagnostics at all.
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", ["diagnostics"]);
    suppressed.set("/repo", []);
    expect(suppressed.isSuppressed("/repo", ["diagnostics"])).toBe(false);
    expect(suppressed.isEmpty).toBe(true);
  });

  test("replaces rather than accumulates", () => {
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", ["diagnostics", "completions/route"]);
    suppressed.set("/repo", ["diagnostics"]);
    expect(suppressed.isSuppressed("/repo", ["completions/route"])).toBe(false);
  });

  test("a feature mapping to no flag is never suppressed", () => {
    // Media galleries, remote upload/download and login have no counterpart in
    // an advertised flag yet; they must keep working.
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", ["diagnostics"]);
    expect(suppressed.isSuppressed("/repo", [])).toBe(false);
  });

  test("ignores unknown flags rather than choking on them", () => {
    // A newer Val advertises features this build has never heard of.
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", ["diagnostics", "something/new"]);
    expect(suppressed.isSuppressed("/repo", ["diagnostics"])).toBe(true);
    expect(suppressed.describe("/repo")).toEqual([
      "diagnostics",
      "something/new",
    ]);
  });
});
