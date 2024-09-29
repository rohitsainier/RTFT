// Initialize WebRTC connection variables
let localConnection; // Represents the local peer connection
let remoteConnection; // Represents the remote peer connection
let sendChannel; // Data channel for sending data
let receiveChannel; // Data channel for receiving data
let fileReader; // FileReader object to read file data
let receiveBuffer = []; // Buffer to store received file chunks
let receivedSize = 0; // Size of received data so far
let fileSize = 0; // Total size of the file being transferred
let clientId; // Unique identifier for this client
let targetClientId; // Identifier of the client we're connecting to
let signalingServer; // WebSocket connection to the signaling server

// Get references to HTML elements
const clientInfoElement = document.getElementById("clientInfo");
const clientIdElement = document.getElementById("clientId");
const connectionStatusElement = document.getElementById("connectionStatus");

// Add event listeners to buttons
document
  .getElementById("connectButton")
  .addEventListener("click", connectToServer);
document
  .getElementById("sendButton")
  .addEventListener("click", createConnection);
document
  .getElementById("receiveButton")
  .addEventListener("click", receiveConnection);

// Get references to more HTML elements
const clientListElement = document.getElementById("clientList");
const statusElement = document.getElementById("status");
const webrtcStatusElement = document.getElementById("webrtcStatus");
const connectButton = document.getElementById("connectButton");

// Flag to track if there's a pending file transfer
let pendingFileTransfer = false;
const receiveButton = document.getElementById("receiveButton");

// Function to connect to the signaling server
function connectToServer() {
  // Check if already connected
  if (signalingServer && signalingServer.readyState === WebSocket.OPEN) {
    connectionStatusElement.textContent = "Already connected.";
    return;
  }

  // Create a new WebSocket connection
  signalingServer = new WebSocket("https://glimmer-political-koi.glitch.me");

  // Handle successful connection
  signalingServer.onopen = () => {
    connectionStatusElement.textContent = "Connected to signaling server.";
    connectButton.textContent = "Connected";
    connectButton.disabled = true;
  };

  // Handle incoming messages from the server
  signalingServer.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "clientId") {
      // Set client ID and update UI
      clientId = data.id;
      clientIdElement.textContent = clientId;
      clientInfoElement.style.display = "block";
      document.getElementById("fileInput").disabled = false;
      document.getElementById("sendButton").disabled = false;
      document.getElementById("receiveButton").disabled = false;
    } else if (data.type === "clientList") {
      // Update the list of connected clients
      updateClientList(data.clients);
    } else if (
      data.type === "offer" ||
      data.type === "answer" ||
      data.type === "candidate"
    ) {
      // Handle WebRTC signaling data
      handleSignalingData(data);
    }
  };

  // Handle disconnection
  signalingServer.onclose = () => {
    connectionStatusElement.textContent = "Disconnected from signaling server.";
    connectButton.textContent = "Connect";
    connectButton.disabled = false;
    clientInfoElement.style.display = "none";
  };

  // Handle connection errors
  signalingServer.onerror = (error) => {
    connectionStatusElement.textContent = `Error: ${error.message}`;
  };
}

// Function to update the list of connected clients
function updateClientList(clients) {
  clientListElement.innerHTML = "";
  clients.forEach((client) => {
    if (client !== clientId) {
      const clientItem = document.createElement("li");
      clientItem.textContent = client;
      clientItem.addEventListener("click", () => {
        targetClientId = client;
        clientListElement
          .querySelectorAll("li")
          .forEach((item) => item.classList.remove("selected"));
        clientItem.classList.add("selected");
        statusElement.textContent = `Selected client: ${client}`;
        console.log(`Selected client: ${client}`);
      });
      if (client === targetClientId) {
        clientItem.classList.add("selected");
      }
      clientListElement.appendChild(clientItem);
    }
  });
}

