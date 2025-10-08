# RTFT (Real-Time File Transfer)

RTFT is a WebRTC-based real-time file transfer application that enables peer-to-peer file sharing directly between browsers without the need for a centralized server to handle file data. The application uses WebSocket signaling to establish WebRTC connections between clients, allowing for secure and efficient file transfers.

## Purpose

The primary purpose of RTFT is to provide a simple, secure, and efficient way to transfer files between users in real-time using modern web technologies. By leveraging WebRTC's peer-to-peer capabilities, RTFT ensures that files are transferred directly between clients, maintaining privacy and reducing server bandwidth requirements.

## Key Features

- **Peer-to-Peer File Transfer**: Direct file transfer between browsers using WebRTC data channels
- **Real-Time Communication**: Instant connection establishment and file transfer initiation
- **WebSocket Signaling Server**: Lightweight signaling server for WebRTC connection setup
- **Client Management**: Automatic tracking and broadcasting of connected clients
- **Secure Transfers**: Files are transferred directly between peers without server storage
- **No File Size Limits**: Transfer files of any size through chunking mechanisms
- **Simple Interface**: Easy-to-use web interface for selecting and transferring files

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager

### Setup

1. Clone the repository:
```bash
git clone https://github.com/rohitsainier/RTFT.git
cd RTFT
```

2. Install dependencies:
```bash
npm install
```

3. Start the signaling server:
```bash
node server.js
```

The signaling server will start running on `ws://localhost:8080`.

## Usage

### Starting the Application

1. Start the signaling server as described in the installation section
2. Open the application in multiple browser windows or different devices
3. Each client will automatically connect to the signaling server and receive a unique client ID
4. The list of available clients will be displayed in the interface

### Transferring Files

1. Select the target client you want to send files to from the client list
2. Choose the file you want to transfer using the file picker
3. Initiate the transfer - the WebRTC connection will be established automatically
4. Monitor the transfer progress in real-time
5. The recipient will receive the file directly in their browser

## How It Works

### Signaling Server

The signaling server manages WebRTC connection establishment:

- **Client Connection**: When a client connects, the server generates a unique client ID and sends it to the client
- **Broadcast Client List**: The server maintains a list of all connected clients and broadcasts this list whenever clients connect or disconnect
- **Handle Signaling Data**: The server forwards WebRTC signaling messages (offer, answer, ICE candidates) between clients to establish peer connections

### WebRTC Data Channels

Once the WebRTC connection is established:

- Files are split into chunks for efficient transfer
- Data is transmitted through WebRTC data channels
- Transfer progress is tracked and displayed to both sender and receiver
- Files are reassembled on the receiving end

## Configuration

You can modify the following settings in the configuration:

- **Server Port**: Change the WebSocket server port in `server.js`
- **Chunk Size**: Adjust the file chunk size for optimal performance
- **STUN/TURN Servers**: Configure ICE servers for NAT traversal if needed

## Technologies Used

- **WebRTC**: For peer-to-peer data transfer
- **WebSocket**: For signaling and client management
- **Node.js**: Server runtime environment
- **JavaScript**: Client and server-side logic

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or suggestions, please open an issue on the GitHub repository.
