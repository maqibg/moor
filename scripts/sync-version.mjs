import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVersions } from "./version-sync-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

// 版本号来源：sidecar/package.json（changeset 直接管理的 workspace 成员）
// changeset version 会更新 sidecar/package.json，然后由此脚本同步到其他位置
const result = syncVersions({ root, checkOnly });
process.exitCode = result.exitCode;
