import { readFileSync } from "fs";
import sizeOf from "image-size";
import { filenameToMimeType } from "./mimeType/convertMimeType";

export interface ImageMetadata {
  width?: number;
  height?: number;
  mimeType: string;
}

export interface FileMetadata {
  mimeType: string;
}

/**
 * Normalize MIME type to use standard formats
 * @param mimeType The MIME type to normalize
 * @returns Normalized MIME type
 */
function normalizeMimeType(mimeType: string): string {
  // Normalize image/jpg to image/jpeg (standard format)
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

/**
 * Extract metadata from an image file
 * @param absoluteFilePath Absolute path to the image file
 * @returns Object containing width, height, and mimeType
 */
export function getImageMetadata(
  absoluteFilePath: string,
): ImageMetadata | null {
  try {
    const buffer = readFileSync(absoluteFilePath);
    const dimensions = sizeOf(buffer);

    if (dimensions.type) {
      let mimeType = `image/${dimensions.type}`;
      if (dimensions.type === "svg") {
        mimeType = "image/svg+xml";
      }

      return {
        width: dimensions.width,
        height: dimensions.height,
        mimeType: normalizeMimeType(mimeType),
      };
    }

    // Fallback to filename-based MIME type if image-size doesn't recognize the type
    const mimeType = filenameToMimeType(absoluteFilePath);
    if (mimeType && mimeType.startsWith("image/")) {
      return {
        mimeType: normalizeMimeType(mimeType),
      };
    }

    console.warn(`Could not determine image metadata for: ${absoluteFilePath}`);
    return null;
  } catch (error) {
    console.error(
      `Error reading image metadata for ${absoluteFilePath}:`,
      error,
    );
    return null;
  }
}

/**
 * Extract metadata from a generic file
 * @param absoluteFilePath Absolute path to the file
 * @returns Object containing mimeType
 */
export function getFileMetadata(absoluteFilePath: string): FileMetadata | null {
  try {
    const mimeType = filenameToMimeType(absoluteFilePath);
    if (mimeType) {
      return {
        mimeType: normalizeMimeType(mimeType),
      };
    }

    console.warn(`Could not determine MIME type for: ${absoluteFilePath}`);
    return null;
  } catch (error) {
    console.error(
      `Error getting file metadata for ${absoluteFilePath}:`,
      error,
    );
    return null;
  }
}