// Function to create a WebRTC connection for sending a file
function createConnection() {
  // Close existing connections if they exist
  if (localConnection) {
    localConnection.close();
  }
  if (remoteConnection) {
    remoteConnection.close();
  }

  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];

  // Check if a file is selected
  if (!file) {
    statusElement.textContent = "Please select a file.";
    console.log("No file selected.");
    return;
  }

  // Check if a target client is selected
  if (!targetClientId) {
    statusElement.textContent = "Please select a client.";
    console.log("No client selected.");
    return;
  }

  fileSize = file.size;
  console.log(`File size: ${fileSize}`);
  // Create a new RTCPeerConnection
  localConnection = new RTCPeerConnection();
  sendChannel = localConnection.createDataChannel("sendDataChannel");

  sendChannel.bufferedAmountLowThreshold = 65535;

  // Handle data channel opening
  sendChannel.onopen = () => {
    statusElement.textContent = "Connection opened, sending file...";
    webrtcStatusElement.textContent = "WebRTC Status: Data channel open";
    console.log("Data channel opened.");
    sendChannel.send(JSON.stringify({ type: "fileSize", size: fileSize }));
    sendFile(file);
  };

  // Handle data channel closing
  sendChannel.onclose = () => {
    statusElement.textContent = "Connection closed.";
    webrtcStatusElement.textContent = "WebRTC Status: Data channel closed";
    console.log("Data channel closed.");
  };

  // Handle data channel errors
  sendChannel.onerror = (error) => {
    console.error("Data channel error:", error);
  };

  // Handle ICE candidates
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

  // Handle connection state changes
  localConnection.onconnectionstatechange = () => {
    console.log("Local connection state:", localConnection.connectionState);
    webrtcStatusElement.textContent = `WebRTC Status: ${localConnection.connectionState}`;
    
    // Reset connections if closed
    if (localConnection.connectionState === "closed") {
      localConnection = null;
      remoteConnection = null; // Reset remote connection as well
    }
  };

  // Create and send offer
  localConnection
    .createOffer()
    .then((offer) => {
      localConnection.setLocalDescription(offer);
      console.log("Sending offer.");
      sendToRemotePeer({
        type: "offer",
        offer,
        target: targetClientId,
        fileInfo: { name: file.name, size: file.size, type: file.type },
      });
    })
    .catch((error) => {
      console.error("Error creating offer:", error);
    });
}

// Function to receive a WebRTC connection
function receiveConnection() {
  if (targetClientId == null) {
    statusElement.textContent = "No client id selected yet";
    return;
  }

  if (!pendingFileTransfer) {
    statusElement.textContent = "No pending file transfer.";
    return;
  }

  // Create and send answer
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

// Function to send a file
function sendFile(file) {
  const chunkSize = 16384;
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
        sendChannel.onbufferedamountlow = () => {
          sendChannel.onbufferedamountlow = null;
          sendChunk(chunk);
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

  readNextChunk();
}

// Variable to store information about the incoming file
let incomingFileInfo = null;

// Function to handle received messages
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

  const percentage = Math.min(Math.round((receivedSize / fileSize) * 100), 100); // Ensure percentage does not exceed 100
  statusElement.textContent = `Receiving file... ${percentage}%`;

  if (receivedSize >= fileSize) { // Use >= to handle edge cases
    const received = new Blob(receiveBuffer, { type: incomingFileInfo.type });
    receiveBuffer = [];
    receivedSize = 0; // Reset receivedSize after file is processed
    fileSize = 0; // Reset fileSize after file is processed

    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(received);
    downloadLink.download = incomingFileInfo.name;
    downloadLink.textContent = `Download ${incomingFileInfo.name}`;
    statusElement.textContent = "File received successfully. ";
    statusElement.appendChild(downloadLink);
    console.log("File received successfully.");

    incomingFileInfo = null;
    remoteConnection;
  }
}

// Function to send data to the remote peer
function sendToRemotePeer(data) {
  signalingServer.send(JSON.stringify({ ...data, from: clientId }));
  console.log("Sent to remote peer:", data);
}

// Function to send data to the local peer
function sendToLocalPeer(data) {
  signalingServer.send(JSON.stringify({ ...data, from: clientId }));
  console.log("Sent to local peer:", data);
}

// Function to receive an offer from the local peer
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

// Function to handle signaling data
function handleSignalingData(data) {
  if (data.type === "offer") {
    console.log("Handling offer:", data.offer);

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
          webrtcStatusElement.textContent = "WebRTC Status: Data channel open";
          console.log("Data channel opened.");
        };
        receiveChannel.onclose = () => {
          statusElement.textContent = "Connection closed.";
          webrtcStatusElement.textContent =
            "WebRTC Status: Data channel closed";
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
    statusElement.textContent = `Incoming file from ${data.from}: ${
      incomingFileInfo.name
    } (${formatFileSize(incomingFileInfo.size)})`;
    receiveButton.disabled = false;
    pendingFileTransfer = true;
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

// Function to format file size in a human-readable format
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " bytes";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + " MB";
  else return (bytes / 1073741824).toFixed(2) + " GB";
}

// Add an event listener that runs when the DOM content is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  // Disable the receive button by default
  receiveButton.disabled = true;
});