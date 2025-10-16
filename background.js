// background.js - Complete file transfer handling in background

// Connection state
let ws = null;
let currentUsername = null;
let reconnectInterval = null;

// File transfer state
let activeTransfers = new Map(); // transferId -> transfer data
let peerConnections = new Map(); // peerId -> RTCPeerConnection
let dataChannels = new Map(); // peerId -> RTCDataChannel

// Initialize on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  loadAndConnect();
});

// Start connection when browser starts
chrome.runtime.onStartup.addListener(() => {
  loadAndConnect();
});

// Load saved username and connect
async function loadAndConnect() {
  const result = await chrome.storage.local.get(['username']);
  if (result.username) {
    currentUsername = result.username;
    connectToServer();
  }
}

// Connect to WebSocket server
function connectToServer() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    ws = new WebSocket("ws://localhost:8080");

    ws.onopen = () => {
      console.log("Connected to server from background");
      clearInterval(reconnectInterval);

      if (currentUsername) {
        ws.send(JSON.stringify({
          type: "SET_USERNAME",
          username: currentUsername
        }));
      }

      notifyPopup({
        type: "CONNECTION_STATUS",
        connected: true,
        username: currentUsername
      });
    };

    ws.onmessage = (event) => {
      handleServerMessage(event.data);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      scheduleReconnect();
    };

    ws.onclose = () => {
      console.log("Disconnected from server");
      scheduleReconnect();
      notifyPopup({
        type: "CONNECTION_STATUS",
        connected: false
      });
    };
  } catch (error) {
    console.error("Failed to connect:", error);
    scheduleReconnect();
  }
}

// Schedule reconnection
function scheduleReconnect() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
  reconnectInterval = setInterval(() => {
    console.log("Attempting to reconnect...");
    connectToServer();
  }, 3000);
}

// Handle messages from server
async function handleServerMessage(data) {
  try {
    const message = JSON.parse(data);
    console.log("Received message:", message.type);

    switch (message.type) {
      case "USERNAME_SET":
        currentUsername = message.username;
        await chrome.storage.local.set({
          username: currentUsername,
          usernameSetAt: Date.now()
        });
        notifyPopup({
          type: "USERNAME_CONFIRMED",
          username: currentUsername,
          availableUsers: message.availableUsers
        });
        break;

      case "USERNAME_ERROR":
        await chrome.storage.local.remove('username');
        currentUsername = null;
        notifyPopup({
          type: "USERNAME_ERROR",
          message: message.message
        });
        break;

      case "USER_LIST":
        notifyPopup({
          type: "USER_LIST",
          users: message.users
        });
        break;

      case "FILE_METADATA":
        await handleIncomingFileMetadata(message);
        break;

      case "FILE_CHUNK":
        await handleFileChunk(message);
        break;

      case "FILE_COMPLETE":
        await handleFileComplete(message);
        break;

      case "WEBRTC_OFFER":
        await handleWebRTCOffer(message);
        break;

      case "WEBRTC_ANSWER":
        await handleWebRTCAnswer(message);
        break;

      case "WEBRTC_ICE_CANDIDATE":
        await handleICECandidate(message);
        break;

      case "ERROR":
        notifyPopup({
          type: "ERROR",
          message: message.message
        });
        break;
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
}

// Handle incoming file metadata
async function handleIncomingFileMetadata(message) {
  const transferId = `${message.sender}_${Date.now()}`;

  activeTransfers.set(transferId, {
    sender: message.sender,
    fileName: message.file.name,
    fileSize: message.file.size,
    fileType: message.file.type,
    transferMode: message.transferMode,
    chunks: [],
    receivedBytes: 0,
    startTime: Date.now()
  });

  // Save to storage for persistence
  await saveTransferState();

  notifyPopup({
    type: "INCOMING_FILE",
    transferId,
    sender: message.sender,
    file: message.file,
    transferMode: message.transferMode
  });

  // Show notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Incoming File',
    message: `${message.sender} is sending you ${message.file.name} (${formatBytes(message.file.size)})`
  });
}

