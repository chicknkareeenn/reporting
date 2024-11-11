const WebSocket = require('ws');

let notifServer;

function initWebSocketNotifServer(server) {
    notifServer = new WebSocket.Server({ server });

    notifServer.on('connection', (ws) => {
        console.log('Notification WebSocket client connected');

        ws.on('message', (message) => {
            console.log(`Notification WebSocket received message => ${message}`);
        });

        ws.on('close', () => {
            console.log('Notification WebSocket client disconnected');
        });
    });
}

function broadcastNotification(message) {
    notifServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'notification', message }));
        }
    });
}

module.exports = { initWebSocketNotifServer, broadcastNotification };
