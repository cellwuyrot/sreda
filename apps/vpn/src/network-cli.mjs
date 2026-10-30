#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkNetwork, networkReady } from "./network.mjs";
const options = { repair: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--repair") options.repair = true;
  else if (arg.startsWith("--iface=")) options.iface = arg.slice(8);
  else if (arg.startsWith("--port=")) options.port = Number(arg.slice(7));
  else if (arg.startsWith("--egress=")) options.egress = arg.slice(9);
  else {
    console.error("Unknown network-check argument");
    process.exit(1);
  }
}
const exec = promisify(execFile);
try {
  const result = await checkNetwork(
    (file, args) => exec(file, args, { timeout: 8000, maxBuffer: 65536 }),
    options,
  );
  console.log(JSON.stringify(result));
  process.exitCode = networkReady(result) ? 0 : 2;
} catch {
  console.error(
    "VPN network check failed; no command output or secrets printed",
  );
  process.exitCode = 1;
}
