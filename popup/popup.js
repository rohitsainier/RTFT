// Global variables
let ws = null;
let username = null;
let selectedTransferMode = 'webrtc';
let peerConnection = null;
let dataChannel = null;
let fileChunks = [];
let fileSize = 0;
let fileName = "";
let receivedBytes = 0;
let selectedFile = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load saved username from localStorage
  loadSavedUsername();
  connectToServer();
  setupEventListeners();
});

// Load saved username
function loadSavedUsername() {
  const savedUsername = localStorage.getItem('p2p_username');
  if (savedUsername) {
    document.getElementById('username-input').value = savedUsername;
    // Auto-set username after connection
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        setUsername(savedUsername);
      }
    }, 500);
  }
}

// Connect to WebSocket server
function connectToServer() {
  ws = new WebSocket("ws://localhost:8080");  // replace wss://localhost:8080/ with your signaling server URL: https://qs2v6n76-8080.inc1.devtunnels.ms/
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log("Connected to server");
    updateConnectionStatus(true);

    // If we have a saved username, try to set it
    const savedUsername = localStorage.getItem('p2p_username');
    if (savedUsername) {
      setUsername(savedUsername);
    }
  };

  ws.onmessage = handleServerMessage;

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateConnectionStatus(false);
  };

  ws.onclose = () => {
    console.log("Disconnected from server");
    updateConnectionStatus(false);
    // Try to reconnect after 3 seconds
    setTimeout(connectToServer, 3000);
  };
}

// Handle messages from server
function handleServerMessage(event) {
  if (event.data instanceof ArrayBuffer) return;

  const message = JSON.parse(event.data);
  console.log("Received message:", message.type);

  switch (message.type) {
    case "USERNAME_SET":
      handleUsernameSet(message);
      break;
    case "USERNAME_ERROR":
      alert(message.message);
      document.getElementById("set-username-btn").disabled = false;
      // Clear saved username if it's invalid
      localStorage.removeItem('p2p_username');
      break;
    case "USER_LIST":
      updateUserList(message.users);
      break;
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
  document.getElementById("set-username-btn").addEventListener("click", () => {
    const input = document.getElementById("username-input").value.trim();
    setUsername(input);
  });

  document.getElementById("username-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const input = document.getElementById("username-input").value.trim();
      setUsername(input);
    }
  });

  // Transfer mode selection
  document.querySelectorAll(".mode-option").forEach(option => {
    option.addEventListener("click", () => {
      document.querySelectorAll(".mode-option").forEach(o => o.classList.remove("active"));
      option.classList.add("active");
      selectedTransferMode = option.dataset.mode;
      console.log("Transfer mode selected:", selectedTransferMode);
    });
  });

  // File input change event
  document.getElementById("file-input").addEventListener("change", handleFileSelection);

  // Remove file button
  document.getElementById("remove-file").addEventListener("click", clearFileSelection);

  // File transfer
  document.getElementById("send-file").addEventListener("click", sendFile);
  document.getElementById("clear-file").addEventListener("click", clearFileSelection);

  // User list delegation (for dynamically created elements)
  document.getElementById("user-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("user-tag")) {
      const user = e.target.getAttribute("data-user");
      selectUser(user);
    }
  });

  // Drag and drop
  setupDragAndDrop();
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

// Set username
function setUsername(requestedUsername) {
  if (!requestedUsername) {
    requestedUsername = document.getElementById("username-input").value.trim();
  }

  if (!requestedUsername) {
    alert("Please enter a username");
    return;
  }

  if (requestedUsername.length < 3) {
    alert("Username must be at least 3 characters");
    return;
  }

  document.getElementById("set-username-btn").disabled = true;

  // Save username to localStorage
  localStorage.setItem('p2p_username', requestedUsername);

  ws.send(JSON.stringify({
    type: "SET_USERNAME",
    username: requestedUsername
  }));
}

// Handle username confirmation
function handleUsernameSet(message) {
  username = message.username;
  document.getElementById("status-text").innerText = `Connected as: ${username}`;
  document.getElementById("username-setup").classList.add("hidden");
  document.getElementById("transfer-interface").classList.remove("hidden");

  // Save username to localStorage
  localStorage.setItem('p2p_username', username);

  if (message.availableUsers) {
    updateUserList(message.availableUsers);
  }
}

// Update online users list
function updateUserList(users) {
  const userListElement = document.getElementById("user-list");

  if (users.length === 0) {
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

  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

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

// WebRTC Transfer
async function startWebRTCTransfer(file, recipient) {
  console.log("Starting WebRTC transfer to", recipient);

  // Send file metadata first
  ws.send(JSON.stringify({
    type: "FILE_METADATA",
    recipient,
    file: {
      name: file.name,
      size: file.size,
      type: file.type
    },
    transferMode: "webrtc"
  }));

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
      ws.send(JSON.stringify({
        type: "WEBRTC_ICE_CANDIDATE",
        recipient,
        candidate: event.candidate
      }));
    }
  };

  // Create and send offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: "WEBRTC_OFFER",
    recipient,
    offer: offer
  }));
}

// Send file via data channel
async function sendFileViaDataChannel(file) {
  const chunkSize = 1 * 1024 * 256; // 256Kb chunks for WebRTC
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
      ws.send(JSON.stringify({
        type: "WEBRTC_ICE_CANDIDATE",
        recipient: message.sender,
        candidate: event.candidate
      }));
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

  ws.send(JSON.stringify({
    type: "WEBRTC_ANSWER",
    recipient: message.sender,
    answer: answer
  }));
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

// WebSocket Transfer
function startWebSocketTransfer(file, recipient) {
  console.log("Starting WebSocket transfer to", recipient);

  ws.send(JSON.stringify({
    type: "FILE_METADATA",
    recipient,
    file: {
      name: file.name,
      size: file.size,
      type: file.type
    },
    transferMode: "websocket"
  }));

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

    reader.onload = () => {
      const chunkData = new Uint8Array(reader.result);

      ws.send(JSON.stringify({
        type: "FILE_CHUNK",
        recipient,
        file: {
          name: file.name,
          size: file.size,
          offset: offset,
          data: Array.from(chunkData)
        }
      }));

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
        ws.send(JSON.stringify({
          type: "FILE_COMPLETE",
          recipient,
          fileName: file.name
        }));

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