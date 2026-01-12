import { EXT_TO_MIME_TYPES } from "./all";

export function filenameToMimeType(filename: string): string | undefined {
  const ext = filename.split(".").pop();
  const recognizedExt = ext && EXT_TO_MIME_TYPES[ext];
  if (recognizedExt) {
    return recognizedExt;
  }
  return undefined;
}
