require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/*
====================================================
LOG SYSTEM
====================================================
*/

function sendLog(socket, message, type = "info") {

  console.log(`[${type}] ${message}`);

  if (socket) {
    socket.emit("log", {
      message,
      type,
      time: new Date().toISOString()
    });
  }
}

/*
====================================================
UPLOAD IMAGE TO IMGBB (TO FIX 414)
====================================================
*/

async function uploadToImgBB(imageBuffer) {

  const base64 = imageBuffer.toString("base64");

  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return response.data.data.url;
}

/*
====================================================
SIMILARITY
====================================================
*/

async function calculateSimilarity(base64A, base64B) {

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Return only similarity 0 to 1." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64A}`
              }
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64B}`
              }
            }
          ]
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );

  const text = response.data.choices[0].message.content;
  const match = text.match(/0\.\d+|1(\.0+)?/);

  return match ? parseFloat(match[0]) : 0;
}

/*
====================================================
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing ${file.originalname}`);

    /*
    ============================================
    STEP 1 — UPLOAD IMAGE TO GET PUBLIC URL
    ============================================
    */

    let publicImageUrl;

    try {

      sendLog(socket, "📤 Uploading image to ImgBB");

      publicImageUrl = await uploadToImgBB(file.buffer);

      sendLog(socket, "✅ Image uploaded successfully");

    } catch (err) {

      sendLog(socket, "❌ Image upload failed", "error");

      continue;
    }

    /*
    ============================================
    STEP 2 — CALL SERPAPI WITH IMAGE URL
    ============================================
    */

    sendLog(socket, "🔎 Calling SerpAPI");

    let serpResults = [];

    try {

      const response = await axios.get(
        "https://serpapi.com/search",
        {
          params: {
            engine: "google_reverse_image",
            image_url: publicImageUrl,
            api_key: process.env.SERPAPI_KEY
          }
        }
      );

      serpResults = response.data?.image_results || [];

      sendLog(socket, `📦 ${serpResults.length} results found`);

    } catch (err) {

      sendLog(
        socket,
        `❌ SerpAPI error | ${err.response?.status}`,
        "error"
      );

      serpResults = [];
    }

    /*
    ============================================
    STEP 3 — FILTER ALIEXPRESS
    ============================================
    */

    const aliexpressLinks = serpResults
      .filter(r => r.link?.includes("aliexpress.com"))
      .slice(0, 10);

    const matches = [];

    for (const item of aliexpressLinks) {

      matches.push({
        url: item.link,
        similarity: 70 // placeholder (tu peux remettre ton IA ici)
      });

    }

    results.push({
      image: file.originalname,
      matches
    });
  }

  res.json({ results });
});

/*
====================================================
SOCKET
====================================================
*/

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");

});

/*
====================================================
START
====================================================
*/

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
