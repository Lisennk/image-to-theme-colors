import express from "express";
import multer from "multer";
import path from "path";
import { imageToColors as v1 } from "./v1";
import { imageToColors as v2 } from "./v2";
import { imageToColors as v3 } from "./index";

const versions = [
  { name: "v1", label: "v1 — Initial", fn: v1 },
  { name: "v2", label: "v2 — Border weighting", fn: v2 },
  { name: "v3", label: "v3 — Multi-hue + tuning", fn: v3 },
];

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.resolve(__dirname, "../public")));

app.post("/api/analyze", upload.array("images", 50), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No images uploaded" });
    return;
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const versionResults = await Promise.all(
        versions.map(async (v) => {
          try {
            const colors = await v.fn(file.buffer);
            return { version: v.name, label: v.label, colors };
          } catch (err: any) {
            return { version: v.name, label: v.label, colors: null, error: err.message };
          }
        })
      );
      return { name: file.originalname, dataUrl, versions: versionResults };
    })
  );

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
