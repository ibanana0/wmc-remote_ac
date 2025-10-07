const mqtt = require('mqtt');
const os = require('os');
const WebSocket = require('ws');
const express = require('express');
const http = require("http");
const path = require('path');

const MQTT_BROKER = '35.226.15.168';
const MQTT_PORT = 1883;
const MQTT_URL = `mqtt://${MQTT_BROKER}:${MQTT_PORT}`;
const WSS_PORT = 8080;
const MQTT_TOPIC = 'temp';

const username = 'esp32user';
const password = 'windows10';

// membuat server
const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));

// mendapatkan ip local --> agar bisa diakses dari luar laptop
function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  const candidates = [];

  for (const interfaceName in networkInterfaces) {
    const networkInterface = networkInterfaces[interfaceName];
    for (const network of networkInterface) {
      // Skip alamat internal
      if (network.internal || network.family !== "IPv4") {
        continue;
      }
      // Prioritaskan alamat Wi-Fi
      if (interfaceName.toLowerCase().includes("wi-fi")) {
        return network.address;
      }
      candidates.push(network.address);
    }
  }
  return candidates.length > 0 ? candidates[0] : "localhost";
}

// Membuat WebSocket Server
let wss;
try {
    wss = new WebSocket.Server({
      server: server
    });
} catch (error) {
    if (error.code === 'EADDRINUSE') {
        console.log('Port sudah digunakan, mohon coba port lain');
    } else {
	    console.log(`Error: ${error}`);
    }
}

let wsClient = [];
wss.on('connection', (ws, req) => {
  // send
  wsClient.push(ws);
  console.log(`\n🟢  Client ${req.socket.remoteAddress} berhasil terhubung`);

  // welcome client
  const welcomeMessage = {
    type: 'welcome',
    topic: MQTT_TOPIC,
    message: `Selamat datang di topic '${MQTT_TOPIC}'`,
    clientCount: wsClient.length
  };

  try {
    ws.send(JSON.stringify(welcomeMessage));    // diubah jadi string agar bisa dikirim ke client
  } catch (error) {
    console.log(`Error: ${error}`)
    if (error.code === 'ECONNRESET') {
      console.log('Client terhubung, tetapi tidak ada respons dari client');
    }
    // error ketika data JSON formatnya salah
    else if (error.code === 'ERR_INVALID_ARG_TYPE') {
      console.log('Data JSON tidak valid');
    }
  }

  // handle message
  ws.on('message', (message) => {
    try{
      const data = JSON.parse(message);
      console.log('Message dari client:', data);
    } catch (error) {
      if (error.code === 'ERR_INVALID_ARG_TYPE') {
        console.log('Data JSON tidak valid');
      } else {
        console.log(`Error: ${error}`);
      }
    }
  })

  // close
  ws.on('close', (code, reason) => {
    console.log(`\n🔴  Client ${req.socket.remoteAddress} terputus`);
    console.log(`Browser client disconnected. Code: ${code}, Reason: ${reason}`);
    wsClient = wsClient.filter(client => client !== ws);
    console.log(`Active connections: ${wsClient.length}`);
  })

  // error
  ws.on('error', (error) => {
    if (error.code === 'ECONNRESET') {
      console.log('Client terhubung, tetapi tidak ada respons dari client');
    } else {
	    console.log(`Error: ${error}`)
  }})
})

// menginisialisasi MQTT Client
console.log('Connecting to MQTT broker...');
const mqttClient = mqtt.connect(
    MQTT_URL,
    {
        username: username,
        clean: true,
        password: password,
        reconnectPeriod: 1000,
        connectTimeout: 10 * 1000,
    }
);

// connect mqtt client ke topic jika bisa konek
mqttClient.on('connect', () => {
    console.log('🟢  MQTT client terhubung ke broker');
    mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (err) {
            console.log(`Error: ${err}`)
            process.exit(1);
        }
        console.log(`🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC}'`);
        console.log('🟡  Menunggu data...')
    });
});

// mqtt client menerima data dari mqtt broker
mqttClient.on('message', (topic, message) => {
    try{
        const data = JSON.parse(message);
        console.log(`\nMessage dari MQTT topic '${topic}':\n`, data);

        // mengirim data ke semua client
        wsClient.forEach((client, index) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    const wsMessage = {
                        type: 'data_monitor',
                        data: data,
                        timestamp: new Date().toISOString()
                    };
                    client.send(JSON.stringify(wsMessage));
                } catch (error) {
                    console.log(`Error: ${error}`)
                    if (error.code === 'ERR_INVALID_ARG_TYPE') {
                        console.log('Data JSON tidak valid');
                    }
                    process.exit(1);
                }
            } else {
                console.log(`Client ${index} tidak terhubung`);
            }
        });

        // clean up
        wsClient = wsClient.filter(client => client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING);
    } catch (error) {
        console.log(`Error: ${error}`)
        if (error.code === 'ERR_INVALID_ARG_TYPE') {
            console.log('Data JSON tidak valid');
        }
        process.exit(1);
    }
});

const PORT = process.env.PORT || WSS_PORT;
const localIP = getLocalIP();

// jalankan server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket Server Started`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
});