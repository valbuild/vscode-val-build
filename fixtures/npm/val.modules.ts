import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/valid.val") },
  { def: () => import("./content/errors.val") },
  { def: () => import("./content/badImagePath.val") },
]);
