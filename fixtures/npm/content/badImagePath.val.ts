import { c, s } from "../val.config";

// A media path that points outside /public/val/ at a file that is not there:
// the server reports it (`file-not-found`) rather than staying quiet.
//
// Media is a plain object on Val 0.103 and later — `c.image()` was removed from
// @valbuild/core — and a fixture still calling it does not merely fail its own
// check: `val.modules` cannot load it, so every module in the project reports a
// fatal error instead of what it was written to report.
export default c.define("/content/badImagePath.val.ts", s.image(), {
  path: "/public/outside.png",
  width: 944,
  height: 944,
  mimeType: "image/png",
});
