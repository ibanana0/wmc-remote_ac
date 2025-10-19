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
const MQTT_TOPIC_DATA = 'temp';           // topic untuk menerima data dari ESP32
const MQTT_TOPIC_COMMAND = 'temp/cmd';    // topic untuk mengirim perintah ke ESP32

const username = 'esp32user';
const password = 'windows10';

const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));

function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  const candidates = [];

  for (const interfaceName in networkInterfaces) {
    const networkInterface = networkInterfaces[interfaceName];
    for (const network of networkInterface) {
      if (network.internal || network.family !== "IPv4") {
        continue;
      }
      if (interfaceName.toLowerCase().includes("wi-fi")) {
        return network.address;
      }
      candidates.push(network.address);
    }
  }
  return candidates.length > 0 ? candidates[0] : "localhost";
}

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
  wsClient.push(ws);
  console.log(`\n🟢  Client ${req.socket.remoteAddress} berhasil terhubung`);

  const welcomeMessage = {
    type: 'welcome',
    topic: MQTT_TOPIC_DATA,
    message: `Selamat datang di topic '${MQTT_TOPIC_DATA}'`,
    clientCount: wsClient.length
  };

  try {
    ws.send(JSON.stringify(welcomeMessage));
  } catch (error) {
    console.log(`Error: ${error}`)
    if (error.code === 'ECONNRESET') {
      console.log('Client terhubung, tetapi tidak ada respons dari client');
    } else if (error.code === 'ERR_INVALID_ARG_TYPE') {
      console.log('Data JSON tidak valid');
    }
  }

  // handle message dari client (perintah AC)
  ws.on('message', (message) => {
    try{
      const data = JSON.parse(message);
      console.log('Message dari client:', data);
      
      // Jika message adalah perintah, publish ke MQTT
      if (data.type === 'perintah') {
        const commandPayload = {
          type: 'perintah',
          command: data.command,
          timestamp: data.timestamp
        };
        
        mqttClient.publish(
          MQTT_TOPIC_COMMAND, 
          JSON.stringify(commandPayload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log(`Error publish ke MQTT: ${err}`);
            } else {
              console.log(`✅  Perintah '${data.command}' berhasil dikirim ke ESP32`);
            }
          }
        );
      }
    } catch (error) {
      if (error.code === 'ERR_INVALID_ARG_TYPE') {
        console.log('Data JSON tidak valid');
      } else {
        console.log(`Error: ${error}`);
      }
    }
  })

  ws.on('close', (code, reason) => {
    console.log(`\n🔴  Client ${req.socket.remoteAddress} terputus`);
    console.log(`Browser client disconnected. Code: ${code}, Reason: ${reason}`);
    wsClient = wsClient.filter(client => client !== ws);
    console.log(`Active connections: ${wsClient.length}`);
  })

  ws.on('error', (error) => {
    if (error.code === 'ECONNRESET') {
      console.log('Client terhubung, tetapi tidak ada respons dari client');
    } else {
      console.log(`Error: ${error}`)
  }})
})

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

mqttClient.on('connect', () => {
    console.log('🟢  MQTT client terhubung ke broker');
    
    // Subscribe ke topic data
    mqttClient.subscribe(MQTT_TOPIC_DATA, (err) => {
        if (err) {
            console.log(`Error subscribe topic data: ${err}`)
            process.exit(1);
        }
        console.log(`🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC_DATA}'`);
    });
    
    // Subscribe ke topic command (opsional, untuk konfirmasi)
    mqttClient.subscribe(MQTT_TOPIC_COMMAND, (err) => {
        if (err) {
            console.log(`Error subscribe topic command: ${err}`)
        } else {
            console.log(`🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC_COMMAND}'`);
        }
    });
    
    console.log('🟡  Menunggu data...')
});

mqttClient.on('message', (topic, message) => {
    try{
        const data = JSON.parse(message);
        console.log(`\nMessage dari MQTT topic '${topic}':\n`, data);

        // Kirim data ke semua websocket client
        wsClient.forEach((client, index) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    const wsMessage = {
                        type: data.type || 'data',  // gunakan type dari ESP32
                        data: data,
                        timestamp: new Date().toISOString()
                    };
                    client.send(JSON.stringify(wsMessage));
                } catch (error) {
                    console.log(`Error: ${error}`)
                    if (error.code === 'ERR_INVALID_ARG_TYPE') {
                        console.log('Data JSON tidak valid');
                    }
                }
            } else {
                console.log(`Client ${index} tidak terhubung`);
            }
        });

        wsClient = wsClient.filter(client => client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING);
    } catch (error) {
        console.log(`Error: ${error}`)
        if (error.code === 'ERR_INVALID_ARG_TYPE') {
            console.log('Data JSON tidak valid');
        }
    }
});

const PORT = process.env.PORT || WSS_PORT;
const localIP = getLocalIP();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket Server Started`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
});