// Handle file chunk
async function handleFileChunk(message) {
  // Find the active transfer
  let transferId = null;
  for (const [id, transfer] of activeTransfers) {
    if (transfer.sender === message.sender && transfer.fileName === message.file.name) {
      transferId = id;
      break;
    }
  }

  if (!transferId) {
    console.error("No active transfer found for chunk");
    return;
  }

  const transfer = activeTransfers.get(transferId);
  const chunkData = new Uint8Array(message.file.data);

  transfer.chunks.push({
    offset: message.file.offset,
    data: chunkData
  });
  transfer.receivedBytes += chunkData.length;

  // Calculate progress
  const progress = Math.round((transfer.receivedBytes / transfer.fileSize) * 100);

  // Update popup if open
  notifyPopup({
    type: "TRANSFER_PROGRESS",
    transferId,
    progress,
    receivedBytes: transfer.receivedBytes,
    totalBytes: transfer.fileSize
  });

  // Check if complete
  if (transfer.receivedBytes >= transfer.fileSize) {
    await completeFileReception(transferId);
  }

  // Save state periodically
  if (transfer.chunks.length % 10 === 0) {
    await saveTransferState();
  }
}

// Complete file reception
async function completeFileReception(transferId) {
  const transfer = activeTransfers.get(transferId);
  if (!transfer) return;

  // Sort chunks by offset
  transfer.chunks.sort((a, b) => a.offset - b.offset);

  // Reassemble file
  const fileData = new Uint8Array(transfer.fileSize);
  for (const chunk of transfer.chunks) {
    fileData.set(chunk.data, chunk.offset);
  }

  // Create blob
  const blob = new Blob([fileData], { type: transfer.fileType || "application/octet-stream" });

  // Save to storage for download
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    await chrome.storage.local.set({
      [`file_${transferId}`]: {
        name: transfer.fileName,
        data: base64,
        size: transfer.fileSize,
        type: transfer.fileType,
        sender: transfer.sender,
        receivedAt: Date.now()
      }
    });

    // Notify popup
    notifyPopup({
      type: "FILE_READY",
      transferId,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      sender: transfer.sender
    });

    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'File Received',
      message: `${transfer.fileName} from ${transfer.sender} is ready to download`,
      buttons: [{ title: 'Download' }]
    });

    // Clean up transfer
    activeTransfers.delete(transferId);
    await saveTransferState();
  };
  reader.readAsDataURL(blob);
}

// Handle file complete message
async function handleFileComplete(message) {
  console.log("File transfer complete:", message.fileName);
  notifyPopup({
    type: "TRANSFER_COMPLETE",
    fileName: message.fileName,
    sender: message.sender
  });
}

// WebRTC Handling
async function handleWebRTCOffer(message) {
  console.log("Received WebRTC offer from", message.sender);

  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  const peerConnection = new RTCPeerConnection(configuration);
  const peerId = message.sender;
  peerConnections.set(peerId, peerConnection);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
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

    const transferId = `webrtc_${peerId}_${Date.now()}`;
    let receivedData = [];
    let receivedSize = 0;
    let fileMetadata = null;

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'FILE_METADATA') {
          fileMetadata = msg;
          activeTransfers.set(transferId, {
            sender: peerId,
            fileName: msg.name,
            fileSize: msg.size,
            fileType: msg.type,
            transferMode: 'webrtc',
            receivedBytes: 0,
            startTime: Date.now()
          });

          notifyPopup({
            type: "INCOMING_FILE",
            transferId,
            sender: peerId,
            file: msg,
            transferMode: 'webrtc'
          });
        } else if (msg.type === 'EOF') {
          // File received completely
          const fileData = new Uint8Array(receivedSize);
          let offset = 0;
          for (const chunk of receivedData) {
            fileData.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }

          // Save file
          const blob = new Blob([fileData], { type: fileMetadata?.type || "application/octet-stream" });
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            await chrome.storage.local.set({
              [`file_${transferId}`]: {
                name: fileMetadata?.name || 'download',
                data: base64,
                size: receivedSize,
                type: fileMetadata?.type,
                sender: peerId,
                receivedAt: Date.now()
              }
            });

            notifyPopup({
              type: "FILE_READY",
              transferId,
              fileName: fileMetadata?.name || 'download',
              fileSize: receivedSize,
              sender: peerId
            });

            // Show notification
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'File Received',
              message: `${fileMetadata?.name || 'File'} from ${peerId} is ready to download`,
              buttons: [{ title: 'Download' }]
            });

            activeTransfers.delete(transferId);
          };
          reader.readAsDataURL(blob);
        }
      } else {
        // Received file chunk
        receivedData.push(event.data);
        receivedSize += event.data.byteLength;

        const transfer = activeTransfers.get(transferId);
        if (transfer) {
          transfer.receivedBytes = receivedSize;
          const progress = Math.round((receivedSize / transfer.fileSize) * 100);

          notifyPopup({
            type: "TRANSFER_PROGRESS",
            transferId,
            progress,
            receivedBytes: receivedSize,
            totalBytes: transfer.fileSize
          });
        }
      }
    };
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "WEBRTC_ANSWER",
      recipient: message.sender,
      answer: answer
    }));
  }
}

