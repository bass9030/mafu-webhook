import * as Sentry from "@sentry/node";

export const isSentryEnabled = process.env.NODE_ENV !== "development";

if (isSentryEnabled) {
    Sentry.init({
        dsn: "https://ab1c54ddc43b0136948dec414d0c4ed8@o4510646382624768.ingest.us.sentry.io/4510646384001024",
        sendDefaultPii: true,
        enableLogs: true,
    });
}
