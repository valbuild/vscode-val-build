import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";

export default modules(config, [
  // A route module: named after the route file it serves, and typed with
  // `s.router(tanstackRouter, ...)`. The whole point of the fixture.
  { def: () => import("./src/routes/_site.posts.$postId.val") },
  { def: () => import("./src/content/errors.val") },
]);
