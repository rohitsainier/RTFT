// popup.js - Updated to work with background service worker

// Global variables
let username = null;
let selectedTransferMode = 'webrtc';
let peerConnection = null;
let dataChannel = null;
let fileChunks = [];
let fileSize = 0;
let fileName = "";
let receivedBytes = 0;
let selectedFile = null;
let isConnected = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  // Get current state from background
  const state = await sendToBackground({ type: "GET_STATE" });

  if (state) {
    isConnected = state.connected;
    updateConnectionStatus(state.connected);

    if (state.username) {
      // User already has a username set
      username = state.username;
      handleUsernameSet({
        username: state.username,
        availableUsers: state.users || []
      });
    } else {
      // Show username setup
      document.getElementById("username-setup").classList.remove("hidden");
      document.getElementById("transfer-interface").classList.add("hidden");
    }

    if (state.users && state.users.length > 0) {
      updateUserList(state.users);
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Request connection if not connected
  if (!isConnected) {
    sendToBackground({ type: "CONNECT" });
  }
});

// Send message to background service worker
function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

// Handle messages from background
function handleBackgroundMessage(message, sender, sendResponse) {
  switch (message.type) {
    case "CONNECTION_STATUS":
      isConnected = message.connected;
      updateConnectionStatus(message.connected);
      if (message.username) {
        username = message.username;
        handleUsernameSet({ username: message.username });
      }
      break;

    case "USERNAME_CONFIRMED":
      username = message.username;
      handleUsernameSet(message);
      break;

    case "USERNAME_ERROR":
      alert(message.message);
      document.getElementById("set-username-btn").disabled = false;
      break;

    case "USER_LIST":
      updateUserList(message.users);
      break;

    case "SERVER_MESSAGE":
      handleServerMessage(message.data);
      break;
  }
}

// Handle server messages forwarded from background
function handleServerMessage(message) {
  switch (message.type) {
    case "FILE_METADATA":
      handleIncomingFileMetadata(message);
      break;
    case "FILE_CHUNK":
      handleFileChunk(message);
      break;
    case "FILE_COMPLETE":
      handleFileComplete(message);
      break;
    case "WEBRTC_OFFER":
      handleWebRTCOffer(message);
      break;
    case "WEBRTC_ANSWER":
      handleWebRTCAnswer(message);
      break;
    case "WEBRTC_ICE_CANDIDATE":
      handleICECandidate(message);
      break;
    case "ERROR":
      handleError(message);
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

  // File input change event
  document.getElementById("file-input").addEventListener("change", handleFileSelection);

  // Remove file button
  document.getElementById("remove-file").addEventListener("click", clearFileSelection);

  // File transfer
  document.getElementById("send-file").addEventListener("click", sendFile);
  document.getElementById("clear-file").addEventListener("click", clearFileSelection);

  // User list delegation
  document.getElementById("user-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("user-tag")) {
      const user = e.target.getAttribute("data-user");
      selectUser(user);
    }
  });

  // Drag and drop
  setupDragAndDrop();
}

// Set username
async function setUsername() {
  const input = document.getElementById("username-input");
  const requestedUsername = input.value.trim();

  if (!requestedUsername) {
    alert("Please enter a username");
    return;
  }

  if (requestedUsername.length < 3) {
    alert("Username must be at least 3 characters");
    return;
  }

  document.getElementById("set-username-btn").disabled = true;

  // Send to background service worker
  const response = await sendToBackground({
    type: "SET_USERNAME",
    username: requestedUsername
  });

  if (!response.success && response.message) {
    alert(response.message);
    document.getElementById("set-username-btn").disabled = false;
  }
}

// Handle username confirmation
function handleUsernameSet(message) {
  username = message.username;
  document.getElementById("status-text").innerText = `Connected as: ${username}`;
  document.getElementById("username-setup").classList.add("hidden");
  document.getElementById("transfer-interface").classList.remove("hidden");
  document.getElementById("set-username-btn").disabled = false;

  if (message.availableUsers) {
    updateUserList(message.availableUsers);
  }
}

// Update online users list
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

// Select user from list
function selectUser(user) {
  document.getElementById("recipient-username").value = user;
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

  // Set file name
  nameElement.textContent = file.name;

  // Set file details
  const fileSize = formatBytes(file.size);
  const fileType = file.type || "Unknown type";
  detailsElement.textContent = `${fileSize} • ${fileType}`;

  // Set appropriate icon based on file type
  if (file.type.startsWith("image/")) {
    fileIcon.textContent = "🖼️";
  } else if (file.type.startsWith("video/")) {
    fileIcon.textContent = "🎥";
  } else if (file.type.startsWith("audio/")) {
    fileIcon.textContent = "🎵";
  } else if (file.type.includes("pdf")) {
    fileIcon.textContent = "📑";
  } else if (file.type.includes("zip") || file.type.includes("rar")) {
    fileIcon.textContent = "🗜️";
  } else if (file.type.includes("word") || file.type.includes("document")) {
    fileIcon.textContent = "📝";
  } else if (file.type.includes("sheet") || file.type.includes("excel")) {
    fileIcon.textContent = "📊";
  } else {
    fileIcon.textContent = "📄";
  }

  // Show preview
  preview.classList.add("active");

  // Update file input label
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

  const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2 GB

  if (selectedFile.size > MAX_FILE_SIZE) {
    alert(`File too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}`);
    return;
  }

  document.getElementById("send-file").disabled = true;
  document.getElementById("progress-container").style.display = "block";

  if (selectedTransferMode === 'webrtc') {
    startWebRTCTransfer(selectedFile, recipient);
  } else {
    startWebSocketTransfer(selectedFile, recipient);
  }
}

