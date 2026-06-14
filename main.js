// HerShield Proto main.js — frontend connected to Render backend

// ✅ Backend link (Render)
const API_BASE = "https://hershield-ai-3157.onrender.com/api";

// 🌐 Load datasets (volunteers, shops, drivers, homes)
async function loadDatasets() {
  try {
    const response = await fetch(`${API_BASE}/datasets`);
    const data = await response.json();

    const list = document.getElementById("dataset-list");
    if (!list) return;
    list.innerHTML = "";

    data.forEach(item => {
      const li = document.createElement("li");
      li.textContent = `${item.name} - ${item.type}`;
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Error loading datasets:", err);
  }
}

// 🚨 Send SOS alert
async function sendSosFlow() {
  try {
    const response = await fetch(`${API_BASE}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "SOS triggered!" })
    });
    const result = await response.json();
    alert("SOS sent: " + result.status);
  } catch (err) {
    console.error("Error sending SOS:", err);
  }
}

// 📸 Upload evidence
async function uploadEvidence(file) {
  const formData = new FormData();
  formData.append("evidence", file);

  try {
    const response = await fetch(`${API_BASE}/evidence`, {
      method: "POST",
      body: formData
    });
    const result = await response.json();
    alert("Evidence uploaded: " + result.message);
  } catch (err) {
    console.error("Error uploading evidence:", err);
  }
}

// 👮 Admin login
async function adminLogin(token) {
  try {
    const response = await fetch(`${API_BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const result = await response.json();
    if (result.success) {
      alert("Admin logged in!");
    } else {
      alert("Invalid admin token");
    }
  } catch (err) {
    console.error("Error logging in:", err);
  }
}

// 🧠 Initialize real-time socket (optional)
function initSocketIo() {
  try {
    const socket = io("https://hershield-ai-3157.onrender.com");
    socket.on("alert", data => {
      console.log("New alert:", data);
    });
  } catch (err) {
    console.error("Socket.io not initialized:", err);
  }
}

// 🕒 Auto-run small tasks
try {
  if (document.getElementById("liveTime")) startClock("liveTime");
  if (document.getElementById("headerTime")) startClock("headerTime");
  initSocketIo();
  loadDatasets();
} catch (e) {
  console.log("Auto-run skipped:", e);
}

// 🧩 Expose functions globally
window.sendSosFlow = sendSosFlow;
window.uploadEvidence = uploadEvidence;
window.adminLogin = adminLogin;
window.initSocketIo = initSocketIo;
window.loadDatasets = loadDatasets;
