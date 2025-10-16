// popup.js - Simplified UI handler

// Global UI state
let username = null;
let selectedTransferMode = 'webrtc';
let selectedFile = null;
let activeTransfers = new Map();
let isConnected = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadState();

  // Listen for updates from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
});

// Load state from background
async function loadState() {
  const state = await sendToBackground({ type: "GET_STATE" });

  if (state) {
    isConnected = state.connected;
    updateConnectionStatus(state.connected);

    if (state.username) {
      username = state.username;
      showMainInterface();
    } else {
      showUsernameSetup();
    }

    // Show active transfers
    if (state.activeTransfers && state.activeTransfers.length > 0) {
      for (const transfer of state.activeTransfers) {
        activeTransfers.set(transfer.id, transfer);
        showTransferProgress(transfer);
      }
    }

    // Handle pending notifications
    if (state.pendingNotifications) {
      for (const notification of state.pendingNotifications) {
        handleBackgroundMessage(notification);
      }
    }
  }
}

// Send message to background
function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// Handle messages from background
function handleBackgroundMessage(message) {
  switch (message.type) {
    case "CONNECTION_STATUS":
      isConnected = message.connected;
      updateConnectionStatus(message.connected);
      if (message.username) {
        username = message.username;
        showMainInterface();
      }
      break;

    case "USERNAME_CONFIRMED":
      username = message.username;
      showMainInterface();
      if (message.availableUsers) {
        updateUserList(message.availableUsers);
      }
      break;

    case "USERNAME_ERROR":
      alert(message.message);
      document.getElementById("set-username-btn").disabled = false;
      break;

    case "USER_LIST":
      updateUserList(message.users);
      break;

    case "INCOMING_FILE":
      showIncomingFile(message);
      break;

    case "TRANSFER_PROGRESS":
      updateTransferProgress(message);
      break;

    case "TRANSFER_COMPLETE":
      handleTransferComplete(message);
      break;

    case "FILE_READY":
      showDownloadReady(message);
      break;

    case "TRANSFER_ERROR":
      handleTransferError(message);
      break;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Username setup
  document.getElementById("set-username-btn").addEventListener("click", setUsername);
  document.getElementById("username-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") setUsername();
  });

  // Transfer mode selection
  document.querySelectorAll(".mode-option").forEach(option => {
    option.addEventListener("click", () => {
      document.querySelectorAll(".mode-option").forEach(o => o.classList.remove("active"));
      option.classList.add("active");
      selectedTransferMode = option.dataset.mode;
    });
  });

  // File input
  document.getElementById("file-input").addEventListener("change", handleFileSelection);
  document.getElementById("remove-file").addEventListener("click", clearFileSelection);
  document.getElementById("send-file").addEventListener("click", sendFile);
  document.getElementById("clear-file").addEventListener("click", clearFileSelection);

  // User list
  document.getElementById("user-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("user-tag")) {
      const user = e.target.getAttribute("data-user");
      document.getElementById("recipient-username").value = user;
    }
  });

  // Drag and drop
  setupDragAndDrop();
}

// Set username
async function setUsername() {
  const input = document.getElementById("username-input");
  const requestedUsername = input.value.trim();

  if (!requestedUsername || requestedUsername.length < 3) {
    alert("Username must be at least 3 characters");
    return;
  }

  document.getElementById("set-username-btn").disabled = true;

  const response = await sendToBackground({
    type: "SET_USERNAME",
    username: requestedUsername
  });

  if (!response?.success && response?.message) {
    alert(response.message);
    document.getElementById("set-username-btn").disabled = false;
  }
}

// Show main interface
function showMainInterface() {
  document.getElementById("status-text").innerText = `Connected as: ${username}`;
  document.getElementById("username-setup").classList.add("hidden");
  document.getElementById("transfer-interface").classList.remove("hidden");
  document.getElementById("set-username-btn").disabled = false;

  // Request user list
  sendToBackground({ type: "GET_USERS" });
}

