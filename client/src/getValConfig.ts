import { EvaluatedValConfig, evalValConfigFile } from "./evalValConfigFile";

let configsByRootDir: Record<string, EvaluatedValConfig> = {};

export async function getValConfig(projectDir: string) {
  if (!configsByRootDir[projectDir]) {
    await updateValConfig(projectDir);
  }
  return configsByRootDir[projectDir];
}

export async function updateValConfig(projectDir: string) {
  const projectSettings =
    (await evalValConfigFile(projectDir, "val.config.ts")) ||
    (await evalValConfigFile(projectDir, "val.config.js"));

  if (!projectSettings) {
    return;
  }
  configsByRootDir[projectDir] = projectSettings;
  return projectSettings;
}
