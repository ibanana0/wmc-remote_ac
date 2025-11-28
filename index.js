const mqtt = require("mqtt");
const os = require("os");
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const path = require("path");

const MQTT_BROKER = "34.46.216.209";
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

// Device timeout (30 detik)
const DEVICE_TIMEOUT = 5 * 60 * 1000;

// Cleanup inactive devices
function cleanupInactiveDevices() {
  const now = Date.now();
  let removedCount = 0;

  for (const [deviceKey, device] of activeDevices.entries()) {
    const lastSeenTime = new Date(device.lastSeen).getTime();
    const timeDiff = now - lastSeenTime;

    if (timeDiff > DEVICE_TIMEOUT) {
      console.log(
        `🗑️  Removing inactive device: ${deviceKey} (last seen: ${Math.floor(
          timeDiff / 1000
        )}s ago)`
      );
      activeDevices.delete(deviceKey);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`✅ Cleaned up ${removedCount} inactive device(s)`);
    broadcastDeviceList();
  }
}

// Broadcast device list to all connected clients
function broadcastDeviceList() {
  const deviceList = {
    type: "device_list",
    devices: Array.from(activeDevices.values()),
  };

  wsClient.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(deviceList));
      } catch (error) {
        console.log(`Error broadcasting device list: ${error}`);
      }
    }
  });
}

// Run cleanup every 10 seconds
setInterval(cleanupInactiveDevices, 10000);

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
    if (error.code === "ECONNRESET") {
      console.log("Client terhubung, tetapi tidak ada respons dari client");
    } else if (error.code === "ERR_INVALID_ARG_TYPE") {
      console.log("Data JSON tidak valid");
    }
  }

  // ✅ SEMUA HANDLER MESSAGE ADA DI SINI (DALAM CONNECTION HANDLER)
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Message dari client:", data);

      // Handler untuk perintah AC (ON/OFF/TEMP)
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

      // Handler untuk request devices
      if (data.type === "request_devices") {
        console.log("📋 Forwarding request_devices to all ESP32...");

        const requestPayload = {
          type: "system",
          command: "REQUEST_DEVICES",
          timestamp: new Date().toISOString(),
        };

        mqttClient.publish(
          "ac/broadcast/cmd",
          JSON.stringify(requestPayload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log(`Error sending request_devices: ${err}`);
            } else {
              console.log("✅ Request devices sent to all ESP32");
            }
          }
        );
      }

      // Handler untuk switch device
      if (data.type === "switch_device") {
        const brand = data.brand || "unknown";
        const deviceId = data.deviceId || "unknown";

        console.log(
          `🔄 Forwarding switch_device to ESP32: ${brand}/${deviceId}`
        );

        const switchPayload = {
          type: "system",
          command: "SWITCH_DEVICE",
          brand: brand,
          deviceId: deviceId,
          timestamp: new Date().toISOString(),
        };

        mqttClient.publish(
          "ac/broadcast/cmd",
          JSON.stringify(switchPayload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log(`Error sending switch_device: ${err}`);
            } else {
              console.log(
                `✅ Switch device command sent: ${brand}/${deviceId}`
              );
            }
          }
        );
      }

      // Handler untuk delete device
      if (data.type === "delete_device") {
        const brand = data.brand || "unknown";
        const deviceId = data.deviceId || "unknown";
        const deviceKey = `${brand}/${deviceId}`;

        // Remove from server's active devices
        activeDevices.delete(deviceKey);
        console.log(`🗑️  Device ${deviceKey} removed from server`);

        // Send DELETE_DEVICE command
        const cmdTopic = `ac/broadcast/cmd`;
        const deletePayload = {
          type: "system",
          command: "DELETE_DEVICE",
          brand: brand,
          deviceId: deviceId,
          timestamp: new Date().toISOString(),
        };

        mqttClient.publish(
          cmdTopic,
          JSON.stringify(deletePayload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log(`Error sending delete command: ${err}`);
            } else {
              console.log(
                `✅  Delete device command sent to ESP32: ${brand}/${deviceId}`
              );
            }
          }
        );

        // Broadcast updated device list
        broadcastDeviceList();
      }

      // Handler untuk get devices
      if (data.type === "get_devices") {
        const deviceList = {
          type: "device_list",
          devices: Array.from(activeDevices.values()),
        };
        ws.send(JSON.stringify(deviceList));
      }
    } catch (error) {
      if (error.code === "ERR_INVALID_ARG_TYPE") {
        console.log("Data JSON tidak valid");
      } else {
        console.log(`Error: ${error}`);
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`\n🔴  Client ${req.socket.remoteAddress} terputus`);
    console.log(
      `Browser client disconnected. Code: ${code}, Reason: ${reason}`
    );
    wsClient = wsClient.filter((client) => client !== ws);
    console.log(`Active connections: ${wsClient.length}`);
  });

  ws.on("error", (error) => {
    if (error.code === "ECONNRESET") {
      console.log("Client terhubung, tetapi tidak ada respons dari client");
    } else {
      console.log(`Error: ${error}`);
    }
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

  mqttClient.subscribe(MQTT_TOPIC_DATA, (err) => {
    if (err) {
      console.log(`Error subscribe topic data: ${err}`);
      process.exit(1);
    }
    console.log(
      `🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC_DATA}'`
    );
  });

  mqttClient.subscribe(MQTT_TOPIC_STATUS, (err) => {
    if (err) {
      console.log(`Error subscribe topic status: ${err}`);
    } else {
      console.log(
        `🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC_STATUS}'`
      );
    }
  });

  // PERBAIKAN: Subscribe ke broadcast registry
  mqttClient.subscribe("ac/broadcast/registry", (err) => {
    if (err) {
      console.log(`Error subscribe topic broadcast registry: ${err}`);
    } else {
      console.log(
        `🟢  MQTT client berhasil subscribe topic 'ac/broadcast/registry'`
      );
    }
  });

  mqttClient.subscribe("ac/broadcast/cmd", (err) => {
    if (err) {
      console.log(`Error subscribe topic broadcast: ${err}`);
    } else {
      console.log(
        `🟢  MQTT client berhasil subscribe topic 'ac/broadcast/cmd'`
      );
    }
  });

  console.log("🟡  Menunggu data dari devices...");
});


