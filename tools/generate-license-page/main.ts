import fs from "node:fs";
import ejs from "ejs";
import licenseChecker, { type ModuleInfos } from "license-checker";

const template = fs.readFileSync("./templete.ejs", "utf8");

licenseChecker.init({ start: "../../" }, (error, packages) => {
  if (error) throw error;
  const packagesWithLicenses: ModuleInfos = {};
  for (const [name, info] of Object.entries(packages)) {
    if (!info.licenseFile) continue;
    packagesWithLicenses[name] = {
      ...info,
      licenseFile: fs.readFileSync(info.licenseFile, "utf8"),
    };
  }
  fs.writeFileSync(
    "./opensource.ejs",
    ejs.render(template, { packages: packagesWithLicenses }),
    "utf8",
  );
});
