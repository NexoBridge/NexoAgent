import fs from "node:fs/promises";
import { LOG_FILE } from "./config";

export function serverLog(msg: string) {
  const line = new Date().toISOString() + " " + msg + "\n";
  void fs.appendFile(LOG_FILE, line).catch(() => {});
}
