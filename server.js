require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========================
// MIDDLEWARE
// ========================
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ========================
// LOGGING HELPER
// ========================
function sendLog(socket, message, type = "info") {
  console.log(`[${type}] ${message}`);
  if (socket) {
    socket.emit("log", { type, message, time: new Date().toISOString() });
  }
}

// ========================
// ETSY SEARCH
// ========================
app.post("/search-etsy", async (req, res) => {
  const { keyword, limit } = req.body;
  if (!keyword) return res.status(400).json({ error: "Keyword required" });

  const maxItems = Math.min(parseInt(limit) || 10, 50);
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

  try {
    sendLog(null, `Fetching Etsy results for "${keyword}"`);

    const scraperResp = await axios.get("https://api.scraperapi.com/", {
      params: { api_key: process.env.SCRAPAPI_KEY, url: etsyUrl, render: true },
    });

    const html = scraperResp.data;
    const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

    const images = [...html.matchAll(imageRegex)].map((m) => m[0]);
    const links = [...html.matchAll(linkRegex)].map((m) => m[0]);

    const results = [];
    for (let i = 0; i < Math.min(maxItems, images.length); i++) {
      results.push({ image: images[i], link: links[i] || etsyUrl });
    }

    sendLog(null, `Found ${results.length} Etsy items`);
    res.json({ results });
  } catch (err) {
    sendLog(null, `ScraperAPI Error: ${err.message}`, "error");
    res.status(500).json({ error: "Failed to scrape Etsy" });
  }
});

// ========================
// UPLOAD IMAGE TO IMGBB
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
// CALCULATE SIMILARITY
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
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64B}` } },
            ],
          },
        ],
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
// ANALYZE IMAGES
// ========================
app.post("/analyze-images", upload.array("images"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);
  const results = [];

  for (const file of req.files) {
    sendLog(socket, `🖼 Processing ${file.originalname}`);
    let publicImageUrl;

    try {
      sendLog(socket, "📤 Uploading image to ImgBB");
      publicImageUrl = await uploadToImgBB(file.buffer);
      sendLog(socket, "✅ Image uploaded successfully");
    } catch (err) {
      sendLog(socket, `❌ ImgBB upload failed: ${err.message}`, "error");
      continue;
    }

    // ----------------------
    // ScrapAPI Reverse Image Search
    // ----------------------
    sendLog(socket, "🔎 Searching for similar images via ScrapAPI");
    let searchResults = [];
    try {
      const resp = await axios.get("https://api.scraperapi.com/", {
        params: { api_key: process.env.SCRAPAPI_KEY, url: publicImageUrl, render: true },
      });
      // TODO: Parse resp.data for image URLs
      searchResults = []; // placeholder for parsed results
      sendLog(socket, `📦 Found ${searchResults.length} images`);
    } catch (err) {
      sendLog(socket, `❌ ScrapAPI search failed: ${err.message}`, "error");
    }

    // ----------------------
    // Filter AliExpress + similarity
    // ----------------------
    const matches = [];
    for (const item of searchResults) {
      if (!item.link?.includes("aliexpress.com")) continue;
      let similarity = 0;
      try {
        const aliResp = await axios.get(item.thumbnail, { responseType: "arraybuffer" });
        const base64B = Buffer.from(aliResp.data).toString("base64");
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
// SOCKET.IO
// ========================
io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  sendLog(socket, "🟢 Client connected");
});

// ========================
// START SERVER
// ========================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => sendLog(null, `🚀 Server running on port ${PORT}`));