mqttClient.on("message", (topic, message) => {
  console.log(`\n📬 MQTT Message received from topic: ${topic}`);

  try {
    const data = JSON.parse(message);

    if (topic === "ac/broadcast/registry") {
      console.log("\n📋 ===== DEVICE REGISTRY DETECTED =====");
      console.log("ESP ID:", data.esp_id);
      console.log("Total devices:", data.total_devices);

      if (data.type === "device_registry" && data.devices) {
        console.log(
          `\n🔄 Updating device list (${data.devices.length} devices from ESP32):`
        );

        data.devices.forEach((device) => {
          const deviceKey = `${device.brand}/${device.deviceId}`;
          activeDevices.set(deviceKey, {
            brand: device.brand,
            deviceId: device.deviceId,
            buttonCount: device.buttonCount || 0,
            protocol: device.protocol || "unknown",
            uniqueCode: device.uniqueCode || 0,
            espId: data.esp_id,
            lastSeen: new Date().toISOString(),
          });
          console.log(`  ✅ Registered: ${deviceKey}`);
        });

        console.log(`\n✅ Total active devices: ${activeDevices.size}`);

        // Broadcast ke semua web clients
        broadcastDeviceList();
      }
      return;
    }

    // Handle broadcast commands
    if (topic === "ac/broadcast/cmd") {
      console.log("📢 Broadcast command received:", data);
      // Server tidak perlu handle ini, ini untuk ESP32
      return;
    }

    // Validasi format topic untuk data/status messages
    const topicParts = topic.split("/");

    if (topicParts.length < 4 || topicParts[0] !== "ac") {
      console.log(`⚠️  Invalid topic format: ${topic}`);
      return;
    }

    const brand = topicParts[1];
    const deviceId = topicParts[2];
    const messageType = topicParts[3];

    if (!brand || !deviceId) {
      console.log(`⚠️  Missing brand or deviceId in topic: ${topic}`);
      return;
    }

    // Update active devices list
    const deviceKey = `${brand}/${deviceId}`;

    const existingDevice = activeDevices.get(deviceKey);
    activeDevices.set(deviceKey, {
      brand: brand,
      deviceId: deviceId,
      buttonCount: existingDevice?.buttonCount || 0,
      protocol: existingDevice?.protocol || "unknown",
      uniqueCode: existingDevice?.uniqueCode || 0,
      espId: existingDevice?.espId || "unknown",
      lastSeen: new Date().toISOString(),
    });

    console.log(`📨 Data message from ${brand}/${deviceId} (${messageType})`);

    // Kirim data ke semua websocket client
    let sentCount = 0;
    let failedCount = 0;

    wsClient.forEach((client, index) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          const wsMessage = {
            type: data.type || "data",
            brand: brand,
            deviceId: deviceId,
            messageType: messageType,
            data: data,
            timestamp: new Date().toISOString(),
          };
          client.send(JSON.stringify(wsMessage));
          sentCount++;
        } catch (error) {
          failedCount++;
          console.log(`❌ Error sending to client ${index}: ${error.message}`);
        }
      } else {
        failedCount++;
      }
    });

    if (sentCount > 0 || failedCount > 0) {
      console.log(`📤 Broadcast: ${sentCount} sent, ${failedCount} failed`);
    }

    // Filter client yang tidak aktif
    const beforeCount = wsClient.length;
    wsClient = wsClient.filter(
      (client) =>
        client.readyState === WebSocket.OPEN ||
        client.readyState === WebSocket.CONNECTING
    );
    const afterCount = wsClient.length;

    if (beforeCount !== afterCount) {
      console.log(`🧹 Cleaned up ${beforeCount - afterCount} client(s)`);
    }
  } catch (error) {
    console.log(`\n❌ Error processing MQTT message:`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Error: ${error.message}`);

    if (error instanceof SyntaxError) {
      console.log("   Raw message:", message.toString());
    }
  }
});

const PORT = process.env.PORT || WSS_PORT;
const HOST = process.env.HOST || "0.0.0.0";
const localIP = getLocalIP();

server.listen(PORT, HOST, () => {
  console.log(`WebSocket Server Started`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
});
