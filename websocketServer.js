const WebSocket = require('ws');

let wss;

const initWebSocketNotifServer = (server) => {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
      console.log('Received:', message);
    });

    // Send a welcome message to the new connection
    ws.send(JSON.stringify({ message: 'Welcome to the emergency reporting system' }));
  });
};

const broadcast = (message) => {
  if (wss && wss.clients) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
};

module.exports = {
  initWebSocketNotifServer,
  broadcast,
};
