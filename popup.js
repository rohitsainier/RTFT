let localConnection;
let remoteConnection;
let sendChannel;
let receiveChannel;
let fileReader;
let receiveBuffer = [];
let receivedSize = 0;
let fileSize = 0;
let clientId;
let targetClientId;
let signalingServer;

document
  .getElementById("connectButton")
  .addEventListener("click", connectToServer);
document
  .getElementById("sendButton")
  .addEventListener("click", createConnection);
document
  .getElementById("receiveButton")
  .addEventListener("click", receiveConnection);

const clientListElement = document.getElementById("clientList");
const statusElement = document.getElementById("status");
const webrtcStatusElement = document.getElementById("webrtcStatus"); // New element for WebRTC status
const connectButton = document.getElementById("connectButton");

// Add these new variables
let pendingFileTransfer = false;
const receiveButton = document.getElementById("receiveButton");

function connectToServer() {
  if (signalingServer && signalingServer.readyState === WebSocket.OPEN) {
    statusElement.textContent = "Already connected.";
    return;
  }

  signalingServer = new WebSocket("https://glimmer-political-koi.glitch.me");
  signalingServer.onopen = () => {
    statusElement.textContent = "Connected to signaling server.";
    connectButton.textContent = "Connected";
    connectButton.disabled = true;
  };
  signalingServer.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "clientId") {
      clientId = data.id;
      statusElement.textContent = `Connected as ${clientId}`;
      document.getElementById("fileInput").disabled = false;
      document.getElementById("sendButton").disabled = false;
      document.getElementById("receiveButton").disabled = false;
    } else if (data.type === "clientList") {
      updateClientList(data.clients);
    } else if (
      data.type === "offer" ||
      data.type === "answer" ||
      data.type === "candidate"
    ) {
      handleSignalingData(data);
    }
  };
  signalingServer.onclose = () => {
    statusElement.textContent = "Disconnected from signaling server.";
    connectButton.textContent = "Connect";
    connectButton.disabled = false;
  };
  signalingServer.onerror = (error) => {
    statusElement.textContent = `Error: ${error.message}`;
  };
}

function updateClientList(clients) {
  clientListElement.innerHTML = "";
  clients.forEach((client) => {
    if (client !== clientId) {
      const clientItem = document.createElement("li");
      clientItem.textContent = client;
      clientItem.addEventListener("click", () => {
        targetClientId = client;
        // Update all list items to remove 'selected' class
        clientListElement.querySelectorAll('li').forEach(item => item.classList.remove('selected'));
        // Add 'selected' class to the clicked item
        clientItem.classList.add('selected');
        statusElement.textContent = `Selected client: ${client}`;
        console.log(`Selected client: ${client}`);
      });
      if (client === targetClientId) {
        clientItem.classList.add('selected');
      }
      clientListElement.appendChild(clientItem);
    }
  });
}

