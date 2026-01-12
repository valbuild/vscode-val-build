import {
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { ValModuleResult } from "./valModules";

export interface ValService {
  read: (
    moduleFilePath: ModuleFilePath,
    modulePath: ModulePath,
    options?: {
      validate: boolean;
      source: boolean;
      schema: boolean;
    }
  ) => Promise<
    | {
        source: Source;
        schema: SerializedSchema;
        path: SourcePath;
        errors: false;
      }
    | {
        source?: Source;
        schema?: SerializedSchema;
        path: SourcePath;
        errors: {
          invalidModulePath?: ModuleFilePath;
          validation?:
            | false
            | {
                [sourcePath: string]: Array<{
                  message: string;
                  fixes?: string[];
                  value?: any;
                }>;
              };
          fatal?: Array<{
            message: string;
            stack?: string;
          }>;
        };
      }
  >;
  getAllModulePaths: () => Promise<string[]>;
  getAllModules: () => Promise<ValModuleResult[]>;
}
