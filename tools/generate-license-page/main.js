const licenseChecker = require("license-checker");
const ejs = require("ejs");
const fs = require("fs");
const mainTemplete = fs.readFileSync("./templete.ejs", { encoding: "utf-8" });

licenseChecker.init(
    {
        start: "../../",
    },
    (err, packages) => {
        for (let i of Object.keys(packages)) {
            let e = packages[i];
            if (!!!e.licenseFile) {
                delete packages[i];
                continue;
            }
            e.licenseFile = fs.readFileSync(e.licenseFile);
        }
        fs.writeFileSync(
            "./opensource.ejs",
            ejs.render(mainTemplete, { packages }),
            { encoding: "utf-8" },
        );
    },
);