function createConnection() {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];

  if (!file) {
    statusElement.textContent = "Please select a file.";
    console.log("No file selected.");
    return;
  }

  if (!targetClientId) {
    statusElement.textContent = "Please select a client.";
    console.log("No client selected.");
    return;
  }

  fileSize = file.size;
  console.log(`File size: ${fileSize}`);

  localConnection = new RTCPeerConnection();
  sendChannel = localConnection.createDataChannel("sendDataChannel");

  // Set the bufferedAmountLowThreshold
  sendChannel.bufferedAmountLowThreshold = 65535; // Adjust this value if needed

  sendChannel.onopen = () => {
    statusElement.textContent = "Connection opened, sending file...";
    webrtcStatusElement.textContent = "WebRTC Status: Data channel open"; // Update WebRTC status
    console.log("Data channel opened.");
    sendChannel.send(JSON.stringify({ type: "fileSize", size: fileSize })); // Send file size first
    sendFile(file);
  };

  sendChannel.onclose = () => {
    statusElement.textContent = "Connection closed.";
    webrtcStatusElement.textContent = "WebRTC Status: Data channel closed"; // Update WebRTC status
    console.log("Data channel closed.");
  };

  sendChannel.onerror = (error) => {
    console.error("Data channel error:", error);
  };

  localConnection.onicecandidate = (e) => {
    if (e.candidate) {
      console.log("Sending ICE candidate.");
      sendToRemotePeer({
        type: "candidate",
        candidate: e.candidate,
        target: targetClientId,
      });
    }
  };

  localConnection.onconnectionstatechange = () => {
    console.log("Local connection state:", localConnection.connectionState);
    webrtcStatusElement.textContent = `WebRTC Status: ${localConnection.connectionState}`;
  };

  localConnection
    .createOffer()
    .then((offer) => {
      localConnection.setLocalDescription(offer);
      console.log("Sending offer.");
      sendToRemotePeer({ 
        type: "offer", 
        offer, 
        target: targetClientId,
        fileInfo: { name: file.name, size: file.size, type: file.type } // Add file type
      });
    })
    .catch((error) => {
      console.error("Error creating offer:", error);
    });
}

function receiveConnection() {
  if (!pendingFileTransfer) {
    statusElement.textContent = "No pending file transfer.";
    return;
  }

  remoteConnection
    .createAnswer()
    .then((answer) => {
      remoteConnection.setLocalDescription(answer);
      console.log("Sending answer.");
      sendToLocalPeer({ type: "answer", answer, target: targetClientId });
    })
    .catch((error) => {
      console.error("Error creating answer:", error);
    });

  pendingFileTransfer = false;
  receiveButton.disabled = true;
}

function sendFile(file) {
  const chunkSize = 16384; // Adjust this value if needed
  let offset = 0;
  let fileReader = new FileReader();
  let sendProgress = 0;

  fileReader.onerror = (error) => console.error("Error reading file:", error);
  fileReader.onabort = (event) => console.log("File reading aborted:", event);
  fileReader.onload = (e) => {
    sendChunk(e.target.result);
  };

  function sendChunk(chunk) {
    try {
      sendChannel.send(chunk);
      offset += chunk.byteLength;
      sendProgress = Math.round((offset / file.size) * 100);
      statusElement.textContent = `Sending file... ${sendProgress}%`;

      if (offset < file.size) {
        readNextChunk();
      } else {
        statusElement.textContent = "File sent successfully.";
        console.log("File sent successfully.");
      }
    } catch (error) {
      if (
        error.name === "OperationError" &&
        sendChannel.bufferedAmount > sendChannel.bufferedAmountLowThreshold
      ) {
        // The send queue is full, so wait for it to drain
        sendChannel.onbufferedamountlow = () => {
          sendChannel.onbufferedamountlow = null;
          sendChunk(chunk); // Try to send the chunk again
        };
      } else {
        console.error("Error sending chunk:", error);
      }
    }
  }

  function readNextChunk() {
    const slice = file.slice(offset, offset + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  }

  // Start sending the file
  readNextChunk();
}

let incomingFileInfo = null;

function onReceiveMessageCallback(event) {
  const data = event.data;
  if (typeof data === "string") {
    try {
      const message = JSON.parse(data);
      if (message.type === "fileSize") {
        fileSize = message.size;
        console.log(`File size received: ${fileSize}`);
        return;
      }
    } catch (e) {
      console.error("Error parsing JSON:", e);
    }
  }

  receiveBuffer.push(data);
  receivedSize += data.byteLength;

  // Calculate and display the percentage of the file received
  const percentage = Math.round((receivedSize / fileSize) * 100);
  statusElement.textContent = `Receiving file... ${percentage}%`;

  if (receivedSize === fileSize) {
    const received = new Blob(receiveBuffer, { type: incomingFileInfo.type });
    receiveBuffer = [];

    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(received);
    downloadLink.download = incomingFileInfo.name;
    downloadLink.textContent = `Download ${incomingFileInfo.name}`;
    statusElement.textContent = "File received successfully. ";
    statusElement.appendChild(downloadLink);
    console.log("File received successfully.");

    // Reset incomingFileInfo
    incomingFileInfo = null;
  }
}

function sendToRemotePeer(data) {
  signalingServer.send(JSON.stringify({ ...data, from: clientId }));
  console.log("Sent to remote peer:", data);
}

function sendToLocalPeer(data) {
  signalingServer.send(JSON.stringify({ ...data, from: clientId }));
  console.log("Sent to local peer:", data);
}

function receiveOfferFromLocalPeer() {
  return new Promise((resolve) => {
    signalingServer.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "offer") {
        console.log("Received offer:", data.offer);
        resolve(data.offer);
      } else if (data.type === "candidate") {
        console.log("Received ICE candidate:", data.candidate);
        remoteConnection
          .addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch((error) => {
            console.error("Error adding received ICE candidate:", error);
          });
      }
    };
  });
}

