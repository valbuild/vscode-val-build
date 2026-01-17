import assert from "assert";
import path from "path";
import fs from "fs";
import { PublicValFilesCache } from "./publicValFilesCache";

describe("PublicValFilesCache", () => {
  const fixtureRoot = path.join(__dirname, "../__fixtures__/public-val-files");

  describe("initialize", () => {
    it("should scan and cache all files in /public/val directory", async () => {
      const cache = new PublicValFilesCache();

      await cache.initialize(fixtureRoot);

      const files = cache.getFiles(fixtureRoot);

      // Should find all files recursively
      assert.ok(files.length > 0, "Should find files");

      // Check for specific files
      assert.ok(
        files.includes("/public/val/logo.png"),
        "Should include logo.png",
      );
      assert.ok(
        files.includes("/public/val/icon.svg"),
        "Should include icon.svg",
      );
      assert.ok(
        files.includes("/public/val/banner.jpg"),
        "Should include banner.jpg",
      );
      assert.ok(
        files.includes("/public/val/data.json"),
        "Should include data.json",
      );
      assert.ok(
        files.includes("/public/val/document.pdf"),
        "Should include document.pdf",
      );

      // Check for nested files
      assert.ok(
        files.includes("/public/val/images/product1.png"),
        "Should include nested images/product1.png",
      );
      assert.ok(
        files.includes("/public/val/documents/manual.pdf"),
        "Should include nested documents/manual.pdf",
      );
      assert.ok(
        files.includes("/public/val/nested/deep/deep-image.png"),
        "Should include deeply nested file",
      );

      cache.dispose();
    });

    it("should return empty array when /public/val directory does not exist", async () => {
      const cache = new PublicValFilesCache();
      const nonExistentRoot = path.join(
        __dirname,
        "../__fixtures__/non-existent",
      );

      await cache.initialize(nonExistentRoot);

      const files = cache.getFiles(nonExistentRoot);

      assert.strictEqual(files.length, 0, "Should return empty array");

      cache.dispose();
    });

    it("should handle multiple val roots independently", async () => {
      const cache = new PublicValFilesCache();

      await cache.initialize(fixtureRoot);

      const files1 = cache.getFiles(fixtureRoot);
      const files2 = cache.getFiles("/some/other/root");

      assert.ok(files1.length > 0, "Should have files for fixture root");
      assert.strictEqual(
        files2.length,
        0,
        "Should have no files for uninitialized root",
      );

      cache.dispose();
    });
  });

  describe("getFiles", () => {
    it("should return all cached files for a val root", async () => {
      const cache = new PublicValFilesCache();

      await cache.initialize(fixtureRoot);

      const files = cache.getFiles(fixtureRoot);

      // Verify all expected files are present
      const expectedFiles = [
        "/public/val/logo.png",
        "/public/val/icon.svg",
        "/public/val/banner.jpg",
        "/public/val/favicon.ico",
        "/public/val/photo.webp",
        "/public/val/header.gif",
        "/public/val/thumbnail.bmp",
        "/public/val/styles.css",
        "/public/val/data.json",
        "/public/val/document.pdf",
        "/public/val/script.js",
        "/public/val/README.md",
        "/public/val/images/product1.png",
        "/public/val/images/product2.jpg",
        "/public/val/documents/manual.pdf",
        "/public/val/documents/report.txt",
        "/public/val/nested/deep/deep-image.png",
      ];

      for (const expectedFile of expectedFiles) {
        assert.ok(
          files.includes(expectedFile),
          `Should include ${expectedFile}`,
        );
      }

      assert.strictEqual(
        files.length,
        expectedFiles.length,
        "Should have correct number of files",
      );

      cache.dispose();
    });

    it("should return empty array for uninitialized val root", () => {
      const cache = new PublicValFilesCache();

      const files = cache.getFiles("/some/uninitialized/root");

      assert.strictEqual(files.length, 0);

      cache.dispose();
    });
  });

  describe("file watching", () => {
    it("should update cache when a new file is added", async () => {
      const cache = new PublicValFilesCache();
      const testFile = path.join(fixtureRoot, "public/val/test-new-file.png");

      // Clean up test file if it exists
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      await cache.initialize(fixtureRoot);

      const filesBefore = cache.getFiles(fixtureRoot);
      assert.ok(
        !filesBefore.includes("/public/val/test-new-file.png"),
        "Should not include test file initially",
      );

      // Create a new file
      fs.writeFileSync(testFile, "");

      // Wait for file watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 500));

      const filesAfter = cache.getFiles(fixtureRoot);
      assert.ok(
        filesAfter.includes("/public/val/test-new-file.png"),
        "Should include new test file after creation",
      );

      // Clean up
      fs.unlinkSync(testFile);
      cache.dispose();
    });

    it("should update cache when a file is deleted", async () => {
      const cache = new PublicValFilesCache();
      const testFile = path.join(
        fixtureRoot,
        "public/val/test-delete-file.png",
      );

      // Create test file
      fs.writeFileSync(testFile, "");

      await cache.initialize(fixtureRoot);

      const filesBefore = cache.getFiles(fixtureRoot);
      assert.ok(
        filesBefore.includes("/public/val/test-delete-file.png"),
        "Should include test file initially",
      );

      // Delete the file
      fs.unlinkSync(testFile);

      // Wait for file watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 500));

      const filesAfter = cache.getFiles(fixtureRoot);
      assert.ok(
        !filesAfter.includes("/public/val/test-delete-file.png"),
        "Should not include deleted test file",
      );

      cache.dispose();
    });
  });

  describe("refresh", () => {
    it("should manually refresh the cache", async () => {
      const cache = new PublicValFilesCache();
      const testFile = path.join(
        fixtureRoot,
        "public/val/test-refresh-file.png",
      );

      // Clean up test file if it exists
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      await cache.initialize(fixtureRoot);

      const filesBefore = cache.getFiles(fixtureRoot);
      assert.ok(
        !filesBefore.includes("/public/val/test-refresh-file.png"),
        "Should not include test file initially",
      );

      // Create a new file (without waiting for watcher)
      fs.writeFileSync(testFile, "");

      // Manually refresh
      await cache.refresh(fixtureRoot);

      const filesAfter = cache.getFiles(fixtureRoot);
      assert.ok(
        filesAfter.includes("/public/val/test-refresh-file.png"),
        "Should include new test file after refresh",
      );

      // Clean up
      fs.unlinkSync(testFile);
      cache.dispose();
    });
  });

  describe("dispose", () => {
    it("should clean up file watchers and cache", async () => {
      const cache = new PublicValFilesCache();

      await cache.initialize(fixtureRoot);

      const filesBefore = cache.getFiles(fixtureRoot);
      assert.ok(filesBefore.length > 0, "Should have files before dispose");

      cache.dispose();

      const filesAfter = cache.getFiles(fixtureRoot);
      assert.strictEqual(
        filesAfter.length,
        0,
        "Should have no files after dispose",
      );
    });
  });
});
