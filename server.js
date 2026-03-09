require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ========================
// Middleware
// ========================
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ========================
// Logging helper
// ========================
function sendLog(socket, message, type = "info") {
  console.log(`[${type.toUpperCase()}] ${message}`);
  if (socket) socket.emit("log", { message, type, time: new Date().toISOString() });
}

// ========================
// Serve index.html
// ========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========================
// Upload image to ImgBB
// ========================
async function uploadToImgBB(imageBuffer) {
  const base64 = imageBuffer.toString("base64");
  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({ key: process.env.IMGBB_KEY, image: base64 }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.data.url;
}

// ========================
// OpenAI similarity
// ========================
async function calculateSimilarity(base64A, base64B) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Return only similarity 0 to 1." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64A}` } },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64B}` } }
            ]
          }
        ]
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    const text = response.data.choices[0].message.content;
    const match = text.match(/0\.\d+|1(\.0+)?/);
    return match ? parseFloat(match[0]) : 0;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return 0;
  }
}

// ========================
// Analyze route
// ========================
app.post("/analyze", upload.array("images"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {
    sendLog(socket, `🖼 Processing ${file.originalname}`);

    // STEP 1 — Upload image to ImgBB
    let publicImageUrl;
    try {
      sendLog(socket, "📤 Uploading image to ImgBB");
      publicImageUrl = await uploadToImgBB(file.buffer);
      sendLog(socket, "✅ Image uploaded successfully");
    } catch (err) {
      sendLog(socket, `❌ Image upload failed | ${err.message}`, "error");
      continue;
    }

    // STEP 2 — Reverse image search via ScrapAPI (instead of Serper)
    let searchResults = [];
    try {
      const resp = await axios.get("https://api.scrapapi.com/", {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url: `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(publicImageUrl)}`,
          render: true
        }
      });

      const html = resp.data;

      // simple regex to extract AliExpress links
      const linkRegex = /https:\/\/www\.aliexpress\.com\/item\/\d+/g;
      const imgRegex = /https:\/\/[^"]+\.jpg/g;

      const links = [...html.matchAll(linkRegex)].map(m => m[0]);
      const images = [...html.matchAll(imgRegex)].map(m => m[0]);

      for (let i = 0; i < links.length && i < 5; i++) {
        searchResults.push({ link: links[i], thumbnail: images[i] });
      }

      sendLog(socket, `🔎 ScrapAPI returned ${searchResults.length} AliExpress results`);
    } catch (err) {
      sendLog(socket, `❌ ScrapAPI reverse search failed | ${err.message}`, "error");
    }

    // STEP 3 — Compare similarity with OpenAI
    const matches = [];
    for (const item of searchResults) {
      let similarity = 0;
      try {
        const resp = await axios.get(item.thumbnail, { responseType: "arraybuffer" });
        const base64B = Buffer.from(resp.data).toString("base64");
        similarity = await calculateSimilarity(file.buffer.toString("base64"), base64B);
        sendLog(socket, `Similarity with ${item.link}: ${similarity}`);
      } catch (err) {
        sendLog(socket, `❌ Similarity check failed: ${err.message}`, "error");
      }

      matches.push({ url: item.link, image: item.thumbnail, similarity });
      if (similarity >= 0.6) break;
    }

    if (matches.length === 0) sendLog(socket, "⚠️ No similar AliExpress results found");

    results.push({ etsyImage: publicImageUrl, matches });
  }

  res.json({ results });
});

// ========================
// Socket.io connection
// ========================
io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  sendLog(socket, "🟢 Client connected");
});

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
