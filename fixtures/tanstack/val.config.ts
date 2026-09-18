import { initVal } from "@valbuild/tanstack";

const { s, c, val, config, tanstackRouter } = initVal({
  project: "valbuild/resolution-fixture-tanstack",
});

export type { t } from "@valbuild/tanstack";
export { s, c, val, config, tanstackRouter };