// Send WebSocket message through background
async function sendWSMessage(data) {
  return await sendToBackground({
    type: "SEND_MESSAGE",
    data: data
  });
}

// WebRTC Transfer
async function startWebRTCTransfer(file, recipient) {
  console.log("Starting WebRTC transfer to", recipient);

  // Send file metadata first
  await sendWSMessage({
    type: "FILE_METADATA",
    recipient,
    file: {
      name: file.name,
      size: file.size,
      type: file.type
    },
    transferMode: "webrtc"
  });

  // Create peer connection
  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  peerConnection = new RTCPeerConnection(configuration);

  // Create data channel
  dataChannel = peerConnection.createDataChannel("fileTransfer", {
    ordered: true,
    maxPacketLifeTime: 3000
  });

  dataChannel.binaryType = 'arraybuffer';
  dataChannel.bufferedAmountLowThreshold = 65536;

  dataChannel.onopen = () => {
    console.log("Data channel opened");
    sendFileViaDataChannel(file);
  };

  dataChannel.onerror = (error) => {
    console.error("Data channel error:", error);
    document.getElementById("status-text").innerText = "Transfer failed";
    document.getElementById("send-file").disabled = false;
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendWSMessage({
        type: "WEBRTC_ICE_CANDIDATE",
        recipient,
        candidate: event.candidate
      });
    }
  };

  // Create and send offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  await sendWSMessage({
    type: "WEBRTC_OFFER",
    recipient,
    offer: offer
  });
}

// Send file via data channel
async function sendFileViaDataChannel(file) {
  const chunkSize = 1 * 1024 * 256; // 256KB chunks for WebRTC
  let offset = 0;
  const startTime = performance.now();

  const sendNextChunk = () => {
    if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
      setTimeout(sendNextChunk, 50);
      return;
    }

    const slice = file.slice(offset, offset + chunkSize);
    const reader = new FileReader();

    reader.onload = (e) => {
      if (dataChannel.readyState === 'open') {
        dataChannel.send(e.target.result);
        offset += slice.size;

        // Update progress
        const progress = Math.round((offset / file.size) * 100);
        const elapsed = (performance.now() - startTime) / 1000;
        const speed = offset / elapsed;

        document.getElementById("progress-bar").value = progress;
        document.getElementById("progress-text").innerText =
          `${progress}% - ${formatBytes(speed)}/s`;

        if (offset < file.size) {
          sendNextChunk();
        } else {
          // File transfer complete
          dataChannel.send(JSON.stringify({ type: "EOF" }));
          console.log("File sent successfully");
          document.getElementById("status-text").innerText = "File sent successfully";
          document.getElementById("send-file").disabled = false;
          clearFileSelection();
          setTimeout(() => {
            document.getElementById("progress-container").style.display = "none";
          }, 2000);
        }
      }
    };

    reader.readAsArrayBuffer(slice);
  };

  sendNextChunk();
}

// WebSocket Transfer
function startWebSocketTransfer(file, recipient) {
  console.log("Starting WebSocket transfer to", recipient);

  sendWSMessage({
    type: "FILE_METADATA",
    recipient,
    file: {
      name: file.name,
      size: file.size,
      type: file.type
    },
    transferMode: "websocket"
  });

  sendFileViaWebSocket(file, recipient);
}

// Send file via WebSocket
function sendFileViaWebSocket(file, recipient) {
  const CHUNK_SIZE = 256 * 1024; // 256KB chunks
  let offset = 0;
  let startTime = performance.now();

  function sendNextChunk() {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = async () => {
      const chunkData = new Uint8Array(reader.result);

      await sendWSMessage({
        type: "FILE_CHUNK",
        recipient,
        file: {
          name: file.name,
          size: file.size,
          offset: offset,
          data: Array.from(chunkData)
        }
      });

      offset += chunk.size;

      // Update progress
      const progress = Math.round((offset / file.size) * 100);
      const elapsed = (performance.now() - startTime) / 1000;
      const speed = offset / elapsed;

      document.getElementById("progress-bar").value = progress;
      document.getElementById("progress-text").innerText =
        `${progress}% - ${formatBytes(speed)}/s`;

      if (offset < file.size) {
        setTimeout(sendNextChunk, 10);
      } else {
        sendWSMessage({
          type: "FILE_COMPLETE",
          recipient,
          fileName: file.name
        });

        console.log("File sent successfully");
        document.getElementById("status-text").innerText = "File sent successfully";
        document.getElementById("send-file").disabled = false;
        clearFileSelection();

        setTimeout(() => {
          document.getElementById("progress-container").style.display = "none";
        }, 2000);
      }
    };

    reader.readAsArrayBuffer(chunk);
  }

  sendNextChunk();
}

