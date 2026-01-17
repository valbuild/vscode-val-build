import fs from "fs";
import path from "path";
import { glob } from "glob";

/**
 * Cache for files in /public/val directory
 * Maintains a list of valid files that can be used in c.image() and c.file()
 */
export class PublicValFilesCache {
  private filesByValRoot: Map<string, string[]> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();

  /**
   * Initialize cache for a val root and set up file watcher
   */
  async initialize(valRoot: string): Promise<void> {
    await this.updateCache(valRoot);
    this.setupWatcher(valRoot);
  }

  /**
   * Get all files for a val root
   */
  getFiles(valRoot: string): string[] {
    return this.filesByValRoot.get(valRoot) || [];
  }

  /**
   * Update cache for a val root by scanning /public/val directory
   */
  private async updateCache(valRoot: string): Promise<void> {
    const publicValDir = path.join(valRoot, "public", "val");

    // Check if directory exists
    if (!fs.existsSync(publicValDir)) {
      this.filesByValRoot.set(valRoot, []);
      return;
    }

    try {
      // Find all files recursively in /public/val
      const files = await glob("**/*", {
        cwd: publicValDir,
        nodir: true,
        absolute: false,
      });

      // Convert to /public/val/... format
      const formattedFiles = files.map((file) => `/public/val/${file}`);

      this.filesByValRoot.set(valRoot, formattedFiles);
      console.log(
        `[PublicValFilesCache] Updated cache for ${valRoot}: found ${formattedFiles.length} files`,
      );
    } catch (error) {
      console.error(
        `[PublicValFilesCache] Error scanning ${publicValDir}:`,
        error,
      );
      this.filesByValRoot.set(valRoot, []);
    }
  }

  /**
   * Set up file watcher for /public/val directory
   */
  private setupWatcher(valRoot: string): void {
    const publicValDir = path.join(valRoot, "public", "val");

    // Close existing watcher if any
    const existingWatcher = this.watchers.get(valRoot);
    if (existingWatcher) {
      existingWatcher.close();
    }

    // Only set up watcher if directory exists
    if (!fs.existsSync(publicValDir)) {
      return;
    }

    try {
      const watcher = fs.watch(
        publicValDir,
        { recursive: true },
        (eventType, filename) => {
          console.log(
            `[PublicValFilesCache] File change detected in ${publicValDir}: ${eventType} ${filename}`,
          );
          // Debounce: update cache after a short delay
          setTimeout(() => {
            this.updateCache(valRoot);
          }, 100);
        },
      );

      this.watchers.set(valRoot, watcher);
      console.log(`[PublicValFilesCache] Set up watcher for ${publicValDir}`);
    } catch (error) {
      console.error(
        `[PublicValFilesCache] Error setting up watcher for ${publicValDir}:`,
        error,
      );
    }
  }

  /**
   * Clean up watchers
   */
  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.filesByValRoot.clear();
  }

  /**
   * Refresh cache for a val root (useful for testing or manual refresh)
   */
  async refresh(valRoot: string): Promise<void> {
    await this.updateCache(valRoot);
  }
}
