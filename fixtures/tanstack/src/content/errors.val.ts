import { c, s } from "../../val.config";

// Deliberately too short for the schema: a plain validation error, so the
// integration suite can prove the server's diagnostics reach the editor.
export default c.define(
  "/src/content/errors.val.ts",
  s.string().minLength(30),
  "Hello World",
);
