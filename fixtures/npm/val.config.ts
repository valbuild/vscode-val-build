import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal({
  project: "valbuild/resolution-fixture",
});

export type { t } from "@valbuild/next";
export { s, c, val, config };
