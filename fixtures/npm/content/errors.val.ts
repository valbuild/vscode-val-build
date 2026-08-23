import { c, s } from "../val.config";

// Deliberately too short for the schema: a plain validation error.
export default c.define(
  "/content/errors.val.ts",
  s.string().minLength(30),
  "Hello World",
);
