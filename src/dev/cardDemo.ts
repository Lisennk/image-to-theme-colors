import express from "express";
import path from "path";
import { imageToColors } from "../lib";

const app = express();
app.use(express.json({ limit: "30mb" }));

app.get("/", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../../public/card-demo.html"));
});

app.post("/colors", async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
    res.status(400).json({ error: "imageDataUrl required (data: URL)" });
    return;
  }
  const m = imageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) {
    res.status(400).json({ error: "Expected base64 data URL" });
    return;
  }
  try {
    const buf = Buffer.from(m[1], "base64");
    const colors = await imageToColors(buf);
    res.json({ ...colors, imageDataUrl });
  } catch (err: any) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3030;
app.listen(PORT, () => {
  console.log(`Card+article demo: http://localhost:${PORT}`);
});
