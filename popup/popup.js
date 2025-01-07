let username;
let fileChunks = [];
let fileSize = 0;
let fileName = "";

// Connect to the WebSocket server
const ws = new WebSocket("https://wild-curse-watchmaker.glitch.me/");

ws.onopen = () => {
  console.log("Connected to WebSocket server");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "USERNAME_SET") {
    username = message.username;
    console.log("Assigned username:", username);
    document.getElementById("status").innerText = `Username: ${username}`;
  } else if (message.type === "FILE_CHUNK") {
    // Show progress bar when the first chunk is received
    if (fileSize === 0) {
      document.getElementById("progress-container").style.display = "block";
    }

    // Handle incoming file chunks
    fileChunks.push(new Uint8Array(message.file.data));
    fileSize += message.file.data.length;

    // Update progress bar
    const progress = Math.round((fileSize / message.file.size) * 100);
    document.getElementById("progress-bar").value = progress;
    document.getElementById("progress-text").innerText = `${progress}%`;

    if (fileSize === message.file.size) {
      // Reassemble the file
      const fileData = new Uint8Array(fileSize);
      let offset = 0;
      for (const chunk of fileChunks) {
        fileData.set(chunk, offset);
        offset += chunk.length;
      }

      // Create a Blob and download the file
      const blob = new Blob([fileData], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);

      // Show the download button
      const downloadButton = document.createElement("button");
      downloadButton.innerText = "Download File";
      downloadButton.onclick = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = message.file.name;
        a.click();
        URL.revokeObjectURL(url);

        // Reset for the next file
        fileChunks = [];
        fileSize = 0;
        fileName = "";

        // Hide progress bar and download button
        document.getElementById("progress-container").style.display = "none";
        document.getElementById("button-container").innerHTML = "";
        document.getElementById(
          "status"
        ).innerText = `File downloaded: ${message.file.name}`;
      };

      // Append the button to the container
      const buttonContainer = document.getElementById("button-container");
      buttonContainer.innerHTML = ""; // Clear previous buttons
      buttonContainer.appendChild(downloadButton);

      // Re-enable the send button
      document.getElementById("send-file").disabled = false;
    }
  } else if (message.type === "ERROR") {
    console.error("Error:", message.message);
    document.getElementById("status").innerText = `Error: ${message.message}`;

    // Re-enable the send button in case of an error
    document.getElementById("send-file").disabled = false;
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("WebSocket connection closed");
};

// Send file in chunks
document.getElementById("send-file").addEventListener("click", () => {
  const fileInput = document.getElementById("file-input");
  const recipient = document.getElementById("recipient-username").value;
  if (fileInput.files.length > 0 && recipient) {
    // Disable the send button
    document.getElementById("send-file").disabled = true;

    const file = fileInput.files[0];
    sendFileInChunks(file, recipient);
  }
});

function sendFileInChunks(file, recipient) {
  const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
  const reader = new FileReader();
  let offset = 0;

  reader.onload = () => {
    const chunk = new Uint8Array(reader.result);
    ws.send(
      JSON.stringify({
        type: "FILE_CHUNK",
        recipient,
        file: {
          name: file.name,
          size: file.size,
          offset,
          data: Array.from(chunk),
        },
      })
    );

    offset += chunk.length;
    if (offset < file.size) {
      readNextChunk();
    } else {
      console.log("File sent successfully");
      document.getElementById("status").innerText = `File sent to ${recipient}`;

      // Re-enable the send button
      document.getElementById("send-file").disabled = false;
    }
  };

  function readNextChunk() {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.readAsArrayBuffer(slice);
  }

  readNextChunk();
}
