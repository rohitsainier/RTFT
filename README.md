# RTFT

Here’s how you can structure your `README.md` file to include the provided WebSocket server code. This README will provide an overview, installation steps, and usage instructions for setting up the signaling server for WebRTC.

```markdown
# WebRTC Signaling Server with WebSocket

This project is a simple WebRTC signaling server implemented using WebSocket. It allows multiple clients to connect, exchange signaling data (like offers, answers, and ICE candidates), and establish peer-to-peer connections for media or data sharing.

## Features

- Assigns a unique ID to each connected client.
- Broadcasts the list of connected clients to all clients.
- Relays signaling data (offers, answers, ICE candidates) between clients.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) installed on your machine.

### Steps

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/your-repo/webrtc-signaling-server.git
   cd webrtc-signaling-server
   ```

2. **Install Dependencies**:

   This project uses the WebSocket library. Install it using npm:

   ```bash
   npm install ws
   ```

3. **Run the Server**:

   Start the WebSocket signaling server:

   ```bash
   node server.js
   ```

   The server will start and listen on `ws://localhost:8080`.

## Usage

1. **Connect Clients**:

   Clients should connect to the WebSocket server at `ws://localhost:8080` and will receive a unique client ID. The list of connected clients will be broadcast to all clients.

2. **Exchange Signaling Data**:

   Clients can send WebRTC signaling data (like offers, answers, and ICE candidates) to the server, which will then relay the data to the target client.

## Code Explanation

Below is the complete code for the WebSocket signaling server.

```javascript
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

let clients = [];

wss.on("connection", (ws) => {
  const clientId = generateClientId();
  clients.push({ id: clientId, ws });

  // Send the client ID to the newly connected client
  ws.send(JSON.stringify({ type: "clientId", id: clientId }));

  // Broadcast the updated list of clients to all clients
  broadcastClientList();

  ws.on("message", (message) => {
    const data = JSON.parse(message);
    console.log("Received:", data);

    // Handle signaling data
    if (
      data.type === "offer" ||
      data.type === "answer" ||
      data.type === "candidate"
    ) {
      console.log("Data Type:", data.type);
      const targetClient = clients.find((client) => client.id === data.target);
      if (targetClient) {
        console.log("Sending:", data);
        targetClient.ws.send(JSON.stringify(data));
      }
    }
  });

  ws.on("close", () => {
    clients = clients.filter((client) => client.ws !== ws);
    broadcastClientList();
  });
});

function generateClientId() {
  return Math.random().toString(36).substr(2, 9);
}

function broadcastClientList() {
  const clientList = clients.map((client) => client.id);
  clients.forEach((client) => {
    client.ws.send(JSON.stringify({ type: "clientList", clients: clientList }));
  });
}

console.log("Signaling server is running on ws://localhost:8080");
```

## How It Works

- **Client Connection**: When a client connects, the server generates a unique client ID and sends it to the client.
- **Broadcast Client List**: The server maintains a list of all connected clients and broadcasts this list to all clients whenever a new client connects or disconnects.
- **Handle Signaling Data**: The server listens for signaling data (offer, answer, ICE candidates) from one client and forwards it to the target client.

## License

This project is licensed under the MIT License.
```

You can modify the URLs and other details to match your project specifics. This `README.md` should give users clear instructions on how to set up and use your WebRTC signaling server with WebSocket.
