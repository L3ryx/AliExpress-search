require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ========================
   LOG SYSTEM
======================== */
function sendLog(socket, message, type = "info") {
  console.log(`[${type}] ${message}`);
  if (socket) {
    socket.emit("log", { message, type, time: new Date().toISOString() });
  }
}

/* ========================
   UPLOAD IMAGE TO IMGBB
======================== */
async function uploadToImgBB(imageBuffer) {
  const base64 = imageBuffer.toString("base64");
  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({ key: process.env.IMGBB_KEY, image: base64 }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.data.url;
}

/* ========================
   CALCULATE SIMILARITY
======================== */
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

/* ========================
   ANALYZE ROUTE
======================== */
app.post("/analyze", upload.array("images"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);
  const results = [];

  for (const file of req.files) {
    sendLog(socket, `🖼 Processing ${file.originalname}`);

    // Step 1: Upload to ImgBB
    let publicImageUrl;
    try {
      sendLog(socket, "📤 Uploading image to ImgBB");
      publicImageUrl = await uploadToImgBB(file.buffer);
      sendLog(socket, `✅ Image uploaded: ${publicImageUrl}`);
    } catch (err) {
      sendLog(socket, `❌ ImgBB upload failed: ${err.message}`, "error");
      continue;
    }

    // Step 2: Reverse image search using ScrapAPI
    let scrapResults = [];
    try {
      sendLog(socket, "🔎 Searching image with ScrapAPI");

      const response = await axios.get("https://api.scraperapi.com/", {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url: `https://www.google.com/searchbyimage?&image_url=${encodeURIComponent(publicImageUrl)}`
        }
      });

      // ScrapAPI renvoie du HTML : tu devras parser les liens d’images et de pages ici
      const html = response.data;
      const linkRegex = /https:\/\/www\.aliexpress\.com\/item\/\d+/g;
      const imgRegex = /https:\/\/[^"]+\.(jpg|png|jpeg)/g;

      const links = [...html.matchAll(linkRegex)].map(m => m[0]);
      const imgs = [...html.matchAll(imgRegex)].map(m => m[0]);

      for (let i = 0; i < links.length; i++) {
        scrapResults.push({ link: links[i], thumbnail: imgs[i] || publicImageUrl });
      }

      sendLog(socket, `📦 Found ${scrapResults.length} potential AliExpress results`);
    } catch (err) {
      sendLog(socket, `❌ ScrapAPI failed: ${err.message}`, "error");
      scrapResults = [];
    }

    // Step 3: Compare similarity
    const matches = [];
    for (const item of scrapResults) {
      let similarity = 0;
      try {
        const aliResp = await axios.get(item.thumbnail, { responseType: "arraybuffer" });
        const base64B = Buffer.from(aliResp.data).toString("base64");
        similarity = await calculateSimilarity(file.buffer.toString("base64"), base64B);
        sendLog(socket, `Similarity with ${item.link}: ${similarity.toFixed(2)}`);
      } catch (err) {
        sendLog(socket, `❌ Similarity check failed: ${err.message}`, "error");
      }

      matches.push({ url: item.link, image: item.thumbnail, similarity });
      if (similarity >= 0.6) break; // stop si match >= 60%
    }

    if (matches.length === 0) sendLog(socket, "⚠️ No similar AliExpress results found");

    results.push({ etsyImage: publicImageUrl, matches });
  }

  res.json({ results });
});

/* ========================
   SOCKET
======================== */
io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  sendLog(socket, "🟢 Client connected");
});

/* ========================
   START SERVER
======================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
