class AirConditionerMonitor {
  constructor() {
    this.ws = null;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 3000;
    this.reconnectAttempts = 0;
    this.acPowerStatus = false;

    // --- UPDATE SESUAI KODE ARDUINO (18-22°C) ---
    this.remoteTempValue = 20; // Default Start Temp (tengah-tengah 18-22)
    this.minTemp = 18; // Batas Bawah
    this.maxTemp = 22; // Batas Atas
    // --------------------------------------------

    // Device management
    this.availableDevices = [];
    this.currentBrand = null;
    this.currentDeviceId = null;

    this.initializeElements();
    this.connectWebsocketServer();
  }

  initializeElements() {
    // status element
    this.statusDot = document.getElementById("status-dot");
    this.topicText = document.getElementById("topic-text");
    this.powerDot = document.getElementById("power-dot");

    // value element
    this.tempValue = document.getElementById("temp-value");
    this.humidityValue = document.getElementById("humidity-value");
    this.remoteTempDisplay = document.getElementById("remote-temp-value");

    // control buttons
    this.acPowerToggle = document.getElementById("ac-power-toggle");
    this.tempUpBtn = document.getElementById("temp-up-btn");
    this.tempDownBtn = document.getElementById("temp-down-btn");

    // device selector
    this.deviceSelector = document.getElementById("device-selector");

    this.setupControlButtons();
    this.setupDeviceSelector();

    this.updatePowerDot(false);
    this.updateRemoteTempDisplay();
    this.updateButtonStates();
  }

  setupDeviceSelector() {
    if (this.deviceSelector) {
      this.deviceSelector.addEventListener("change", (e) => {
        const value = e.target.value;
        if (!value) return;

        const [brand, deviceId] = value.split("|");
        this.currentBrand = brand;
        this.currentDeviceId = deviceId;
        this.updateTopicDisplay();
        console.log(`📱 Switched to ${brand}/${deviceId}`);

        // Reset state when switching devices
        this.acPowerStatus = false;
        this.remoteTempValue = 20; // Reset ke 20 (tengah range 18-22)
        this.updatePowerDot(false);
        this.updateRemoteTempDisplay();
        this.updateButtonStates();
      });
    }
  }

  updateTopicDisplay() {
    if (this.topicText && this.currentBrand && this.currentDeviceId) {
      this.topicText.textContent = `ac/${this.currentBrand}/${this.currentDeviceId}`;

      const protocolInfo = document.getElementById("protocol-info");
      if (protocolInfo) {
        protocolInfo.textContent = `Protocol: ${this.currentBrand}`;
      }
    }
  }

