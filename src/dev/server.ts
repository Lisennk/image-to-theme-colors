import express from "express";
import multer from "multer";
import path from "path";
import { imageToColors } from "../lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.resolve(__dirname, "../../public")));
app.use("/examples", express.static(path.resolve(__dirname, "../../examples")));

app.post("/api/analyze", upload.array("images", 50), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No images uploaded" });
    return;
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      try {
        const colors = await imageToColors(file.buffer);
        return { name: file.originalname, colors, dataUrl };
      } catch (err: any) {
        return { name: file.originalname, error: err.message, colors: null, dataUrl: null };
      }
    })
  );

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
