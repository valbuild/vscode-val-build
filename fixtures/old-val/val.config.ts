import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal({
  project: "valbuild/old-val-fixture",
});

export type { t } from "@valbuild/next";
export { s, c, val, config };