function handleSignalingData(data) {
  if (data.type === "offer") {
    console.log("Handling offer:", data.offer);
    
    // Check if the sender is the selected target client
    if (data.from !== targetClientId) {
      console.log("Offer received from non-selected client. Ignoring.");
      return;
    }

    if (!remoteConnection) {
      console.log("Initializing remote connection");
      remoteConnection = new RTCPeerConnection();
      remoteConnection.onicecandidate = (e) => {
        if (e.candidate) {
          console.log("Sending ICE candidate.");
          sendToLocalPeer({
            type: "candidate",
            candidate: e.candidate,
            target: targetClientId,
          });
        }
      };
      remoteConnection.ondatachannel = (e) => {
        receiveChannel = e.channel;
        receiveChannel.onmessage = onReceiveMessageCallback;
        receiveChannel.onopen = () => {
          statusElement.textContent = "Receiving file...";
          webrtcStatusElement.textContent = "WebRTC Status: Data channel open"; // Update WebRTC status
          console.log("Data channel opened.");
        };
        receiveChannel.onclose = () => {
          statusElement.textContent = "Connection closed.";
          webrtcStatusElement.textContent =
            "WebRTC Status: Data channel closed"; // Update WebRTC status
          console.log("Data channel closed.");
        };

        receiveChannel.onerror = (error) => {
          console.error("Data channel error:", error);
        };
      };
      remoteConnection.onconnectionstatechange = () => {
        console.log(
          "Remote connection state:",
          remoteConnection.connectionState
        );
        webrtcStatusElement.textContent = `WebRTC Status: ${remoteConnection.connectionState}`;
      };
    }
    remoteConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );
    
    incomingFileInfo = data.fileInfo;
    statusElement.textContent = `Incoming file from ${data.from}: ${incomingFileInfo.name} (${formatFileSize(incomingFileInfo.size)})`;
    receiveButton.disabled = false;
    pendingFileTransfer = true;

    // Don't create answer immediately, wait for user to click receive button
  } else if (data.type === "answer") {
    console.log("Handling answer:", data.answer);
    localConnection.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
  } else if (data.type === "candidate") {
    const candidate = new RTCIceCandidate(data.candidate);
    console.log("Handling ICE candidate:", candidate);
    if (localConnection) {
      localConnection.addIceCandidate(candidate).catch((error) => {
        console.error("Error adding ICE candidate to local connection:", error);
      });
    } else if (remoteConnection) {
      remoteConnection.addIceCandidate(candidate).catch((error) => {
        console.error(
          "Error adding ICE candidate to remote connection:",
          error
        );
      });
    }
  }
}

// Add a helper function to format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " bytes";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + " MB";
  else return (bytes / 1073741824).toFixed(2) + " GB";
}

// Modify the initial setup
document.addEventListener("DOMContentLoaded", () => {
  receiveButton.disabled = true;
});
