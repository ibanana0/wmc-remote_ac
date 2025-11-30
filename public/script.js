class AirConditionerMonitor {
  constructor() {
    this.ws = null;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 3000;
    this.reconnectAttempts = 0;
    this.acPowerStatus = false;
    this.remoteTempValue = 18;
    this.minTemp = 18;
    this.maxTemp = 22;

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
    this.deleteDeviceBtn = document.getElementById("delete-device-btn");

    this.setupControlButtons();
    this.setupDeviceSelector();
    this.setupDeleteButton();

    this.updatePowerDot(false);
    this.updateRemoteTempDisplay();
  }

  setupDeleteButton() {
    if (this.deleteDeviceBtn) {
      this.deleteDeviceBtn.addEventListener("click", () => {
        this.deleteCurrentDevice();
      });
    }
  }

  deleteCurrentDevice() {
    if (!this.currentBrand || !this.currentDeviceId) {
      alert("⚠️ Pilih device terlebih dahulu!");
      return;
    }

    const deviceName = `${this.currentBrand}/${this.currentDeviceId}`;
    const confirmed = confirm(
      `⚠️ Hapus device "${deviceName}"?\n\nIni akan menghapus:\n- Data di web interface\n- Data di ESP32 (device akan restart)\n\nLanjutkan?`
    );

    if (!confirmed) return;

    // Send delete command ke server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const deleteMessage = {
        type: "delete_device",
        brand: this.currentBrand,
        deviceId: this.currentDeviceId,
        timestamp: new Date().toISOString(),
      };

      try {
        this.ws.send(JSON.stringify(deleteMessage));
        console.log(`🗑️  Delete request sent for ${deviceName}`);

        // Reset current device
        this.currentBrand = null;
        this.currentDeviceId = null;
        this.acPowerStatus = false;
        this.remoteTempValue = 18;

        // Update UI
        this.updatePowerDot(false);
        this.updateRemoteTempDisplay();
        this.updateDeleteButtonState();

        alert(
          `✅ Device "${deviceName}" berhasil dihapus!\nESP32 akan restart.`
        );
      } catch (error) {
        console.log(`🟥  Error mengirim delete request: ${error}`);
        alert("❌ Gagal menghapus device!");
      }
    } else {
      alert("❌ Tidak terhubung ke server!");
    }
  }

  updateDeleteButtonState() {
    if (this.deleteDeviceBtn) {
      if (this.currentBrand && this.currentDeviceId) {
        this.deleteDeviceBtn.disabled = false;
      } else {
        this.deleteDeviceBtn.disabled = true;
      }
    }
  }

  setupDeviceSelector() {
    if (this.deviceSelector) {
      // Request device list ketika dropdown diklik/difokuskan
      this.deviceSelector.addEventListener("focus", () => {
        console.log("📋 Requesting device list from ESP32...");
        this.requestDeviceListFromESP32();
      });

      // Handle device selection change
      this.deviceSelector.addEventListener("change", (e) => {
        const selectedValue = e.target.value;

        if (!selectedValue) {
          this.currentBrand = null;
          this.currentDeviceId = null;
        } else {
          const [brand, deviceId] = selectedValue.split("|");

          // Kirim perintah switch device ke ESP32
          this.switchDeviceOnESP32(brand, deviceId);

          this.currentBrand = brand;
          this.currentDeviceId = deviceId;
        }

        this.updateTopicDisplay();
        this.updateDeleteButtonState();
        console.log(
          `📱 Switched to ${this.currentBrand}/${this.currentDeviceId}`
        );

        // Reset state ketika switching devices
        this.acPowerStatus = false;
        this.remoteTempValue = 18;
        this.updatePowerDot(false);
        this.updateRemoteTempDisplay();
      });
    }
  }

  // Request device list dari ESP32
  requestDeviceListFromESP32() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const requestMessage = {
        type: "request_devices",
        timestamp: new Date().toISOString(),
      };

      try {
        this.ws.send(JSON.stringify(requestMessage));
        console.log("📤 Request device list sent to ESP32");

        // Retry setelah 2 detik jika tidak ada response
        setTimeout(() => {
          if (this.availableDevices.length === 0) {
            console.log("⚠️ No devices received, retrying...");
            this.ws.send(JSON.stringify(requestMessage));
          }
        }, 2000);
      } catch (error) {
        console.log(`🟥  Error sending request: ${error}`);
      }
    }
  }

  // Switch device di ESP32
  switchDeviceOnESP32(brand, deviceId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const switchMessage = {
        type: "switch_device",
        brand: brand,
        deviceId: deviceId,
        timestamp: new Date().toISOString(),
      };

      try {
        this.ws.send(JSON.stringify(switchMessage));
        console.log(`📤 Switch device command sent: ${brand}/${deviceId}`);
      } catch (error) {
        console.log(`🟥  Error sending switch command: ${error}`);
      }
    }
  }

  updateTopicDisplay() {
    if (this.topicText && this.currentBrand && this.currentDeviceId) {
      this.topicText.textContent = `ac/${this.currentBrand}/${this.currentDeviceId}`;
    } else {
      this.topicText.textContent = "-";
    }
  }

  updateDeviceList(devices) {
    this.availableDevices = devices;

    if (!this.deviceSelector) return;

    // Simpan device yang sedang dipilih
    const currentSelection = this.deviceSelector.value;

    this.deviceSelector.innerHTML = '<option value="">Select Device</option>';

    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = `${device.brand}|${device.deviceId}`;
      option.textContent = `${device.brand} - ${device.deviceId} (${
        device.buttonCount || 0
      } btn)`;
      this.deviceSelector.appendChild(option);
    });

    // Restore selection jika masih ada
    if (
      currentSelection &&
      devices.find((d) => `${d.brand}|${d.deviceId}` === currentSelection)
    ) {
      this.deviceSelector.value = currentSelection;
    } else if (devices.length > 0 && !this.currentBrand) {
      // Auto pilih first device kalo gada yang dipilih
      this.currentBrand = devices[0].brand;
      this.currentDeviceId = devices[0].deviceId;
      this.deviceSelector.value = `${this.currentBrand}|${this.currentDeviceId}`;
      this.updateTopicDisplay();

      // Auto switch ke device pertama di ESP32
      this.switchDeviceOnESP32(this.currentBrand, this.currentDeviceId);
    } else if (devices.length === 0) {
      // No devices available
      this.currentBrand = null;
      this.currentDeviceId = null;
      this.updateTopicDisplay();
    }

    this.updateDeleteButtonState();
  }

  setupControlButtons() {
    if (this.acPowerToggle) {
      this.acPowerToggle.addEventListener("click", () => {
        this.toggleAcPower();
      });
    }

    if (this.tempUpBtn) {
      this.tempUpBtn.addEventListener("click", () => {
        if (this.acPowerStatus) {
          this.incrementRemoteTemp();
          this.sendCommand("TEMP_UP");
        } else {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
        }
      });
    }

    if (this.tempDownBtn) {
      this.tempDownBtn.addEventListener("click", () => {
        if (this.acPowerStatus) {
          this.decrementRemoteTemp();
          this.sendCommand("TEMP_DOWN");
        } else {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
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
      this.remoteTempValue = 18;
      this.updateRemoteTempDisplay();
      console.log("🔄 Suhu direset ke 18°C");
    }

    const command = this.acPowerStatus ? "ON" : "OFF";
    this.sendCommand(command);

    this.updatePowerDot(this.acPowerStatus);

    console.log(`⚡ AC Power toggled to: ${command}`);
  }

  incrementRemoteTemp() {
    if (this.remoteTempValue < this.maxTemp) {
      this.remoteTempValue++;
      this.updateRemoteTempDisplay();
      console.log(`🔼 Suhu naik ke ${this.remoteTempValue}°C`);
    } else {
      console.log(`⚠️  Suhu maksimum ${this.maxTemp}°C tercapai`);
      this.showMaxTempWarning();
    }
  }

  decrementRemoteTemp() {
    if (this.remoteTempValue > this.minTemp) {
      this.remoteTempValue--;
      this.updateRemoteTempDisplay();
      console.log(`🔽 Suhu turun ke ${this.remoteTempValue}°C`);
    } else {
      console.log(`⚠️  Suhu minimum ${this.minTemp}°C tercapai`);
      this.showMinTempWarning();
    }
  }

  updateRemoteTempDisplay() {
    if (this.remoteTempDisplay) {
      if (!this.acPowerStatus) {
        this.remoteTempDisplay.textContent = "-";
        this.remoteTempDisplay.style.opacity = "0.3";
      } else {
        this.remoteTempDisplay.textContent = this.remoteTempValue;
        this.remoteTempDisplay.style.opacity = "1";
      }
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
      this.tempUpBtn.style.opacity = "0.3";
      setTimeout(() => {
        this.tempUpBtn.style.opacity = "1";
      }, 500);
    }
  }

  showMinTempWarning() {
    if (this.tempDownBtn) {
      this.tempDownBtn.style.opacity = "0.3";
      setTimeout(() => {
        this.tempDownBtn.style.opacity = "1";
      }, 500);
    }
  }

  updatePowerDot(isOn) {
    if (this.powerDot) {
      this.powerDot.className = `absolute -top-1 -right-1 w-3 h-3 rounded-full ${
        isOn ? "bg-green-500" : "bg-gray-600"
      }`;
    }

    this.updateRemoteTempDisplay();
  }

  sendCommand(command) {
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
        temperature: this.remoteTempValue,
        timestamp: new Date().toISOString(),
      };

      try {
        this.ws.send(JSON.stringify(commandMessage));
        console.log(
          `🟦  Perintah '${command}' untuk ${this.currentBrand}/${this.currentDeviceId} dikirim`
        );
      } catch (error) {
        console.log(`🟥  Error mengirim perintah: ${error}`);
      }
    } else {
      console.log(
        "🟥  WebSocket tidak terhubung, tidak dapat mengirim perintah"
      );
      alert("❌ Tidak terhubung ke server!");
    }
  }

  connectWebsocketServer() {
    try {
      const isProduction = window.location.hostname.includes("railway.app");
      const protocol =
        window.location.protocol === "https:" || isProduction ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}`;

      console.log(`🔗 Connecting to: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("🟩  Koneksi ke WebSocket Server berhasil");
        this.updateStatus(true, "Connected");
        this.reconnectAttempts = 0;

        // Request device list
        this.ws.send(JSON.stringify({ type: "get_devices" }));

        // Request device list dari ESP32 juga
        setTimeout(() => {
          this.requestDeviceListFromESP32();
        }, 500);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Berhasil parsing message:", data);
          this.handleMessage(data);
        } catch (error) {
          console.log(`🟥  Terdapat error ketika parsing message: ${error}`);
        }
      };

      this.ws.onclose = () => {
        console.log("🟨  Koneksi ke WebSocket Server terputus");
        this.updateStatus(false, "Koneksi WebSocket Server terputus");
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.log(
          `🟥  Terdapat error ketika menghubungkan ke WebSocket Server: ${error}`
        );
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
      this.updateStatus(
        false,
        `Trying to connect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connectWebsocketServer();
      }, this.reconnectInterval);
    } else {
      this.updateStatus(false, "Cannot connect");
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        console.log(message.message);
        if (message.devices && message.devices.length > 0) {
          this.updateDeviceList(message.devices);
        }
        break;
      case "device_list":
        if (message.devices) {
          this.updateDeviceList(message.devices);
        }
        break;
      case "data":
        // Hanya update jika message dari device yang sedang dipilih
        if (
          message.brand === this.currentBrand &&
          message.deviceId === this.currentDeviceId
        ) {
          if (message.data && message.data.type === "data") {
            this.updateData(message.data, message.timestamp);
          }
        }
        // Update device list with new device
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
        // Hanya proses jika message dari device yang sedang dipilih
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
        break;
    }
  }

  handleCommandStatus(data) {
    console.log(
      `📥 Status perintah: ${data.status} untuk command: ${data.command}`
    );

    if (data.power_status !== undefined) {
      this.acPowerStatus = data.power_status;
      this.updatePowerDot(this.acPowerStatus);

      if (!this.acPowerStatus) {
        this.remoteTempValue = 18;
        this.updateRemoteTempDisplay();
      }
    }

    if (data.current_temp !== undefined) {
      this.remoteTempValue = data.current_temp;
      this.updateRemoteTempDisplay();
    }

    if (data.status === "success") {
      console.log(`✅ ${data.command} berhasil dieksekusi`);
    } else {
      console.log(`❌ ${data.command} gagal dieksekusi`);
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
    }
  }
}

document.addEventListener(
  "DOMContentLoaded",
  () => new AirConditionerMonitor()
);
