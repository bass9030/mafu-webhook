#!/usr/bin/env node

import type { AddressInfo } from "node:net";
import http from "node:http";
import debugFactory from "debug";
import app from "../app";

type Port = number | string | false;
const debug = debugFactory("mafu-webhook:server");
const port = normalizePort(process.env.PORT ?? "3000");
if (port === false) throw new Error("Invalid PORT value");
app.set("port", port);

const server = http.createServer(app);
server.listen(port);
server.on("error", onError);
server.on("listening", () => {
    const address = server.address();
    const bind =
        typeof address === "string"
            ? `pipe ${address}`
            : `port ${(address as AddressInfo).port}`;
    debug(`Listening on ${bind}`);
});

function normalizePort(value: string): Port {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return value;
    return parsed >= 0 ? parsed : false;
}

function onError(error: NodeJS.ErrnoException): never {
    if (error.syscall !== "listen") throw error;
    const bind = typeof port === "string" ? `Pipe ${port}` : `Port ${port}`;
    if (error.code === "EACCES") {
        console.error(`${bind} requires elevated privileges`);
    } else if (error.code === "EADDRINUSE") {
        console.error(`${bind} is already in use`);
    } else {
        throw error;
    }
    process.exit(1);
}
