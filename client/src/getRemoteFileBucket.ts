import { getProjectSettings } from "./getProjectSettings";

let cache: Record<
  string,
  Record<
    string,
    {
      index: number;
      buckets: string[];
    }
  >
> = {};

export async function getRemoteFileBucket(
  projectDir: string,
  projectName: string,
): Promise<
  | {
      status: "success";
      data: string;
    }
  | { status: "login-required" }
  | { status: "error"; message: string }
> {
  if (!cache[projectDir]) {
    cache[projectDir] = {};
  }
  if (cache[projectDir][projectName] === undefined) {
    const projectSettingsRes = await getProjectSettings(
      projectDir,
      projectName,
    );
    if (projectSettingsRes.status !== "success") {
      return projectSettingsRes;
    }
    const projectSettings = projectSettingsRes.data;
    // reset
    cache[projectDir][projectName] = {
      index: -1,
      buckets: projectSettings.remoteFileBuckets.map((bucket) => bucket.bucket),
    };
  }
  cache[projectDir][projectName].index++; // <- NB: increment index
  return {
    status: "success",
    data: cache[projectDir][projectName].buckets[
      cache[projectDir][projectName].index
    ],
  };
}
