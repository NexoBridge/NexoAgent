import { spawn } from "node:child_process";
import path from "node:path";

function relaunchElectronRuntime() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const entry = path.join(__dirname, "main.js");
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: path.join(__dirname, "..", ".."),
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: false
  });

  child.unref();
}

if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  relaunchElectronRuntime();
  process.exit(0);
}

require("./main.js");
