import { c, s, tanstackRouter } from "../../val.config";

/*
 * A TanStack Start route module: `src/routes/_site.posts.$postId.tsx` is served
 * by this file, and the record's keys are the URLs that file's pattern matches.
 *
 * Here to prove the language server understands TanStack's route conventions —
 * it has to read the pattern out of the *file name* to know that
 * `/posts/hello-world` is a key this module may have.
 */
export default c.define(
  "/src/routes/_site.posts.$postId.val.ts",
  s.router(tanstackRouter, s.object({ title: s.string() })),
  {
    "/posts/hello-world": { title: "Hello world" },
  },
);
