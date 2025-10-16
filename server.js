const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

// Create a WebSocket server
const wss = new WebSocket.Server({ port: 8080 });

// Track connected users
const users = {};
const userConnections = {};

// Log when the server starts
wss.on("listening", () => {
    console.log("Signaling server running on ws://localhost:8080");
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
    let username = null;
    let tempId = `temp_${uuidv4().slice(0, 8)}`;

    console.log(`New client connected with temp ID: ${tempId}`);

    // Handle incoming messages
    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Handle username selection
            if (data.type === "SET_USERNAME") {
                const requestedUsername = data.username.trim();

                // Check if username is already taken
                if (users[requestedUsername]) {
                    ws.send(JSON.stringify({
                        type: "USERNAME_ERROR",
                        message: "Username already taken"
                    }));
                } else {
                    // Remove old username if exists
                    if (username && users[username]) {
                        delete users[username];
                    }

                    username = requestedUsername;
                    users[username] = ws;
                    userConnections[username] = { ws, peerId: null };

                    ws.send(JSON.stringify({
                        type: "USERNAME_SET",
                        username,
                        availableUsers: Object.keys(users).filter(u => u !== username)
                    }));

                    // Notify all other users about new user
                    broadcastUserList();

                    console.log(`User registered: ${username}`);
                }
            }

            // WebRTC Signaling
            else if (data.type === "WEBRTC_OFFER") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "WEBRTC_OFFER",
                        offer: data.offer,
                        sender: username
                    }));
                    console.log(`WebRTC offer sent from ${username} to ${data.recipient}`);
                }
            }

            else if (data.type === "WEBRTC_ANSWER") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "WEBRTC_ANSWER",
                        answer: data.answer,
                        sender: username
                    }));
                    console.log(`WebRTC answer sent from ${username} to ${data.recipient}`);
                }
            }

            else if (data.type === "WEBRTC_ICE_CANDIDATE") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "WEBRTC_ICE_CANDIDATE",
                        candidate: data.candidate,
                        sender: username
                    }));
                }
            }

            // WebSocket file transfer
            else if (data.type === "FILE_METADATA") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "FILE_METADATA",
                        sender: username,
                        file: data.file,
                        transferMode: data.transferMode || "websocket"
                    }));
                    console.log(`File metadata sent from ${username} to ${data.recipient}`);
                }
            }

            else if (data.type === "FILE_CHUNK") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "FILE_CHUNK",
                        sender: username,
                        file: data.file
                    }));
                }
            }

            else if (data.type === "FILE_COMPLETE") {
                const recipient = users[data.recipient];
                if (recipient) {
                    recipient.send(JSON.stringify({
                        type: "FILE_COMPLETE",
                        sender: username,
                        fileName: data.fileName
                    }));
                }
            }

            else if (data.type === "GET_USERS") {
                ws.send(JSON.stringify({
                    type: "USER_LIST",
                    users: Object.keys(users).filter(u => u !== username)
                }));
            }

        } catch (error) {
            console.error("Error processing message:", error);
            ws.send(JSON.stringify({
                type: "ERROR",
                message: "Invalid message format"
            }));
        }
    });

    // Handle client disconnection
    ws.on("close", () => {
        if (username) {
            console.log(`Client ${username} disconnected`);
            delete users[username];
            delete userConnections[username];
            broadcastUserList();
        }
    });

    // Handle errors
    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
});

// Broadcast updated user list to all connected clients
function broadcastUserList() {
    const userList = Object.keys(users);
    for (const [username, ws] of Object.entries(users)) {
        ws.send(JSON.stringify({
            type: "USER_LIST",
            users: userList.filter(u => u !== username)
        }));
    }
}