let peerConnection;
let dataChannel;
let username;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_USERNAME") {
    username = message.username;
    connectToSignalingServer();
  } else if (message.type === "SEND_FILE") {
    const file = message.file;
    const recipient = message.recipient;
    startWebRTC(file, recipient);
  }
});

function connectToSignalingServer() {
  const ws = new WebSocket("https://wild-curse-watchmaker.glitch.me/");
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "SET_USERNAME", username: username }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleSignal(message);
  };
}

function startWebRTC(file, recipient) {
  const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };
  peerConnection = new RTCPeerConnection(configuration);

  dataChannel = peerConnection.createDataChannel("fileTransfer");
  dataChannel.onopen = () => {
    sendFile(file);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: "ICE_CANDIDATE",
        candidate: event.candidate,
        recipient: recipient,
      });
    }
  };

  peerConnection
    .createOffer()
    .then((offer) => peerConnection.setLocalDescription(offer))
    .then(() => {
      sendSignal({
        type: "OFFER",
        offer: peerConnection.localDescription,
        recipient: recipient,
      });
    });
}

function sendFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const buffer = reader.result;
    dataChannel.send(buffer);
    updateStatus("File sent");
  };
  reader.readAsArrayBuffer(file);
}

function sendSignal(message) {
  const ws = new WebSocket("https://wild-curse-watchmaker.glitch.me/");
  ws.onopen = () => {
    ws.send(JSON.stringify({ ...message, sender: username }));
  };
}

function handleSignal(message) {
  if (message.type === "OFFER") {
    peerConnection
      .setRemoteDescription(new RTCSessionDescription(message.offer))
      .then(() => peerConnection.createAnswer())
      .then((answer) => peerConnection.setLocalDescription(answer))
      .then(() => {
        sendSignal({
          type: "ANSWER",
          answer: peerConnection.localDescription,
          recipient: message.sender,
        });
      });
  } else if (message.type === "ANSWER") {
    peerConnection.setRemoteDescription(
      new RTCSessionDescription(message.answer)
    );
  } else if (message.type === "ICE_CANDIDATE") {
    peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

function updateStatus(status) {
  chrome.runtime.sendMessage({ type: "STATUS_UPDATE", status: status });
}
