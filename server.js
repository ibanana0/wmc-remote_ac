const mqtt = require("mqtt");
const os = require("os");
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const path = require("path");

const MQTT_BROKER = "34.171.9.145"; // Update IP sesuai kode ESP32 Anda (jika berubah)
const MQTT_PORT = 1883;
const MQTT_URL = `mqtt://${MQTT_BROKER}:${MQTT_PORT}`;
const WSS_PORT = 8080;

// Topic pattern: ac/{brand}/{deviceId}/data | cmd | status
const MQTT_TOPIC_DATA = "ac/+/+/data";
const MQTT_TOPIC_STATUS = "ac/+/+/status";
const MQTT_TOPIC_CMD_BASE = "ac";

const username = "esp32user";
const password = "windows10";

const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, "public")));

// Track active devices
let activeDevices = new Map();

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
    server: server,
  });
} catch (error) {
  if (error.code === "EADDRINUSE") {
    console.log("Port sudah digunakan, mohon coba port lain");
  } else {
    console.log(`Error: ${error}`);
  }
}

let wsClient = [];
wss.on("connection", (ws, req) => {
  wsClient.push(ws);
  console.log(`\n🟢  Client ${req.socket.remoteAddress} berhasil terhubung`);

  const welcomeMessage = {
    type: "welcome",
    message: "Selamat datang di Smart AC Multi-Device System",
    clientCount: wsClient.length,
    devices: Array.from(activeDevices.values()),
  };

  try {
    ws.send(JSON.stringify(welcomeMessage));
  } catch (error) {
    console.log(`Error: ${error}`);
  }

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Message dari client:", data);

      if (data.type === "perintah") {
        const brand = data.brand || "unknown";
        const deviceId = data.deviceId || "unknown";
        const cmdTopic = `${MQTT_TOPIC_CMD_BASE}/${brand}/${deviceId}/cmd`;

        const commandPayload = {
          type: "perintah",
          command: data.command,
          temperature: data.temperature,
          timestamp: data.timestamp,
        };

        mqttClient.publish(
          cmdTopic,
          JSON.stringify(commandPayload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log(`Error publish ke MQTT: ${err}`);
            } else {
              console.log(
                `✅  Perintah '${data.command}' berhasil dikirim ke ${brand}/${deviceId}`
              );
            }
          }
        );
      }

      if (data.type === "get_devices") {
        const deviceList = {
          type: "device_list",
          devices: Array.from(activeDevices.values()),
        };
        ws.send(JSON.stringify(deviceList));
      }
    } catch (error) {
      console.log(`Error processing message: ${error}`);
    }
  });

  ws.on("close", (code, reason) => {
    wsClient = wsClient.filter((client) => client !== ws);
  });

  ws.on("error", (error) => {
    console.log(`WS Error: ${error}`);
  });
});

console.log("Connecting to MQTT broker...");
const mqttClient = mqtt.connect(MQTT_URL, {
  username: username,
  clean: true,
  password: password,
  reconnectPeriod: 1000,
  connectTimeout: 10 * 1000,
});

mqttClient.on("connect", () => {
  console.log("🟢  MQTT client terhubung ke broker");

  mqttClient.subscribe(MQTT_TOPIC_DATA);
  mqttClient.subscribe(MQTT_TOPIC_STATUS);

  console.log("🟡  Menunggu data dari devices...");
});

mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message);

    // Parse topic: ac/{brand}/{deviceId}/{type}
    const topicParts = topic.split("/");
    if (topicParts.length < 4) return;
    
    const brand = topicParts[1];
    const deviceId = topicParts[2];
    const messageType = topicParts[3];

    // Update active devices list
    const deviceKey = `${brand}/${deviceId}`;
    activeDevices.set(deviceKey, {
      brand: brand,
      deviceId: deviceId,
      lastSeen: new Date().toISOString(),
    });

    console.log(`\nMessage dari ${brand}/${deviceId} (${messageType}):`, data);

    // Kirim data ke semua websocket client
    wsClient.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const wsMessage = {
          type: data.type || "data",
          brand: brand,
          deviceId: deviceId,
          messageType: messageType,
          data: data,
          timestamp: new Date().toISOString(),
        };
        client.send(JSON.stringify(wsMessage));
      }
    });
  } catch (error) {
    console.log(`Error parsing MQTT message: ${error}`);
  }
});

const PORT = process.env.PORT || WSS_PORT;
const localIP = getLocalIP();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket Server Started`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
});