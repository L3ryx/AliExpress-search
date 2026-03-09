// ========================================
// SOCKET CONNECTION
// ========================================

const socket = io();
let socketId = null;

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("🟢 Socket connected:", socketId);
});

// ========================================
// LIVE LOGS
// ========================================

socket.on("log", (data) => {

  const logsDiv = document.getElementById("logs");

  const line = document.createElement("div");

  line.className = `log-${data.type}`;

  line.innerHTML = `
    <span style="color:#888">
      [${new Date(data.time).toLocaleTimeString()}]
    </span>
    ${data.message}
  `;

  logsDiv.appendChild(line);

  logsDiv.scrollTop = logsDiv.scrollHeight;
});

// ========================================
// FORM SUBMISSION
// ========================================

const form = document.getElementById("uploadForm");
const resultsContainer = document.getElementById("results");

form.addEventListener("submit", async (e) => {

  e.preventDefault();

  resultsContainer.innerHTML = "";
  document.getElementById("logs").innerHTML =
    "<p>🚀 Starting analysis...</p>";

  const filesInput = document.querySelector("input[type='file']");
  const files = filesInput.files;

  if (!files || files.length === 0) {
    alert("Please upload at least one image");
    return;
  }

  const formData = new FormData();

  for (const file of files) {
    formData.append("images", file);
  }

  formData.append("socketId", socketId);

  try {

    const response = await fetch("/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    displayResults(data.results);

  } catch (err) {

    console.error("❌ Request failed:", err);

  }

});

// ========================================
// DISPLAY RESULTS
// ========================================

function displayResults(results) {

  const resultsContainer = document.getElementById("results");

  if (!results || results.length === 0) {

    resultsContainer.innerHTML =
      "<p style='color:red'>❌ No results returned</p>";

    return;
  }

  results.forEach(result => {

    const card = document.createElement("div");
    card.className = "result-card";

    let html = `
      <h3>📷 ${result.image}</h3>
    `;

    if (!result.matches || result.matches.length === 0) {

      html += `
        <p style="color:red">
          ❌ No match found (≥60%)
        </p>
      `;

    } else {

      result.matches.forEach(match => {

        html += `
          <div class="product">
            <p>🔥 Similarity: ${match.similarity}%</p>
            <a href="${match.url}" target="_blank">
              🔗 Open Product
            </a>
          </div>
        `;

      });

    }

    card.innerHTML = html;
    resultsContainer.appendChild(card);

  });
}
