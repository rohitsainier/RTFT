let username;
let fileChunks = [];
let fileSize = 0;
let fileName = "";

// Connect to the WebSocket server
const ws = new WebSocket("ws://localhost:8080");

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

    // Reassemble the file if all chunks are received
    if (fileSize === message.file.size) {
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
    }
  } else if (message.type === "PROGRESS_UPDATE") {
    // Update progress bar
    document.getElementById("progress-bar").value = message.progress;
    document.getElementById("progress-text").innerText = `${message.progress}%`;
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

    // Show progress bar
    document.getElementById("progress-container").style.display = "block";

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
    const progress = Math.round((offset / file.size) * 100);

    // Send the file chunk
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

    // Send progress update with size information
    ws.send(
      JSON.stringify({
        type: "PROGRESS_UPDATE",
        recipient,
        progress,
        transferred: offset + chunk.length,
        total: file.size,
      })
    );

    // Update sender's progress bar
    document.getElementById("progress-bar").value = progress;
    document.getElementById(
      "progress-text"
    ).innerText = `${progress}% (${formatBytes(
      offset + chunk.length
    )} / ${formatBytes(file.size)})`;

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

// Helper function to format bytes into human-readable format
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
  );
}