// Handle incoming WebRTC offer
async function handleWebRTCOffer(message) {
  console.log("Received WebRTC offer from", message.sender);

  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendWSMessage({
        type: "WEBRTC_ICE_CANDIDATE",
        recipient: message.sender,
        candidate: event.candidate
      });
    }
  };

  peerConnection.ondatachannel = (event) => {
    const channel = event.channel;
    channel.binaryType = 'arraybuffer';

    let receivedData = [];
    let receivedSize = 0;

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'EOF') {
          // File received completely
          const fileData = new Uint8Array(receivedSize);
          let offset = 0;
          for (const chunk of receivedData) {
            fileData.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }

          // Create download link
          const blob = new Blob([fileData]);
          const url = URL.createObjectURL(blob);
          showDownloadButton(fileName || 'download', url, receivedSize);

          document.getElementById("progress-container").style.display = "none";
        }
      } else {
        // Received file chunk
        receivedData.push(event.data);
        receivedSize += event.data.byteLength;

        // Update progress
        if (fileSize > 0) {
          const progress = Math.round((receivedSize / fileSize) * 100);
          document.getElementById("progress-bar").value = progress;
          document.getElementById("progress-text").innerText =
            `${progress}% (${formatBytes(receivedSize)} / ${formatBytes(fileSize)})`;
        }
      }
    };
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  await sendWSMessage({
    type: "WEBRTC_ANSWER",
    recipient: message.sender,
    answer: answer
  });
}

// Handle WebRTC answer
async function handleWebRTCAnswer(message) {
  console.log("Received WebRTC answer from", message.sender);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
}

// Handle ICE candidate
async function handleICECandidate(message) {
  if (peerConnection) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

// Handle incoming file metadata
function handleIncomingFileMetadata(message) {
  fileName = message.file.name;
  fileSize = message.file.size;
  fileChunks = [];
  receivedBytes = 0;

  document.getElementById("progress-container").style.display = "block";
  document.getElementById("status-text").innerText =
    `Receiving ${fileName} from ${message.sender} (${message.transferMode})`;
}

// Handle file chunk (WebSocket)
function handleFileChunk(message) {
  const chunkData = new Uint8Array(message.file.data);
  fileChunks.push({
    offset: message.file.offset,
    data: chunkData
  });
  receivedBytes += chunkData.length;

  // Update progress
  const progress = Math.round((receivedBytes / fileSize) * 100);
  document.getElementById("progress-bar").value = progress;
  document.getElementById("progress-text").innerText =
    `${progress}% (${formatBytes(receivedBytes)} / ${formatBytes(fileSize)})`;

  if (receivedBytes >= fileSize) {
    reassembleFile();
  }
}

// Handle file complete
function handleFileComplete(message) {
  console.log("File transfer complete:", message.fileName);
  document.getElementById("status-text").innerText = `File received: ${message.fileName}`;
}

// Reassemble file from chunks
function reassembleFile() {
  fileChunks.sort((a, b) => a.offset - b.offset);

  const fileData = new Uint8Array(fileSize);
  for (const chunk of fileChunks) {
    fileData.set(chunk.data, chunk.offset);
  }

  const blob = new Blob([fileData], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  showDownloadButton(fileName, url, fileSize);
  document.getElementById("progress-container").style.display = "none";
}

// Show download button
function showDownloadButton(name, url, size) {
  const buttonContainer = document.getElementById("button-container");

  // Create download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'download-btn';
  downloadBtn.innerHTML = `
        <span>📥 Download ${name}</span>
        <span class="file-size">(${formatBytes(size)})</span>
    `;

  // Add click event listener
  downloadBtn.addEventListener('click', () => {
    downloadFile(url, name);
  });

  buttonContainer.innerHTML = '';
  buttonContainer.appendChild(downloadBtn);
}

// Download file
function downloadFile(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById("button-container").innerHTML = "";
  document.getElementById("status-text").innerText = `Downloaded: ${name}`;

  // Reset
  fileChunks = [];
  fileSize = 0;
  fileName = "";
  receivedBytes = 0;
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

// Handle errors
function handleError(message) {
  console.error("Error:", message.message);
  alert(`Error: ${message.message}`);
  document.getElementById("send-file").disabled = false;
  document.getElementById("progress-container").style.display = "none";
}

// Helper functions
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}