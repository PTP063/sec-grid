import { PeerServer } from 'peer';

// This acts as the local "Drop Node" to bootstrap the WebRTC mesh
// when the global internet is down. First responders drop a Raspberry Pi
// running this script and a Wi-Fi hotspot.
const PORT = 9000;

const peerServer = PeerServer({ port: PORT, path: '/mesh', allow_discovery: true });

peerServer.on('connection', (client) => {
  console.log(`[DROP_NODE] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`[DROP_NODE] Peer disconnected: ${client.getId()}`);
});

console.log(`[DROP_NODE] Local WebRTC Signaling Bridge active on port ${PORT}...`);
console.log(`Point your Mesh·OS Tactical UI to localhost:${PORT}`);
