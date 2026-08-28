import { c, s } from "../val.config";

// Deliberately outside /public/val/: the bundled server reports this as
// `invalid-path-location`.
export default c.define(
  "/content/badImagePath.val.ts",
  s.image(),
  c.image("/public/outside.png"),
);
