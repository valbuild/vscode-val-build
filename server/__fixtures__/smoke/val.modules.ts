import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  // Add your modules here
  { def: () => import("./src/dir-one/test-one.val") },
  { def: () => import("./src/test-two.val") },
]);
