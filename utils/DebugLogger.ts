import * as Sentry from "@sentry/node";
import { isSentryEnabled } from "./instrument";

export function sendInfoLog(message: string): void {
    console.log(message);
    if (isSentryEnabled) Sentry.logger.info(message);
}

export function sendErrorLog(error: unknown): void {
    console.error(error);
    if (isSentryEnabled) Sentry.captureException(error);
}

export function sendResponseDataLog(response: string): void {
    console.log(response);
    if (isSentryEnabled) Sentry.logger.debug(response);
}