// Show username setup
function showUsernameSetup() {
  document.getElementById("username-setup").classList.remove("hidden");
  document.getElementById("transfer-interface").classList.add("hidden");
}

// Update user list
function updateUserList(users) {
  const userListElement = document.getElementById("user-list");

  if (!users || users.length === 0) {
    userListElement.innerHTML = '<span style="color: #999; font-size: 12px;">No other users online</span>';
  } else {
    userListElement.innerHTML = users.map(user =>
      `<span class="user-tag" data-user="${user}">${user}</span>`
    ).join('');
  }
}

// Handle file selection
function handleFileSelection(event) {
  const file = event.target.files[0];
  if (file) {
    showFilePreview(file);
  }
}

// Show file preview
function showFilePreview(file) {
  selectedFile = file;

  const preview = document.getElementById("file-preview");
  const nameElement = document.getElementById("preview-file-name");
  const detailsElement = document.getElementById("preview-file-details");
  const fileIcon = preview.querySelector(".file-icon");

  nameElement.textContent = file.name;
  detailsElement.textContent = `${formatBytes(file.size)} • ${file.type || "Unknown type"}`;

  // Set icon based on type
  const iconMap = {
    'image': '🖼️',
    'video': '🎥',
    'audio': '🎵',
    'pdf': '📑',
    'zip': '🗜️',
    'word': '📝',
    'excel': '📊'
  };

  let icon = '📄';
  for (const [key, value] of Object.entries(iconMap)) {
    if (file.type.includes(key) || file.name.includes(key)) {
      icon = value;
      break;
    }
  }
  fileIcon.textContent = icon;

  preview.classList.add("active");
  document.querySelector(".file-input-label").textContent = "✅ File selected";
}

// Clear file selection
function clearFileSelection() {
  selectedFile = null;
  document.getElementById("file-input").value = "";
  document.getElementById("file-preview").classList.remove("active");
  document.querySelector(".file-input-label").textContent = "📁 Choose file or drag & drop here";
}

// Send file
async function sendFile() {
  const recipient = document.getElementById("recipient-username").value.trim();

  if (!selectedFile) {
    alert("Please select a file");
    return;
  }

  if (!recipient) {
    alert("Please enter recipient username");
    return;
  }

  if (recipient === username) {
    alert("Cannot send file to yourself");
    return;
  }

  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  if (selectedFile.size > MAX_FILE_SIZE) {
    alert(`File too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}`);
    return;
  }

  document.getElementById("send-file").disabled = true;

  // Send file data to background
  const response = await sendToBackground({
    type: "SEND_FILE",
    fileData: selectedFile,
    fileName: selectedFile.name,
    fileType: selectedFile.type,
    recipient: recipient,
    transferMode: selectedTransferMode
  });

  if (response?.success) {
    showTransferProgress({
      transferId: response.transferId,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      progress: 0,
      sending: true
    });
    clearFileSelection();
  } else {
    alert("Failed to start transfer");
    document.getElementById("send-file").disabled = false;
  }
}

// Show incoming file notification
function showIncomingFile(data) {
  const container = document.getElementById("progress-container");
  container.style.display = "block";

  const html = `
    <div class="transfer-item" data-transfer-id="${data.transferId}">
      <div class="transfer-info">
        <span class="transfer-label">Receiving from ${data.sender}:</span>
        <span class="transfer-name">${data.file.name}</span>
        <span class="transfer-size">(${formatBytes(data.file.size)})</span>
      </div>
      <progress class="transfer-progress" value="0" max="100"></progress>
      <div class="transfer-status">0%</div>
    </div>
  `;

  container.innerHTML = html;
  activeTransfers.set(data.transferId, data);
}

