const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');

// Create an HTTPS server. In a production environment like Render, SSL is automatically handled,
// so you don't need to provide certificates yourself.
const server = https.createServer();

// Create a WebSocket server that attaches to the HTTPS server
const wss = new WebSocket.Server({ server });

let clients = [];

// Handle WebSocket connections
wss.on('connection', (ws) => {
  clients.push(ws);

  // Handle disconnections
  ws.on('close', () => {
    clients = clients.filter(client => client !== ws);
  });

  // Handle incoming messages
  ws.on('message', (message) => {
    console.log(`Received message => ${message}`);
  });
});

// Broadcast data to all connected clients
function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Start the server on the default HTTPS port (443)
server.listen(443, () => {
  console.log('WebSocket server listening on wss://your-app.onrender.com');
});

// Export the broadcast function to use in other parts of your app
module.exports = { broadcast };
