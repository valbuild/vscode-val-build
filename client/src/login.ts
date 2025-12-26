import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { VAL_BUILD_URL } from "./envConstants";

export type PatData = {
  profile: { email: string };
  pat: string;
};
let pats: Record<string, PatData> = {};

export function getLoginData(rootDir: string) {
  if (pats[rootDir]) {
    return pats[rootDir];
  }
  const tokenPath = getPersonalAccessTokenPath(rootDir);
  try {
    if (!fs.existsSync(tokenPath)) return false;

    const contents = fs.readFileSync(tokenPath, "utf8");
    const parsed = JSON.parse(contents);
    if (
      typeof parsed?.profile?.email !== "string" ||
      typeof parsed?.pat !== "string"
    ) {
      return false;
    }
    pats[rootDir] = parsed;
    return parsed as PatData;
  } catch (err) {
    return false;
  }
}

export function isLoggedIn(rootDir: string): boolean {
  return !!getLoginData(rootDir);
}

export async function loginFromVSCode(projectRootDir: string): Promise<void> {
  const res = await fetch(`${VAL_BUILD_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const json = (await res.json()) as any;
  if (!json?.nonce || !json?.url) {
    throw new Error("Invalid response from Val login API");
  }

  await vscode.env.openExternal(vscode.Uri.parse(json.url));

  const result = await pollForConfirmation(json.nonce);
  const filePath = getPersonalAccessTokenPath(projectRootDir);

  saveToken(result, filePath);
}

async function pollForConfirmation(
  token: string
): Promise<{ profile: { email: string }; pat: string }> {
  const start = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 1000));

    const res = await fetch(
      `${VAL_BUILD_URL}/api/login?token=${token}&consume=true`
    );
    if (res.status === 200) {
      const json = (await res.json()) as any;
      if (json?.profile?.email && json?.pat) {
        return json;
      }
    }
  }

  throw new Error("Login confirmation timed out.");
}

function saveToken(
  result: { profile: { email: string }; pat: string },
  filePath: string
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf8");
}

function getPersonalAccessTokenPath(root: string) {
  return path.join(path.resolve(root), ".val", "pat.json");
}

export async function updateStatusBar(
  statusBarItem: vscode.StatusBarItem,
  projectDir: undefined | string
) {
  if (!projectDir) {
    statusBarItem.hide();
    return;
  }

  const tokenPath = getPersonalAccessTokenPath(projectDir);
  if (!fs.existsSync(tokenPath)) {
    statusBarItem.text = `$(account) (Val) not logged in`;
    statusBarItem.show();
    return;
  }

  try {
    const json = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    if (json?.profile?.email) {
      statusBarItem.text = `$(account) (Val) ${json.profile.email}`;
      statusBarItem.show();
    } else {
      statusBarItem.text = `$(account) (Val) Unknown user`;
      statusBarItem.show();
    }
  } catch {
    statusBarItem.hide();
  }
}