  updateDeviceList(devices) {
    this.availableDevices = devices;

    if (!this.deviceSelector) return;

    const currentSelection = this.deviceSelector.value;

    this.deviceSelector.innerHTML = '<option value="">Select Device</option>';

    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = `${device.brand}|${device.deviceId}`;
      option.textContent = `${device.brand} - ${device.deviceId}`;
      this.deviceSelector.appendChild(option);
    });

    if (
      currentSelection &&
      devices.some((d) => `${d.brand}|${d.deviceId}` === currentSelection)
    ) {
      this.deviceSelector.value = currentSelection;
    } else if (devices.length > 0 && !this.currentBrand) {
      this.currentBrand = devices[0].brand;
      this.currentDeviceId = devices[0].deviceId;
      this.deviceSelector.value = `${this.currentBrand}|${this.currentDeviceId}`;
      this.updateTopicDisplay();
    }
  }

  setupControlButtons() {
    if (this.acPowerToggle) {
      this.acPowerToggle.addEventListener("click", () => {
        this.toggleAcPower();
      });
    }

    if (this.tempUpBtn) {
      this.tempUpBtn.addEventListener("click", () => {
        if (!this.acPowerStatus) {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
          return;
        }

        if (this.remoteTempValue < this.maxTemp) {
          this.incrementRemoteTemp();
          this.sendCommand("TEMP_UP");
        } else {
          console.log("⚠️  Suhu sudah maksimal (22°C)");
          this.showMaxTempWarning();
        }
      });
    }

    if (this.tempDownBtn) {
      this.tempDownBtn.addEventListener("click", () => {
        if (!this.acPowerStatus) {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
          return;
        }

        if (this.remoteTempValue > this.minTemp) {
          this.decrementRemoteTemp();
          this.sendCommand("TEMP_DOWN");
        } else {
          console.log("⚠️  Suhu sudah minimal (18°C)");
          this.showMinTempWarning();
        }
      });
    }

    // Direct temperature input
    if (this.remoteTempDisplay) {
      this.remoteTempDisplay.addEventListener("click", () => {
        if (this.acPowerStatus) {
          const newTemp = prompt(
            `Set temperature (${this.minTemp}-${this.maxTemp}°C):`,
            this.remoteTempValue
          );
          if (newTemp !== null) {
            const temp = parseInt(newTemp);
            if (temp >= this.minTemp && temp <= this.maxTemp) {
              this.remoteTempValue = temp;
              this.updateRemoteTempDisplay();
              this.updateButtonStates();
            } else {
              alert(`⚠️ Suhu harus antara ${this.minTemp}-${this.maxTemp}°C`);
            }
          }
        }
      });
    }
  }

  toggleAcPower() {
    if (!this.currentBrand || !this.currentDeviceId) {
      alert("⚠️ Pilih device terlebih dahulu!");
      return;
    }

    this.acPowerStatus = !this.acPowerStatus;

    if (this.acPowerStatus) {
      this.remoteTempValue = 20; // Default start temp (tengah 18-22)
      this.updateRemoteTempDisplay();
      console.log("🔄 Suhu direset ke 20°C");
    }

    const command = this.acPowerStatus ? "ON" : "OFF";
    this.sendCommand(command);

    this.updatePowerDot(this.acPowerStatus);
    this.updateButtonStates();

    console.log(`⚡ AC Power toggled to: ${command}`);
  }

  incrementRemoteTemp() {
    if (this.remoteTempValue < this.maxTemp) {
      this.remoteTempValue++;
      this.updateRemoteTempDisplay();
      this.updateButtonStates();
      console.log(`🔼 Suhu naik ke ${this.remoteTempValue}°C`);
    }
  }

  decrementRemoteTemp() {
    if (this.remoteTempValue > this.minTemp) {
      this.remoteTempValue--;
      this.updateRemoteTempDisplay();
      this.updateButtonStates();
      console.log(`🔽 Suhu turun ke ${this.remoteTempValue}°C`);
    }
  }

  updateRemoteTempDisplay() {
    if (this.remoteTempDisplay) {
      if (!this.acPowerStatus) {
        this.remoteTempDisplay.textContent = "-";
        this.remoteTempDisplay.style.opacity = "0.3";
        this.remoteTempDisplay.style.color = "white";
        this.removeLimitWarning();
      } else {
        this.remoteTempDisplay.textContent = this.remoteTempValue;
        this.remoteTempDisplay.style.opacity = "1";

        // Visual feedback untuk batas suhu
        if (this.remoteTempValue >= this.maxTemp) {
          this.remoteTempDisplay.style.color = "#ef4444"; // Red - MAX
          this.remoteTempDisplay.style.fontWeight = "bold";
          this.addLimitWarning("MAX");
        } else if (this.remoteTempValue <= this.minTemp) {
          this.remoteTempDisplay.style.color = "#3b82f6"; // Blue - MIN
          this.remoteTempDisplay.style.fontWeight = "bold";
          this.addLimitWarning("MIN");
        } else {
          this.remoteTempDisplay.style.color = "#10b981"; // Green - Normal
          this.remoteTempDisplay.style.fontWeight = "normal";
          this.removeLimitWarning();
        }
      }
    }
    this.updateButtonStatus();
  }

  updateButtonStates() {
    if (!this.tempUpBtn || !this.tempDownBtn) return;

    if (!this.acPowerStatus) {
      this.tempUpBtn.disabled = true;
      this.tempDownBtn.disabled = true;
      this.tempUpBtn.style.opacity = "0.3";
      this.tempDownBtn.style.opacity = "0.3";
      this.tempUpBtn.style.cursor = "not-allowed";
      this.tempDownBtn.style.cursor = "not-allowed";
      return;
    }

    // Disable tombol UP jika sudah di suhu MAX (22°C)
    if (this.remoteTempValue >= this.maxTemp) {
      this.tempUpBtn.disabled = true;
      this.tempUpBtn.style.opacity = "0.3";
      this.tempUpBtn.style.cursor = "not-allowed";
    } else {
      this.tempUpBtn.disabled = false;
      this.tempUpBtn.style.opacity = "1";
      this.tempUpBtn.style.cursor = "pointer";
    }

    // Disable tombol DOWN jika sudah di suhu MIN (18°C)
    if (this.remoteTempValue <= this.minTemp) {
      this.tempDownBtn.disabled = true;
      this.tempDownBtn.style.opacity = "0.3";
      this.tempDownBtn.style.cursor = "not-allowed";
    } else {
      this.tempDownBtn.disabled = false;
      this.tempDownBtn.style.opacity = "1";
      this.tempDownBtn.style.cursor = "pointer";
    }
  }

  addLimitWarning(type) {
    const container = document.getElementById("temp-warning-container");
    if (!container) return;

    let warningHTML = "";

    if (type === "MAX") {
      warningHTML = `
        <div class="inline-flex items-center gap-2 px-3 py-1 bg-red-500/20 border border-red-500 rounded-full text-xs text-red-400 animate-pulse">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span class="font-medium">MAX LIMIT 22°C</span>
        </div>
      `;
    } else if (type === "MIN") {
      warningHTML = `
        <div class="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 border border-blue-500 rounded-full text-xs text-blue-400 animate-pulse">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span class="font-medium">MIN LIMIT 18°C</span>
        </div>
      `;
    }

    container.innerHTML = warningHTML;
  }

  removeLimitWarning() {
    const container = document.getElementById("temp-warning-container");
    if (container) {
      container.innerHTML = "";
    }
  }

  updateButtonStatus() {
    const statusElement = document.getElementById("button-status");
    const lastCommandElement = document.getElementById("last-command");

    if (!statusElement) return;

    if (!this.acPowerStatus) {
      statusElement.textContent = "OFF";
      statusElement.className = "text-gray-600";
      if (lastCommandElement) lastCommandElement.textContent = "AC Power: OFF";
    } else if (this.remoteTempValue >= this.maxTemp) {
      statusElement.textContent = "MAX 22°C";
      statusElement.className = "text-red-400";
      if (lastCommandElement) lastCommandElement.textContent = "At Maximum";
    } else if (this.remoteTempValue <= this.minTemp) {
      statusElement.textContent = "MIN 18°C";
      statusElement.className = "text-blue-400";
      if (lastCommandElement) lastCommandElement.textContent = "At Minimum";
    } else {
      statusElement.textContent = `${this.remoteTempValue}°C`;
      statusElement.className = "text-green-400";
      if (lastCommandElement) lastCommandElement.textContent = "Ready";
    }
  }

  showTempWarning() {
    if (this.acPowerToggle) {
      this.acPowerToggle.classList.add("animate-pulse");
      setTimeout(() => {
        this.acPowerToggle.classList.remove("animate-pulse");
      }, 1000);
    }
  }

  showMaxTempWarning() {
    if (this.tempUpBtn) {
      this.tempUpBtn.classList.add("animate-shake");
      setTimeout(() => {
        this.tempUpBtn.classList.remove("animate-shake");
      }, 300);
    }
  }

  showMinTempWarning() {
    if (this.tempDownBtn) {
      this.tempDownBtn.classList.add("animate-shake");
      setTimeout(() => {
        this.tempDownBtn.classList.remove("animate-shake");
      }, 300);
    }
  }

  updatePowerDot(isOn) {
    if (this.powerDot) {
      this.powerDot.className = `absolute top-0 right-0 w-4 h-4 rounded-full ${
        isOn ? "bg-green-500" : "bg-gray-600"
      } border-2 border-gray-900 transition-colors duration-300 shadow`;
    }

    this.updateRemoteTempDisplay();
    this.updateButtonStates();
  }

  sendCommand(command, customTemp = null) {
    if (!this.currentBrand || !this.currentDeviceId) {
      alert("⚠️ Pilih device terlebih dahulu!");
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const commandMessage = {
        type: "perintah",
        brand: this.currentBrand,
        deviceId: this.currentDeviceId,
        command: command,
        temperature: customTemp !== null ? customTemp : this.remoteTempValue,
        timestamp: new Date().toISOString(),
      };

      try {
        this.ws.send(JSON.stringify(commandMessage));
        console.log(`📤 Command sent: ${command} (${this.remoteTempValue}°C)`);
      } catch (error) {
        console.log(`🟥  Error mengirim perintah: ${error}`);
      }
    } else {
      alert("❌ Tidak terhubung ke server!");
    }
  }

  connectWebsocketServer() {
      try {
        const isProduction = window.location.hostname.includes("railway.app");
        const protocol =
          window.location.protocol === "https:" || isProduction
            ? "wss:"
            : "ws:";
        const wsUrl = `${protocol}//${window.location.host}`;

        console.log(`🔗 Connecting to: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("🟩  Koneksi ke WebSocket Server berhasil");
          this.updateStatus(true, "Connected");
          this.reconnectAttempts = 0;

          // Request device list
          this.ws.send(JSON.stringify({ type: "get_devices" }));
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.log(`🟥  Terdapat error ketika parsing message: ${error}`);
          }
        };

        this.ws.onclose = () => {
          console.log("🟨  Koneksi ke WebSocket Server terputus");
          this.updateStatus(false, "Disconnect");
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.log(`🟥  WebSocket Error`);
          this.updateStatus(false, "Error");
        };
      } catch (error) {
        console.log(`🟥  Terdapat error : ${error}`);
      }
  }

  updateStatus(isOnline, statusText) {
    this.statusDot.className = `w-2 h-2 rounded-full ${
      isOnline ? "bg-green-500" : "bg-gray-600"
    }`;
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`
      );
      setTimeout(() => {
        this.connectWebsocketServer();
      }, this.reconnectInterval);
    } else {
      console.log("❌ Max reconnect attempts reached");
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        console.log("👋 Welcome message received");
        if (message.devices) {
          this.updateDeviceList(message.devices);
        }
        break;

      case "device_list":
        console.log("📋 Device list received");
        if (message.devices) {
          this.updateDeviceList(message.devices);
        }
        break;

      case "data":
        if (
          message.brand === this.currentBrand &&
          message.deviceId === this.currentDeviceId
        ) {
          if (message.data && message.data.type === "data") {
            this.updateData(message.data, message.timestamp);
          }
        }

        // Add new device if not in list
        if (
          !this.availableDevices.find(
            (d) => d.brand === message.brand && d.deviceId === message.deviceId
          )
        ) {
          this.availableDevices.push({
            brand: message.brand,
            deviceId: message.deviceId,
          });
          this.updateDeviceList(this.availableDevices);
        }
        break;

      case "perintah_status":
        if (
          message.brand === this.currentBrand &&
          message.deviceId === this.currentDeviceId
        ) {
          if (message.data && message.data.type === "perintah_status") {
            this.handleCommandStatus(message.data);
          }
        }
        break;

      default:
        console.log(`📨 Unknown message type: ${message.type}`);
    }
  }

  handleCommandStatus(data) {
    console.log(
      `📥 Status: ${data.status}, Command: ${data.command}, Power: ${data.power_status}, Temp: ${data.current_temp}`
    );

    if (data.power_status !== undefined) {
      this.acPowerStatus = data.power_status;
      this.updatePowerDot(this.acPowerStatus);
    }

    if (data.current_temp !== undefined) {
      this.remoteTempValue = data.current_temp;
      this.updateRemoteTempDisplay();
      this.updateButtonStates();
    }

    if (data.status !== "success") {
      alert(`⚠️ Perintah ${data.command} gagal!`);
    }
  }

  updateData(data, timestamp) {
    if (data.temperature !== undefined) {
      this.tempValue.textContent = data.temperature.toFixed(1);
    }

    if (data.humidity !== undefined) {
      this.humidityValue.textContent = data.humidity.toFixed(1);
    }

    if (data.power_status !== undefined) {
      this.acPowerStatus = data.power_status;
      this.updatePowerDot(this.acPowerStatus);
    }

    if (data.current_temp !== undefined) {
      this.remoteTempValue = data.current_temp;
      this.updateRemoteTempDisplay();
      this.updateButtonStates();
    }
  }
}

// Initialize on DOM ready
document.addEventListener(
  "DOMContentLoaded",
  () => new AirConditionerMonitor()
);
