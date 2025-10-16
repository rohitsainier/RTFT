// background.js - Service Worker for persistent state management
let connectedUsers = new Set();
let currentUsername = null;
let ws = null;
let reconnectInterval = null;

// Initialize on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  // Load saved username from storage
  chrome.storage.local.get(['username'], (result) => {
    if (result.username) {
      currentUsername = result.username;
      connectToServer();
    }
  });
});

// Start connection when browser starts
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['username'], (result) => {
    if (result.username) {
      currentUsername = result.username;
      connectToServer();
    }
  });
});

// Connect to WebSocket server
function connectToServer() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return; // Already connected
  }

  try {
    ws = new WebSocket("ws://localhost:8080");

    ws.onopen = () => {
      console.log("Connected to server from background");
      clearInterval(reconnectInterval);

      // If we have a saved username, set it immediately
      if (currentUsername) {
        ws.send(JSON.stringify({
          type: "SET_USERNAME",
          username: currentUsername
        }));
      }

      // Notify popup if it's open
      chrome.runtime.sendMessage({
        type: "CONNECTION_STATUS",
        connected: true,
        username: currentUsername
      }).catch(() => {
        // Popup might not be open, ignore error
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

      // Notify popup if it's open
      chrome.runtime.sendMessage({
        type: "CONNECTION_STATUS",
        connected: false
      }).catch(() => {
        // Popup might not be open, ignore error
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
function handleServerMessage(data) {
  try {
    const message = JSON.parse(data);

    switch (message.type) {
      case "USERNAME_SET":
        currentUsername = message.username;
        // Save to storage
        chrome.storage.local.set({
          username: currentUsername,
          usernameSetAt: Date.now()
        });

        // Forward to popup
        chrome.runtime.sendMessage({
          type: "USERNAME_CONFIRMED",
          username: currentUsername,
          availableUsers: message.availableUsers
        }).catch(() => { });
        break;

      case "USERNAME_ERROR":
        // Clear saved username if it's invalid
        chrome.storage.local.remove('username');
        currentUsername = null;

        // Forward to popup
        chrome.runtime.sendMessage({
          type: "USERNAME_ERROR",
          message: message.message
        }).catch(() => { });
        break;

      case "USER_LIST":
        connectedUsers = new Set(message.users);
        // Forward to popup
        chrome.runtime.sendMessage({
          type: "USER_LIST",
          users: message.users
        }).catch(() => { });
        break;

      default:
        // Forward all other messages to popup
        chrome.runtime.sendMessage({
          type: "SERVER_MESSAGE",
          data: message
        }).catch(() => { });
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "GET_STATE":
      // Send current state to popup
      chrome.storage.local.get(['username'], (result) => {
        sendResponse({
          connected: ws && ws.readyState === WebSocket.OPEN,
          username: result.username || currentUsername,
          users: Array.from(connectedUsers)
        });
      });
      return true; // Keep channel open for async response

    case "SET_USERNAME":
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "SET_USERNAME",
          username: request.username
        }));
        sendResponse({ success: true });
      } else {
        // Try to connect first
        currentUsername = request.username;
        connectToServer();
        sendResponse({ success: false, message: "Connecting to server..." });
      }
      return true;

    case "SEND_MESSAGE":
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(request.data));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, message: "Not connected to server" });
      }
      return true;

    case "CONNECT":
      connectToServer();
      sendResponse({ success: true });
      return true;

    default:
      sendResponse({ success: false, message: "Unknown request type" });
  }
});

// Keep service worker alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Send a ping to keep connection alive
    ws.send(JSON.stringify({ type: "PING" }));
  }
}, 30000);