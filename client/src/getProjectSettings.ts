import { VAL_CONTENT_URL } from "./envConstants";
import { getLoginData } from "./login";

type Settings = {
  publicProjectId: string;
  remoteFileBuckets: { bucket: string }[];
};

let cache: Record<string, Record<string, Settings>> = {};

export async function getProjectSettings(
  projectDir: string,
  projectName: string
): Promise<
  | {
      status: "success";
      data: Settings;
    }
  | {
      status: "login-required";
    }
  | {
      status: "error";
      message: string;
    }
> {
  if (cache?.[projectDir]?.[projectName]) {
    return {
      status: "success",
      data: cache[projectDir][projectName],
    };
  }
  if (!cache[projectDir]) {
    cache[projectDir] = {};
  }
  const loginData = getLoginData(projectDir);
  if (!loginData) {
    return {
      status: "login-required",
    };
  }
  console.log("Fetching project settings for project:", projectName);
  const auth = { pat: loginData.pat };
  const result = await fetchProjectSettings(projectName, auth);
  console.log("Fetch project settings result:", result);
  if (result.success === false) {
    return {
      status: "error",
      message: result.message,
    };
  }
  cache[projectDir][projectName] = result.data;
  return {
    status: "success",
    data: result.data,
  };
}

async function fetchProjectSettings(
  projectName: string,
  auth: { pat: string } | { apiKey: string }
): Promise<
  | {
      success: true;
      data: Settings;
    }
  | {
      success: false;
      message: string;
    }
> {
  try {
    const response = await fetch(
      `${VAL_CONTENT_URL}/v1/${projectName}/settings`,
      {
        headers:
          "pat" in auth
            ? {
                "x-val-pat": auth.pat,
                "Content-Type": "application/json",
              }
            : {
                Authorization: `Bearer ${auth.apiKey}`,
                "Content-Type": "application/json",
              },
      }
    );
    if (response.status === 404) {
      return {
        success: false,
        message: `Project '${projectName}' not found: check that the name of the project is correct and that you have access to it.`,
      };
    }
    if (response.status !== 200) {
      const body = await response.text();
      console.log("Failed to get project id:", response.statusText, body);
      return {
        success: false,
        message: `Failed to get project id: ${response.statusText}`,
      };
    }
    const json = await response.json();
    return {
      success: true,
      data: json as Settings,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to get project id. Check network connection and try again.`,
    };
  }
}
