import {
  negotiateProtocolVersion as publishedNegotiate,
  PROTOCOL_VERSION as PUBLISHED_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS as PUBLISHED_SUPPORTED,
  VAL_FEATURES as PUBLISHED_FEATURES,
  VAL_INPUT_REQUEST as PUBLISHED_INPUT_REQUEST,
  VAL_PICK_REQUEST as PUBLISHED_PICK_REQUEST,
} from "@valbuild/language-server";
import {
  CLIENT_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  VAL_FEATURES,
  VAL_INPUT_REQUEST,
  VAL_PICK_REQUEST,
} from "./valProtocol";

/**
 * A value import of `@valbuild/language-server` is fine *here* and nowhere else
 * in `client/src`: tests are never bundled into `client/out/extension.js`. In
 * production code it would pull the whole server into the VSIX and pin the
 * contract to one version of Val — which is why
 * `@typescript-eslint/consistent-type-imports` is an error for this directory.
 */

describe("negotiateProtocolVersion", () => {
  test("picks the highest version both sides can speak", () => {
    expect(
      negotiateProtocolVersion({ min: 1, max: 3 }, { min: 2, max: 5 }),
    ).toEqual({ status: "ok", protocolVersion: 3 });
  });

  test("succeeds when the ranges only touch at one version", () => {
    expect(
      negotiateProtocolVersion({ min: 1, max: 2 }, { min: 2, max: 4 }),
    ).toEqual({ status: "ok", protocolVersion: 2 });
  });

  test("says client-too-old when the server is newer", () => {
    // Directional on purpose: this is what turns "incompatible versions" into
    // "update the Val extension".
    expect(
      negotiateProtocolVersion({ min: 1, max: 2 }, { min: 3, max: 4 }),
    ).toEqual({
      status: "client-too-old",
      client: { min: 1, max: 2 },
      server: { min: 3, max: 4 },
    });
  });

  test("says server-too-old when the server is older", () => {
    expect(
      negotiateProtocolVersion({ min: 3, max: 4 }, { min: 1, max: 2 }),
    ).toEqual({
      status: "server-too-old",
      client: { min: 3, max: 4 },
      server: { min: 1, max: 2 },
    });
  });
});

describe("the vendored client contract", () => {
  // This is the invariant the whole design rests on: one published extension
  // works against many versions of Val. A server may raise its `max` freely;
  // this client keeps working until Val deliberately raises its `min`, which is
  // a breaking change on Val's side and reported as `server-too-old`.
  test("keeps working against every future server that still serves v1", () => {
    for (const serverMax of [1, 2, 3, 17, 1000]) {
      expect(
        negotiateProtocolVersion(CLIENT_PROTOCOL_VERSIONS, {
          min: 1,
          max: serverMax,
        }),
      ).toEqual({ status: "ok", protocolVersion: 1 });
    }
  });

  test("reports client-too-old once a server drops v1", () => {
    expect(
      negotiateProtocolVersion(CLIENT_PROTOCOL_VERSIONS, { min: 2, max: 2 })
        .status,
    ).toBe("client-too-old");
  });

  test("the client range is non-empty", () => {
    expect(CLIENT_PROTOCOL_VERSIONS.min).toBeLessThanOrEqual(
      CLIENT_PROTOCOL_VERSIONS.max,
    );
  });
});

describe("no drift from the published package", () => {
  // The runtime values must stay vendored — negotiation has to work before, and
  // independently of, whichever server resolves, including when none does. But
  // vendored is not the same as unchecked: these compare the copies against the
  // real thing, so a change on Val's side fails here instead of at a user.
  test("request names match", () => {
    expect(VAL_PICK_REQUEST).toBe(PUBLISHED_PICK_REQUEST);
    expect(VAL_INPUT_REQUEST).toBe(PUBLISHED_INPUT_REQUEST);
  });

  test("the vendored negotiation agrees with the published one everywhere", () => {
    for (let clientMin = 1; clientMin <= 4; clientMin++) {
      for (let clientMax = clientMin; clientMax <= 4; clientMax++) {
        for (let serverMin = 1; serverMin <= 4; serverMin++) {
          for (let serverMax = serverMin; serverMax <= 4; serverMax++) {
            const client = { min: clientMin, max: clientMax };
            const server = { min: serverMin, max: serverMax };
            expect(negotiateProtocolVersion(client, server)).toEqual(
              publishedNegotiate(client, server),
            );
          }
        }
      }
    }
  });

  test("the feature list is not missing anything the server can announce", () => {
    // A flag missing from the vendored list is not a failure at runtime — an
    // unknown string is meant to be ignored — but it does mean this client has
    // no UI for a capability Val now has. Worth knowing at build time.
    const unknown = PUBLISHED_FEATURES.filter(
      (feature) => !(VAL_FEATURES as readonly string[]).includes(feature),
    );
    expect(unknown).toEqual([]);
  });

  test("the vendored list invents nothing the server does not have", () => {
    const invented = VAL_FEATURES.filter(
      (feature) => !(PUBLISHED_FEATURES as readonly string[]).includes(feature),
    );
    expect(invented).toEqual([]);
  });

  test("this client's range is one the published server still serves", () => {
    // The check that would have caught a release raising `min` past us.
    expect(
      publishedNegotiate(CLIENT_PROTOCOL_VERSIONS, PUBLISHED_SUPPORTED).status,
    ).toBe("ok");
    expect(PUBLISHED_SUPPORTED.max).toBe(PUBLISHED_PROTOCOL_VERSION);
  });

  test("feature flags are unique", () => {
    expect(new Set(VAL_FEATURES).size).toBe(VAL_FEATURES.length);
  });
});