async function handleWebRTCAnswer(message) {
  console.log("Received WebRTC answer from", message.sender);
  const peerConnection = peerConnections.get(message.sender);
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
  }
}

async function handleICECandidate(message) {
  const peerConnection = peerConnections.get(message.sender);
  if (peerConnection) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

// Send file (called from popup)
async function sendFile(file, recipient, transferMode) {
  const transferId = `send_${Date.now()}`;

  activeTransfers.set(transferId, {
    recipient,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    transferMode,
    sentBytes: 0,
    startTime: Date.now()
  });

  if (transferMode === 'webrtc') {
    await startWebRTCTransfer(file, recipient, transferId);
  } else {
    await startWebSocketTransfer(file, recipient, transferId);
  }

  return transferId;
}

// Start WebRTC transfer
async function startWebRTCTransfer(file, recipient, transferId) {
  // Send metadata first
  if (ws && ws.readyState === WebSocket.OPEN) {
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
  }

  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  const peerConnection = new RTCPeerConnection(configuration);
  peerConnections.set(recipient, peerConnection);

  const dataChannel = peerConnection.createDataChannel("fileTransfer", {
    ordered: true,
    maxPacketLifeTime: 3000
  });

  dataChannel.binaryType = 'arraybuffer';
  dataChannel.bufferedAmountLowThreshold = 65536;
  dataChannels.set(recipient, dataChannel);

  dataChannel.onopen = () => {
    console.log("Data channel opened");
    // Send file metadata through data channel
    dataChannel.send(JSON.stringify({
      type: 'FILE_METADATA',
      name: file.name,
      size: file.size,
      type: file.type
    }));
    sendFileViaDataChannel(file, dataChannel, transferId);
  };

  dataChannel.onerror = (error) => {
    console.error("Data channel error:", error);
    notifyPopup({
      type: "TRANSFER_ERROR",
      transferId,
      error: "Data channel error"
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "WEBRTC_ICE_CANDIDATE",
        recipient,
        candidate: event.candidate
      }));
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "WEBRTC_OFFER",
      recipient,
      offer: offer
    }));
  }
}

// Send file via data channel
async function sendFileViaDataChannel(file, dataChannel, transferId) {
  const chunkSize = 16384;
  let offset = 0;
  const transfer = activeTransfers.get(transferId);

  const sendNextChunk = () => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error("Data channel closed");
      return;
    }

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

        if (transfer) {
          transfer.sentBytes = offset;
          const progress = Math.round((offset / file.size) * 100);

          notifyPopup({
            type: "TRANSFER_PROGRESS",
            transferId,
            progress,
            sentBytes: offset,
            totalBytes: file.size
          });
        }

        if (offset < file.size) {
          sendNextChunk();
        } else {
          dataChannel.send(JSON.stringify({ type: "EOF" }));
          console.log("File sent successfully");

          notifyPopup({
            type: "TRANSFER_COMPLETE",
            transferId,
            fileName: file.name
          });

          activeTransfers.delete(transferId);
        }
      }
    };

    reader.readAsArrayBuffer(slice);
  };

  sendNextChunk();
}

// Start WebSocket transfer
async function startWebSocketTransfer(file, recipient, transferId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
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
  }

  sendFileViaWebSocket(file, recipient, transferId);
}

