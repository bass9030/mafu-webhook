import "dotenv/config";
import "./utils/instrument";
import path from "node:path";
import * as Sentry from "@sentry/node";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import createError, { type HttpError } from "http-errors";
import logger from "morgan";
import apiRouter from "./routes/api";
import indexRouter from "./routes/index";
import sendNotiRouter from "./routes/sendNoti";
import { checkNewTweet } from "./utils/getTweet";
import { isSentryEnabled } from "./utils/instrument";

const app = express();
const projectRoot = process.cwd();
app.set("views", path.join(projectRoot, "views"));
app.set("view engine", "ejs");
app.set("trust proxy", true);
app.use(logger(app.get("env") === "development" ? "dev" : "common"));
app.use(
    express.json({
        verify: (request, _response, buffer) => {
            if (request.url?.split("?", 1)[0] === "/api/line-webhook") {
                (request as typeof request & { rawBody?: Buffer }).rawBody =
                    Buffer.from(buffer);
            }
        },
    }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(projectRoot, "public")));

app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/api/wa-you-know-sans-wa-papyrus", sendNotiRouter);
app.get("/howto", (_request, response) => response.render("howto"));
app.get("/howtoedit", (_request, response) => response.render("howto_edit"));
app.get("/howtoremove", (_request, response) => response.render("howto_remove"));
app.get("/opensource-license", (_request, response) => response.render("opensource"));
app.use((_request, _response, next) => next(createError(404)));

if (isSentryEnabled) Sentry.setupExpressErrorHandler(app);

const errorHandler: ErrorRequestHandler = (
    error: HttpError,
    request,
    response,
    _next,
) => {
    response.locals.message = error.message;
    response.locals.statusCode = error.status;
    response.locals.error = request.app.get("env") === "development" ? error : {};
    response.status(error.status ?? 500).render("error");
};
app.use(errorHandler);

if (process.env.NODE_ENV === "production") {
    void checkNewTweet();
    setInterval(() => void checkNewTweet(), 5 * 60 * 1000);
} else {
    console.log("development mode. tweet detection is disabled");
}

export default app;
