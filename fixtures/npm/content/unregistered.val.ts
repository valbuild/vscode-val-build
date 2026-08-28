import { c, s } from "../val.config";

// Deliberately absent from val.modules.ts: the missing-module diagnostic.
export default c.define(
  "/content/unregistered.val.ts",
  s.string(),
  "Not registered",
);
