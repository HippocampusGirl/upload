import type { JestConfigWithTsJest } from "ts-jest";
import { defaultsESM as preset } from "ts-jest/presets";

const jestConfig: JestConfigWithTsJest = {
  transform: { ...preset.transform },
  resolver: "jest-ts-webcompat-resolver",
  testEnvironment: "node",
  collectCoverageFrom: ["src/**/*.ts"],
  modulePathIgnorePatterns: ["<rootDir>/build/"],
};

export default jestConfig;