// Send file via WebSocket
function sendFileViaWebSocket(file, recipient, transferId) {
  const CHUNK_SIZE = 256 * 1024;
  let offset = 0;
  const transfer = activeTransfers.get(transferId);

  function sendNextChunk() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket closed");
      return;
    }

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

      if (transfer) {
        transfer.sentBytes = offset;
        const progress = Math.round((offset / file.size) * 100);

        notifyPopup({
          type: "TRANSFER_PROGRESS",
          transferId,
          progress,
          sentBytes: offset,
          totalBytes: file.size
        });
      }

      if (offset < file.size) {
        setTimeout(sendNextChunk, 10);
      } else {
        ws.send(JSON.stringify({
          type: "FILE_COMPLETE",
          recipient,
          fileName: file.name
        }));

        notifyPopup({
          type: "TRANSFER_COMPLETE",
          transferId,
          fileName: file.name
        });

        activeTransfers.delete(transferId);
      }
    };

    reader.readAsArrayBuffer(chunk);
  }

  sendNextChunk();
}

// Save transfer state for recovery
async function saveTransferState() {
  const transfers = Array.from(activeTransfers.entries()).map(([id, data]) => ({
    id,
    ...data,
    chunks: undefined // Don't save chunks to avoid storage limits
  }));

  await chrome.storage.local.set({ activeTransfers: transfers });
}

// Load transfer state on startup
async function loadTransferState() {
  const result = await chrome.storage.local.get(['activeTransfers']);
  if (result.activeTransfers) {
    for (const transfer of result.activeTransfers) {
      activeTransfers.set(transfer.id, {
        ...transfer,
        chunks: []
      });
    }
  }
}

// Notify popup if it's open
function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might not be open, store important messages
    if (message.type === 'FILE_READY' || message.type === 'INCOMING_FILE') {
      chrome.storage.local.get(['pendingNotifications'], (result) => {
        const notifications = result.pendingNotifications || [];
        notifications.push(message);
        chrome.storage.local.set({ pendingNotifications: notifications });
      });
    }
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handlePopupMessage(request, sendResponse);
  return true; // Keep channel open for async response
});

async function handlePopupMessage(request, sendResponse) {
  switch (request.type) {
    case "GET_STATE":
      const state = await chrome.storage.local.get(['username', 'pendingNotifications']);
      const transfers = Array.from(activeTransfers.entries()).map(([id, data]) => ({
        id,
        ...data,
        chunks: undefined
      }));

      sendResponse({
        connected: ws && ws.readyState === WebSocket.OPEN,
        username: state.username || currentUsername,
        activeTransfers: transfers,
        pendingNotifications: state.pendingNotifications || []
      });

      // Clear pending notifications
      await chrome.storage.local.remove('pendingNotifications');
      break;

    case "SET_USERNAME":
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "SET_USERNAME",
          username: request.username
        }));
        sendResponse({ success: true });
      } else {
        currentUsername = request.username;
        connectToServer();
        sendResponse({ success: false, message: "Connecting to server..." });
      }
      break;

    case "SEND_FILE":
      // Read file from popup
      const reader = new FileReader();
      reader.onload = async () => {
        const arrayBuffer = reader.result;
        const file = new File([arrayBuffer], request.fileName, { type: request.fileType });
        const transferId = await sendFile(file, request.recipient, request.transferMode);
        sendResponse({ success: true, transferId });
      };
      reader.readAsArrayBuffer(request.fileData);
      break;

    case "DOWNLOAD_FILE":
      const fileData = await chrome.storage.local.get([`file_${request.transferId}`]);
      const file = fileData[`file_${request.transferId}`];
      if (file) {
        sendResponse({ success: true, file });
        // Clean up after download
        await chrome.storage.local.remove([`file_${request.transferId}`]);
      } else {
        sendResponse({ success: false, message: "File not found" });
      }
      break;

    case "GET_USERS":
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "GET_USERS" }));
      }
      sendResponse({ success: true });
      break;

    case "CONNECT":
      connectToServer();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, message: "Unknown request type" });
  }
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    // Open popup to download
    chrome.action.openPopup();
  }
});

// Helper function
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

// Keep service worker alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "PING" }));
  }
}, 30000);

// Load state on startup
loadTransferState();