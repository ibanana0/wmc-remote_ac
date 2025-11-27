class AirConditionerMonitor {
  constructor() {
    this.ws = null;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 3000;
    this.reconnectAttempts = 0;
    this.acPowerStatus = false;
    
    // --- PERUBAHAN DISINI SESUAI KODE ARDUINO ---
    this.remoteTempValue = 18; // Default Start Temp (tengah-tengah)
    this.minTemp = 16;         // Batas Bawah
    this.maxTemp = 20;         // Batas Atas
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
        this.remoteTempValue = 18; // Reset ke 18 saat ganti device
        this.updatePowerDot(false);
        this.updateRemoteTempDisplay();
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

    // Simpan pilihan saat ini agar tidak reset visual selector jika data refresh
    const currentSelection = this.deviceSelector.value;
    
    this.deviceSelector.innerHTML = '<option value="">Select Device</option>';

    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = `${device.brand}|${device.deviceId}`;
      option.textContent = `${device.brand} - ${device.deviceId}`;
      this.deviceSelector.appendChild(option);
    });

    // Restore selection or Auto-select first
    if (currentSelection && devices.some(d => `${d.brand}|${d.deviceId}` === currentSelection)) {
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
        if (this.acPowerStatus) {
          if (this.remoteTempValue < this.maxTemp) {
             this.incrementRemoteTemp();
             this.sendCommand("TEMP_UP");
          } else {
             this.showMaxTempWarning();
          }
        } else {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
        }
      });
    }

    if (this.tempDownBtn) {
      this.tempDownBtn.addEventListener("click", () => {
        if (this.acPowerStatus) {
            if (this.remoteTempValue > this.minTemp) {
                this.decrementRemoteTemp();
                this.sendCommand("TEMP_DOWN");
            } else {
                this.showMinTempWarning();
            }
        } else {
          console.log("⚠️  AC harus ON untuk mengubah suhu");
          this.showTempWarning();
        }
      });
    }

    // Direct temperature input
    if (this.remoteTempDisplay) {
      this.remoteTempDisplay.addEventListener("click", () => {
        if (this.acPowerStatus) {
          const newTemp = prompt(
            `Set temperature (${this.minTemp}-${this.maxTemp}):`,
            this.remoteTempValue
          );
          if (newTemp !== null) {
            const temp = parseInt(newTemp);
            if (temp >= this.minTemp && temp <= this.maxTemp) {
              this.remoteTempValue = temp;
              this.updateRemoteTempDisplay();
              // Note: Karena ESP32 sekarang menggunakan logic Index berdasarkan tombol,
              // mengirim suhu langsung mungkin memerlukan penyesuaian di sisi ESP32 
              // jika ingin mendukung "SET_TEMP". 
              // Untuk saat ini kita kirim manual command atau simulasi loop di ESP.
              // Namun karena kode ESP32 Anda hanya support ON/OFF/UP/DOWN,
              // fitur ini hanya visual di web untuk saat ini.
            } else {
              alert(`Suhu harus antara ${this.minTemp} - ${this.maxTemp}`);
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
      this.remoteTempValue = 18; // Default start temp sesuai kode Arduino
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
    } 
  }

  decrementRemoteTemp() {
    if (this.remoteTempValue > this.minTemp) {
      this.remoteTempValue--;
      this.updateRemoteTempDisplay();
      console.log(`🔽 Suhu turun ke ${this.remoteTempValue}°C`);
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
        
        // Visual feedback jika mencapai batas
        if(this.remoteTempValue >= this.maxTemp) this.remoteTempDisplay.style.color = "#ef4444"; // Red
        else if(this.remoteTempValue <= this.minTemp) this.remoteTempDisplay.style.color = "#3b82f6"; // Blue
        else this.remoteTempDisplay.style.color = "white";
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
      }, 200);
    }
  }

  showMinTempWarning() {
    if (this.tempDownBtn) {
      this.tempDownBtn.style.opacity = "0.3";
      setTimeout(() => {
        this.tempDownBtn.style.opacity = "1";
      }, 200);
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
      } catch (error) {
        console.log(`🟥  Error mengirim perintah: ${error}`);
      }
    } else {
      alert("❌ Tidak terhubung ke server!");
    }
  }

  connectWebsocketServer() {
    try {
      this.ws = new WebSocket(`ws://${window.location.host}`);

      this.ws.onopen = () => {
        console.log("🟩  Koneksi ke WebSocket Server berhasil");
        this.updateStatus(true, "Connected");
        this.reconnectAttempts = 0;
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
      setTimeout(() => {
        this.connectWebsocketServer();
      }, this.reconnectInterval);
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
      case "device_list":
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
        // Update list if new device appears
        if (!this.availableDevices.find(d => d.brand === message.brand && d.deviceId === message.deviceId)) {
           this.availableDevices.push({ brand: message.brand, deviceId: message.deviceId });
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
    }
  }

  handleCommandStatus(data) {
    console.log(`📥 Status: ${data.status}, Command: ${data.command}, Power: ${data.power_status}, Temp: ${data.current_temp}`);

    // Sinkronisasi status Power dari ESP32
    if (data.power_status !== undefined) {
      this.acPowerStatus = data.power_status;
      this.updatePowerDot(this.acPowerStatus);
    }

    // Sinkronisasi Temperature dari ESP32 (Source of Truth)
    if (data.current_temp !== undefined) {
      this.remoteTempValue = data.current_temp;
      this.updateRemoteTempDisplay();
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
    }
  }
}

document.addEventListener("DOMContentLoaded", () => new AirConditionerMonitor());