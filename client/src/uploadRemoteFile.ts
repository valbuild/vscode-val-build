import { VAL_CONTENT_URL } from "./envConstants";
import { getValConfig } from "./getValConfig";
import * as path from "path";
import { getLoginData } from "./login";
import { Readable } from "stream";
import * as https from "https";

export async function uploadRemoteFile(
  projectRootDir: string,
  bucket: string,
  fileExt: string,
  fileHash: string,
  fileBuffer: Buffer,
  onProgress?: ProgressCallback,
): Promise<
  | {
      status: "success";
    }
  | {
      status: "login-required";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "file-already-exists";
    }
> {
  const valConfig = await getValConfig(projectRootDir);
  if (!valConfig) {
    return {
      status: "error",
      message: `Could not find the 'val.config.ts' or 'val.config.js' file in the project root directory. Please create one.`,
    };
  }
  const projectName = valConfig.project;
  if (projectName === undefined) {
    return {
      status: "error",
      message: `Could not find the 'project' field in the '${path.join(
        projectRootDir,
        "val.config.{ts,js}",
      )}' file. Please specify the project name like this: { project: 'example-org/example-name' }`,
    };
  }
  const loginData = getLoginData(projectRootDir);
  if (!loginData) {
    return {
      status: "login-required",
    };
  }
  const auth = { pat: loginData.pat };
  const res = await uploadRemoteFileImpl(
    VAL_CONTENT_URL,
    projectName,
    bucket,
    fileHash,
    fileExt,
    fileBuffer,
    auth,
    onProgress,
  );
  if (res.success === true) {
    return {
      status: "success",
    };
  }
  return {
    status: "error",
    message: res.error,
  };
}

type ProgressCallback = (bytesSent: number, totalBytes: number) => void;

export async function uploadRemoteFileImpl(
  contentHost: string,
  project: string,
  bucket: string,
  fileHash: string,
  fileExt: string,
  fileBuffer: Buffer,
  auth: { pat: string } | { apiKey: string },
  onProgress?: ProgressCallback,
): Promise<{ success: true } | { success: false; error: string }> {
  const totalBytes = fileBuffer.length;

  const authHeader =
    "apiKey" in auth
      ? { Authorization: `Bearer ${auth.apiKey}` }
      : { "x-val-pat": auth.pat };

  const url = new URL(
    `${contentHost}/v1/${project}/remote/files/b/${bucket}/f/${fileHash}.${fileExt}`,
  );

  const headers = {
    ...authHeader,
    "Content-Type": "application/octet-stream",
    "Content-Length": totalBytes.toString(),
  };

  return new Promise((resolve) => {
    const req = https.request(
      {
        method: "PUT",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();

          if (res.statusCode === 409) {
            resolve({ success: true }); // File already exists
          } else if (
            res.statusCode &&
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            resolve({ success: true });
          } else {
            try {
              const json = JSON.parse(body);
              const message =
                typeof json === "object" && "message" in json
                  ? json.message
                  : JSON.stringify(json);
              resolve({
                success: false,
                error: `Failed to upload remote file: ${message}`,
              });
            } catch {
              resolve({
                success: false,
                error: `Failed to upload remote file. HTTP ${res.statusCode}: ${body}`,
              });
            }
          }
        });
      },
    );

    req.on("error", (err) => {
      console.error("HTTPS request error:", err);
      resolve({
        success: false,
        error: `HTTPS request failed: ${err.message}`,
      });
    });

    // Stream the buffer and track progress
    const stream = Readable.from(fileBuffer);
    let bytesSent = 0;

    stream.on("data", (chunk) => {
      bytesSent += chunk.length;
      if (onProgress) onProgress(bytesSent, totalBytes);
    });

    stream.pipe(req);
  });
}
