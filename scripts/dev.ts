import { spawn, type ChildProcess } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ChildProcess[] = [
    spawn(npmCommand, ["run", "dev:server"], { stdio: "inherit" }),
    spawn(npmCommand, ["run", "dev:client"], { stdio: "inherit" }),
];

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
    child.on("exit", (code, signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const otherChild of children) {
            if (otherChild !== child) otherChild.kill("SIGTERM");
        }
        process.exitCode = code ?? (signal ? 1 : 0);
    });
}
