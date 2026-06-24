import { chmodSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const gitDir = join(process.cwd(), ".git");
const hooksDir = join(process.cwd(), ".githooks");
const prePush = join(hooksDir, "pre-push");

if (!existsSync(gitDir)) {
  process.exit(0);
}

try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
} catch {
  // ignore em ambientes sem git write (ex.: alguns CI)
}

if (existsSync(prePush)) {
  chmodSync(prePush, 0o755);
}
