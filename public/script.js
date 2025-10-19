class AirConditionerMonitor {
    constructor() {
        this.ws = null;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000;
        this.reconnectAttempts = 0;
        this.acPowerStatus = false;
        this.remoteTempValue = 25;  // Default temperature
        this.minTemp = 16;  // Minimum AC temperature
        this.maxTemp = 30;  // Maximum AC temperature

        this.initializeElements();
        this.connectWebsocketServer();
    }

    initializeElements() {
        // status element
        this.statusText = document.getElementById('status-text');
        this.statusDot = document.getElementById('status-dot');
        this.topicText = document.getElementById('topic-text');
        this.powerDot = document.getElementById('power-dot');

        // value element
        this.tempValue = document.getElementById('temp-value');
        this.humidityValue = document.getElementById('humidity-value');
        this.remoteTempDisplay = document.getElementById('remote-temp-value');

        // control buttons
        this.acPowerToggle = document.getElementById('ac-power-toggle');
        this.tempUpBtn = document.getElementById('temp-up-btn');
        this.tempDownBtn = document.getElementById('temp-down-btn');

        // Setup event listeners
        this.setupControlButtons();
        
        // Set initial values
        this.updatePowerDot(false);
        this.updateRemoteTempDisplay();
    }

    setupControlButtons() {
        // Power Toggle Button
        if (this.acPowerToggle) {
            this.acPowerToggle.addEventListener('click', () => {
                this.toggleAcPower();
            });
        }

        // Temperature Up Button
        if (this.tempUpBtn) {
            this.tempUpBtn.addEventListener('click', () => {
                if (this.acPowerStatus) {  // Hanya bisa adjust suhu jika AC ON
                    this.incrementRemoteTemp();
                    this.sendCommand('TEMP_UP');
                } else {
                    console.log('⚠️  AC harus ON untuk mengubah suhu');
                    this.showTempWarning();
                }
            });
        }

        // Temperature Down Button
        if (this.tempDownBtn) {
            this.tempDownBtn.addEventListener('click', () => {
                if (this.acPowerStatus) {  // Hanya bisa adjust suhu jika AC ON
                    this.decrementRemoteTemp();
                    this.sendCommand('TEMP_DOWN');
                } else {
                    console.log('⚠️  AC harus ON untuk mengubah suhu');
                    this.showTempWarning();
                }
            });
        }
    }

    toggleAcPower() {
        // Toggle state
        this.acPowerStatus = !this.acPowerStatus;
        
        // Reset suhu ke 25°C saat AC dinyalakan
        if (this.acPowerStatus) {
            this.remoteTempValue = 25;
            this.updateRemoteTempDisplay();
            console.log('🔄 Suhu direset ke 25°C');
        }
        
        // Send appropriate command
        const command = this.acPowerStatus ? 'ON' : 'OFF';
        this.sendCommand(command);
        
        // Update UI immediately for better UX
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
            // Jika AC OFF, tampilkan dash
            if (!this.acPowerStatus) {
                this.remoteTempDisplay.textContent = '-';
                this.remoteTempDisplay.style.opacity = '0.3';
            } else {
                this.remoteTempDisplay.textContent = this.remoteTempValue;
                this.remoteTempDisplay.style.opacity = '1';
            }
        }
    }

    showTempWarning() {
        // Visual feedback - buat element berkedip
        if (this.acPowerToggle) {
            this.acPowerToggle.classList.add('animate-pulse');
            setTimeout(() => {
                this.acPowerToggle.classList.remove('animate-pulse');
            }, 1000);
        }
    }

    showMaxTempWarning() {
        // Visual feedback untuk max temp
        if (this.tempUpBtn) {
            this.tempUpBtn.style.opacity = '0.3';
            setTimeout(() => {
                this.tempUpBtn.style.opacity = '1';
            }, 500);
        }
    }

    showMinTempWarning() {
        // Visual feedback untuk min temp
        if (this.tempDownBtn) {
            this.tempDownBtn.style.opacity = '0.3';
            setTimeout(() => {
                this.tempDownBtn.style.opacity = '1';
            }, 500);
        }
    }

    updatePowerDot(isOn) {
        if (this.powerDot) {
            this.powerDot.className = `md:w-3 md:h-3 w-2 h-2 rounded-full ${isOn ? 'bg-green-online' : 'bg-red-offline'}`;
        }
        
        // Update remote temp display berdasarkan power status
        this.updateRemoteTempDisplay();
    }

    sendCommand(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const commandMessage = {
                type: 'perintah',
                command: command,
                temperature: this.remoteTempValue,  // Kirim suhu saat ini
                timestamp: new Date().toISOString()
            };
            
            try {
                this.ws.send(JSON.stringify(commandMessage));
                console.log(`🟦  Perintah '${command}' dengan suhu ${this.remoteTempValue}°C dikirim ke server`);
            } catch (error) {
                console.log(`🟥  Error mengirim perintah: ${error}`);
            }
        } else {
            console.log('🟥  WebSocket tidak terhubung, tidak dapat mengirim perintah');
            alert('❌ Tidak terhubung ke server!');
        }
    }

    connectWebsocketServer() {
        try {
            this.ws = new WebSocket(`ws://${window.location.host}`);

            this.ws.onopen = () => {
                console.log('🟩  Koneksi ke WebSocket Server berhasil')
                this.updateStatus(true, 'Connected');
                this.reconnectAttempts = 0;
            }

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('Berhasil parsing message')
                    this.handleMessage(data);
                } catch (error) {
                    console.log(`🟥  Terdapat error ketika parsing message: ${error}`);
                }
            }

            this.ws.onclose = () => {
                console.log('🟨  Koneksi ke WebSocket Server terputus');
                this.updateStatus(false, 'Koneksi WebSocket Server terputus');
                this.attemptReconnect();
            }

            this.ws.onerror = (error) => {
                console.log(`🟥  Terdapat error ketika menghubungkan ke WebSocket Server: ${error}`);
                this.updateStatus(false, 'Error');
            }
        } catch (error) {
            console.log(`🟥  Terdapat error : ${error}`)
        }
    }

    updateStatus(isOnline, statusText) {
        this.statusDot.className = `md:w-6 md:h-6 w-4 h-4 rounded-full ${isOnline ? 'bg-green-online' : 'bg-red-offline'}`;
        this.statusText.textContent = `${statusText}`
        this.statusText.className = `font-light`;
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.updateStatus(false, `Trying to connect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                this.connectWebsocketServer();
            }, this.reconnectInterval)
        } else {
            this.updateStatus(false, "Cannot connect");
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'welcome':
                console.log(message.message);
                this.updateTopic(message.topic)
                break;
            case 'data':
                if (message.data && message.data.type === 'data') {
                    this.updateData(message.data, message.timestamp);
                }
                break;
            case 'perintah_status':
                if (message.data && message.data.type === 'perintah_status') {
                    this.handleCommandStatus(message.data);
                }
                break;
            default:
                break;
        }
    }

    handleCommandStatus(data) {
        console.log(`📥 Status perintah: ${data.status} untuk command: ${data.command}`);
        
        // Update power status berdasarkan konfirmasi dari ESP32
        if (data.power_status !== undefined) {
            this.acPowerStatus = data.power_status;
            this.updatePowerDot(this.acPowerStatus);
            
            // Jika AC OFF dari ESP32, reset display
            if (!this.acPowerStatus) {
                this.remoteTempValue = 25;
                this.updateRemoteTempDisplay();
            }
        }
        
        // Sync suhu dari ESP32 jika ada
        if (data.current_temp !== undefined) {
            this.remoteTempValue = data.current_temp;
            this.updateRemoteTempDisplay();
        }
        
        // Optional: Show notification
        if (data.status === 'success') {
            console.log(`✅ ${data.command} berhasil dieksekusi`);
        } else {
            console.log(`❌ ${data.command} gagal dieksekusi`);
            alert(`⚠️ Perintah ${data.command} gagal!`);
        }
    }

    updateTopic(topicName) {
        if (this.topicText) {
            this.topicText.textContent = topicName;
        }
    }

    updateData(data, timestamp) {
        // Update temperature sensor
        if (data.temperature !== undefined) {
            this.tempValue.textContent = data.temperature.toFixed(1);
        }
        
        // Update humidity
        if (data.humidity !== undefined) {
            this.humidityValue.textContent = data.humidity.toFixed(1);
        }
        
        // Update power status dari ESP32
        if (data.power_status !== undefined) {
            this.acPowerStatus = data.power_status;
            this.updatePowerDot(this.acPowerStatus);
        }
        
        // Sync remote temp dari ESP32
        if (data.current_temp !== undefined) {
            this.remoteTempValue = data.current_temp;
            this.updateRemoteTempDisplay();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new AirConditionerMonitor());
