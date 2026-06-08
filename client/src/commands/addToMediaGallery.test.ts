import { describe, it, expect } from "@jest/globals";

// Mock vscode module — we only exercise pure helpers here
jest.mock("vscode", () => ({}), { virtual: true });

import {
  findGalleryInsertionPoint,
  generateGalleryEntryText,
} from "./addToMediaGallery";

const MEDIA_FILE = "/project/content/media.val.ts";

describe("addToMediaGallery helpers", () => {
  describe("findGalleryInsertionPoint", () => {
    it("finds the third c.define argument with existing entries", () => {
      const content = `import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({
    accept: "image/*",
    directory: "/public/val/images",
    alt: s.string().minLength(4),
  }),
  {
    "/public/val/images/logo.png": {
      width: 800,
      height: 600,
      mimeType: "image/png",
      alt: "An example image",
    },
  },
);
`;

      const result = findGalleryInsertionPoint(content, MEDIA_FILE);
      expect(result).not.toBeNull();
      expect(result!.hasExistingEntries).toBe(true);
      // Indentation matches the first property's column (4 spaces here)
      expect(result!.indentation).toBe("    ");
      // Insertion position should land at the end of the existing object value
      // (i.e. right after `}`)
      const insertedAt = content.slice(result!.insertPosition, result!.insertPosition + 3);
      expect(insertedAt[0]).toMatch(/[,}\s\n]/);
    });

    it("handles an empty gallery record", () => {
      const content = `import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({ accept: "image/*", directory: "/public/val/images" }),
  {},
);
`;

      const result = findGalleryInsertionPoint(content, MEDIA_FILE);
      expect(result).not.toBeNull();
      expect(result!.hasExistingEntries).toBe(false);
    });

    it("returns null when the file has no c.define export", () => {
      const content = `export default {};
`;
      const result = findGalleryInsertionPoint(content, MEDIA_FILE);
      expect(result).toBeNull();
    });
  });

  describe("generateGalleryEntryText", () => {
    it("emits an entry preceded by comma when entries already exist", () => {
      const text = generateGalleryEntryText({
        filePath: "/public/val/images/avatar.png",
        indentation: "    ",
        hasExistingEntries: true,
        metadata: { width: 800, height: 600, mimeType: "image/png" },
      });
      expect(text).toBe(
        ',\n    "/public/val/images/avatar.png": {\n      width: 800,\n      height: 600,\n      mimeType: "image/png",\n    }',
      );
    });

    it("emits an entry without leading comma when array is empty", () => {
      const text = generateGalleryEntryText({
        filePath: "/public/val/images/avatar.png",
        indentation: "  ",
        hasExistingEntries: false,
        metadata: { mimeType: "image/png" },
      });
      // Inserted directly inside `{}` — opens with newline and indentation
      expect(text).toMatch(/^\n {2}"\/public\/val\/images\/avatar\.png":/);
      expect(text).toContain('mimeType: "image/png"');
    });
  });

  describe("integration", () => {
    it("inserting into an existing record produces valid-looking source", () => {
      const content = `import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({ accept: "image/*", directory: "/public/val/images" }),
  {
    "/public/val/images/logo.png": {
      width: 800,
      height: 600,
      mimeType: "image/png",
    },
  },
);
`;
      const insertion = findGalleryInsertionPoint(content, MEDIA_FILE)!;
      const entry = generateGalleryEntryText({
        filePath: "/public/val/images/avatar.png",
        indentation: insertion.indentation,
        hasExistingEntries: insertion.hasExistingEntries,
        metadata: { width: 200, height: 200, mimeType: "image/png" },
      });
      const next =
        content.slice(0, insertion.insertPosition) +
        entry +
        content.slice(insertion.insertPosition);
      expect(next).toContain('"/public/val/images/logo.png"');
      expect(next).toContain('"/public/val/images/avatar.png"');
      // Old entry still ends with a comma trail, new entry follows
      expect(next.indexOf('"/public/val/images/logo.png"')).toBeLessThan(
        next.indexOf('"/public/val/images/avatar.png"'),
      );
    });
  });
});
