import { featuresForDiagnosticCode } from "./diagnosticFeatures";
import { SuppressedFeatures } from "./suppressedFeatures";

describe("featuresForDiagnosticCode", () => {
  test("a diagnostic with no code is plain validation", () => {
    // Most validation and schema messages carry no code at all.
    expect(featuresForDiagnosticCode(undefined)).toEqual(["diagnostics"]);
  });

  test("maps this server's diagnostic kinds", () => {
    expect(featuresForDiagnosticCode("file-not-found")).toEqual([
      "diagnostics",
    ]);
    expect(featuresForDiagnosticCode("val:missing-module")).toEqual([
      "diagnostics",
      "fix/missing-module",
    ]);
    expect(featuresForDiagnosticCode("invalid-path-directory")).toEqual([
      "diagnostics",
    ]);
  });

  test("a metadata diagnostic needs both the report and the fix", () => {
    expect(featuresForDiagnosticCode("image:add-metadata")).toEqual([
      "diagnostics",
      "fix/metadata",
    ]);
  });

  test("gallery diagnostics map to the gallery flags", () => {
    expect(featuresForDiagnosticCode("image:add-to-gallery")).toEqual([
      "diagnostics/gallery",
      "fix/gallery",
    ]);
    expect(
      featuresForDiagnosticCode("file:move-to-gallery-directory"),
    ).toEqual(["diagnostics/gallery", "fix/gallery"]);
  });

  test("matches remote-file codes despite the hash appended to them", () => {
    // The code is `${fix}:${hash}`, so these cannot be matched exactly.
    expect(featuresForDiagnosticCode("image:upload-remote:91c0")).toEqual([
      "diagnostics",
      "fix/upload-remote",
    ]);
    expect(featuresForDiagnosticCode("file:download-remote:deadbeef")).toEqual([
      "diagnostics",
      "fix/download-remote",
    ]);
  });

  test("an unrecognised code is never suppressed", () => {
    // The safe direction: a diagnostic added later without a mapping keeps being
    // served. A duplicate is noise; a silently missing diagnostic reads as the
    // extension being broken.
    expect(featuresForDiagnosticCode("something:new")).toEqual([]);
    expect(featuresForDiagnosticCode(42)).toEqual([]);
  });
});

describe("arbitration end to end", () => {
  const suppress = (features: string[]) => {
    const suppressed = new SuppressedFeatures();
    suppressed.set("/repo", features);
    return (code: string | undefined) =>
      suppressed.isSuppressed("/repo", featuresForDiagnosticCode(code));
  };

  test("a server serving only diagnostics silences validation but not the fixes it cannot do", () => {
    const isSuppressed = suppress(["diagnostics"]);
    expect(isSuppressed(undefined)).toBe(true);
    expect(isSuppressed("file-not-found")).toBe(true);
    // Reported by the other server but not fixable there, so the fix stays here.
    expect(isSuppressed("val:missing-module")).toBe(false);
    // Remote upload is not served, so this server keeps offering it.
    expect(isSuppressed("image:upload-remote:91c0")).toBe(false);
    expect(isSuppressed("image:add-metadata")).toBe(false);
    // Galleries are a separate flag.
    expect(isSuppressed("image:add-to-gallery")).toBe(false);
  });

  test("a server serving diagnostics and the metadata fix silences metadata too", () => {
    const isSuppressed = suppress(["diagnostics", "fix/metadata"]);
    expect(isSuppressed("image:add-metadata")).toBe(true);
    expect(isSuppressed("file:add-metadata")).toBe(true);
  });

  test("galleries stay with this server until both gallery flags are served", () => {
    expect(suppress(["diagnostics/gallery"])("image:add-to-gallery")).toBe(
      false,
    );
    expect(
      suppress(["diagnostics/gallery", "fix/gallery"])("image:add-to-gallery"),
    ).toBe(true);
  });

  test("matches what @valbuild/language-server 0.98.0 actually advertises", () => {
    // Copied from a real handshake, so this is parity against the shipped
    // server rather than against the flag list as documented.
    const isSuppressed = suppress([
      "diagnostics",
      "fix/metadata",
      "completions/mediaPath",
      "completions/keyOf",
      "completions/route",
      "fix/gallery",
      "completions/galleryKey",
      "completions/richtextLink",
    ]);
    // Handed over: it reports these and can fix them.
    expect(isSuppressed(undefined)).toBe(true);
    expect(isSuppressed("file-not-found")).toBe(true);
    expect(isSuppressed("image:add-metadata")).toBe(true);
    // Kept: 0.98.0 does not advertise these, so dropping them here would lose
    // the feature outright.
    expect(isSuppressed("val:missing-module")).toBe(false);
    expect(isSuppressed("image:upload-remote:91c0")).toBe(false);
    expect(isSuppressed("file:download-remote:91c0")).toBe(false);
    // It advertises `fix/gallery` but not `diagnostics/gallery` — it can fix a
    // gallery problem but does not detect one — so detection stays here.
    expect(isSuppressed("image:add-to-gallery")).toBe(false);
  });

  test("nothing is suppressed when no project server is running", () => {
    const suppressed = new SuppressedFeatures();
    for (const code of [
      undefined,
      "file-not-found",
      "image:add-metadata",
      "image:add-to-gallery",
    ]) {
      expect(
        suppressed.isSuppressed("/repo", featuresForDiagnosticCode(code)),
      ).toBe(false);
    }
  });
});
