import { spawn } from "node:child_process";

const port = process.env.WEB_PORT || "3742";

const child = spawn("next", ["dev", "--port", port], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
