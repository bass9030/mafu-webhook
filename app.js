var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const { checkNewTweet } = require("./utils/getTweet_new");

var indexRouter = require("./routes/index");
var apiRouter = require("./routes/api");
var sendNotiRouter = require("./routes/sendNoti");

var app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.set("trust proxy", true);
app.use(logger(app.get("env") == "development" ? "dev" : "common"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/api/wa-you-know-sans-wa-papyrus", sendNotiRouter);

app.get("/howto", (req, res) => res.render("howto"));
app.get("/howtoedit", (req, res) => res.render("howto_edit"));
app.get("/howtoremove", (req, res) => res.render("howto_remove"));
app.get("/opensource-license", (req, res) => res.render("opensource"));

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.statusCode = err?.status;
    res.locals.error = req.app.get("env") === "development" ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render("error");
});

checkNewTweet();
setInterval(checkNewTweet, 1000 * 60 * 5);

module.exports = app;
