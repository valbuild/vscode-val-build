import { describe, it, expect } from "@jest/globals";

// Mock vscode module — we only exercise pure helpers here
jest.mock("vscode", () => ({}), { virtual: true });

import {
  findGalleryProperty,
  getEntryRemovalRange,
} from "./removeGalleryEntry";

const MEDIA_FILE = "/project/content/media.val.ts";

function gallery(...entries: string[]): string {
  const body = entries
    .map(
      (key) =>
        `  ${JSON.stringify(key)}: { width: 1, height: 1, mimeType: "image/png" }`,
    )
    .join(",\n");
  return `import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({ accept: "image/*", directory: "/public/val/images" }),
  {
${body},
  },
);
`;
}

// Apply the removal range to the content, returning the resulting source.
function applyRemoval(content: string, key: string): string {
  const range = getEntryRemovalRange(content, MEDIA_FILE, key);
  if (!range) throw new Error("no range");
  return content.slice(0, range.start) + content.slice(range.end);
}

describe("removeGalleryEntry helpers", () => {
  describe("findGalleryProperty", () => {
    it("finds the property with the matching key", () => {
      const content = gallery("/public/val/images/a.png");
      const prop = findGalleryProperty(
        content,
        MEDIA_FILE,
        "/public/val/images/a.png",
      );
      expect(prop).toBeDefined();
    });

    it("returns undefined for a missing key", () => {
      const content = gallery("/public/val/images/a.png");
      const prop = findGalleryProperty(content, MEDIA_FILE, "/nope.png");
      expect(prop).toBeUndefined();
    });
  });

  describe("getEntryRemovalRange", () => {
    it("removes a middle entry and keeps siblings", () => {
      const content = gallery(
        "/public/val/images/a.png",
        "/public/val/images/b.png",
        "/public/val/images/c.png",
      );
      const result = applyRemoval(content, "/public/val/images/b.png");
      expect(result).not.toContain("b.png");
      expect(result).toContain("a.png");
      expect(result).toContain("c.png");
      // No doubled or dangling commas
      expect(result).not.toContain(",,");
    });

    it("removes the only entry leaving an empty record", () => {
      const content = gallery("/public/val/images/a.png");
      const result = applyRemoval(content, "/public/val/images/a.png");
      expect(result).not.toContain("a.png");
      expect(result).toContain("c.define");
    });

    it("removes the last entry of several", () => {
      const content = gallery(
        "/public/val/images/a.png",
        "/public/val/images/b.png",
      );
      const result = applyRemoval(content, "/public/val/images/b.png");
      expect(result).not.toContain("b.png");
      expect(result).toContain("a.png");
      expect(result).not.toContain(",,");
    });
  });
});
