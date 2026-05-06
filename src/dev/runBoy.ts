import { composeArticleTheme } from "../lib";
import * as fs from "fs";
import * as path from "path";

(async () => {
  const buf = fs.readFileSync(path.resolve(__dirname, "../../boy-dark.png"));
  const result = await composeArticleTheme(buf);
  console.log(JSON.stringify(result, null, 2));
})();