// Show transfer progress
function showTransferProgress(data) {
  let container = document.querySelector(`[data-transfer-id="${data.transferId}"]`);

  if (!container) {
    const progressContainer = document.getElementById("progress-container");
    progressContainer.style.display = "block";

    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.dataset.transferId = data.transferId;
    div.innerHTML = `
      <div class="transfer-info">
        <span class="transfer-label">${data.sending ? 'Sending to' : 'Receiving from'} ${data.recipient || data.sender}:</span>
        <span class="transfer-name">${data.fileName}</span>
        <span class="transfer-size">(${formatBytes(data.fileSize || data.totalBytes)})</span>
      </div>
      <progress class="transfer-progress" value="${data.progress || 0}" max="100"></progress>
      <div class="transfer-status">${data.progress || 0}%</div>
    `;
    progressContainer.appendChild(div);
    container = div;
  }

  activeTransfers.set(data.transferId, data);
}

// Update transfer progress
function updateTransferProgress(data) {
  const container = document.querySelector(`[data-transfer-id="${data.transferId}"]`);
  if (container) {
    const progressBar = container.querySelector('.transfer-progress');
    const statusText = container.querySelector('.transfer-status');

    progressBar.value = data.progress;

    const bytesText = data.sentBytes ?
      `${formatBytes(data.sentBytes)} / ${formatBytes(data.totalBytes)}` :
      `${formatBytes(data.receivedBytes)} / ${formatBytes(data.totalBytes)}`;

    statusText.textContent = `${data.progress}% - ${bytesText}`;
  }
}

// Handle transfer complete
function handleTransferComplete(data) {
  const container = document.querySelector(`[data-transfer-id="${data.transferId}"]`);
  if (container) {
    const statusText = container.querySelector('.transfer-status');
    statusText.textContent = "✅ Complete";

    setTimeout(() => {
      container.remove();
      activeTransfers.delete(data.transferId);

      if (activeTransfers.size === 0) {
        document.getElementById("progress-container").style.display = "none";
      }
    }, 3000);
  }

  document.getElementById("send-file").disabled = false;
  document.getElementById("status-text").innerText = `File sent: ${data.fileName}`;
}

// Show download ready
async function showDownloadReady(data) {
  const container = document.getElementById("button-container");

  // Get file from background
  const response = await sendToBackground({
    type: "DOWNLOAD_FILE",
    transferId: data.transferId
  });

  if (response?.success && response.file) {
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn';
    downloadBtn.innerHTML = `
      <span>📥 Download ${response.file.name}</span>
      <span class="file-size">(${formatBytes(response.file.size)})</span>
    `;

    downloadBtn.addEventListener('click', () => {
      // Convert base64 to blob and download
      const byteCharacters = atob(response.file.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: response.file.type });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.file.name;
      a.click();
      URL.revokeObjectURL(url);

      container.innerHTML = "";
      document.getElementById("status-text").innerText = `Downloaded: ${response.file.name}`;
    });

    container.innerHTML = '';
    container.appendChild(downloadBtn);
  }

  // Hide transfer progress for this file
  const transferContainer = document.querySelector(`[data-transfer-id="${data.transferId}"]`);
  if (transferContainer) {
    transferContainer.remove();
  }
}

// Handle transfer error
function handleTransferError(data) {
  const container = document.querySelector(`[data-transfer-id="${data.transferId}"]`);
  if (container) {
    const statusText = container.querySelector('.transfer-status');
    statusText.textContent = `❌ Error: ${data.error}`;
  }

  document.getElementById("send-file").disabled = false;
  alert(`Transfer failed: ${data.error}`);
}

// Update connection status
function updateConnectionStatus(connected) {
  const statusElement = document.querySelector(".connection-status");
  const statusText = document.getElementById("status-text");

  if (connected) {
    statusElement.classList.remove("disconnected");
    statusElement.classList.add("connected");
    if (!username) {
      statusText.innerText = "Connected - Please set username";
    }
  } else {
    statusElement.classList.remove("connected");
    statusElement.classList.add("disconnected");
    statusText.innerText = "Disconnected - Reconnecting...";
  }
}

// Setup drag and drop
function setupDragAndDrop() {
  const dropZone = document.getElementById("drop-zone");

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      document.getElementById("file-input").files = files;
      showFilePreview(files[0]);
    }
  });
}

// Helper function
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}