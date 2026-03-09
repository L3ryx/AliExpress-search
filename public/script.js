const socket = io()

let socketId = null

socket.on("connected", data => {

socketId = data.socketId

addLog("Connected to server")

})

socket.on("log", data => {

addLog(data.message)

})

function addLog(message){

const logs = document.getElementById("logs")

const line = document.createElement("div")

line.textContent = message

logs.appendChild(line)

logs.scrollTop = logs.scrollHeight

}

/* ============================= */
/* ETSY SEARCH */
/* ============================= */

async function searchEtsy(){

const keyword = document.getElementById("keyword").value
const limit = document.getElementById("limit").value

if(!keyword){

alert("Enter keyword")

return

}

addLog("Searching Etsy...")

const response = await fetch("/search-etsy",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
keyword,
limit
})

})

const data = await response.json()

displayResults(data.results)

}

/* ============================= */
/* IMAGE ANALYSIS */
/* ============================= */

async function analyzeImages(){

const files = document.getElementById("images").files

if(!files.length){

alert("Select images")

return

}

const formData = new FormData()

for(const file of files){

formData.append("images",file)

}

formData.append("socketId",socketId)

addLog("Uploading images...")

const response = await fetch("/analyze-images",{

method:"POST",

body:formData

})

const data = await response.json()

displayResults(data.results)

}

/* ============================= */
/* DISPLAY RESULTS */
/* ============================= */

function displayResults(results){

const container = document.getElementById("results")

container.innerHTML=""

results.forEach(item =>{

const div = document.createElement("div")

div.className="result"

let html = `<strong>${item.image}</strong><br>`

if(item.link){

html += `<a href="${item.link}" target="_blank">View Listing</a><br>`
html += `<img src="${item.image}"><br>`

}

if(item.matches){

item.matches.forEach(m =>{

html+=`
<br>
<a href="${m.url}" target="_blank">${m.url}</a>
<br>
Similarity: ${m.similarity}%
`

})

}

div.innerHTML=html

container.appendChild(div)

})

}
