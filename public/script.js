class AirConditionerMonitor {
    constructor() {
        this.ws = null;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000;
        this.reconnectAttempts = 0;

        this.initializeElements();
        this.connectWebsocketServer();
    }

    initializeElements() {
        // status element
        this.statusText = document.getElementById('status-text');
        this.statusDot = document.getElementById('status-dot');
        this.topicText = document.getElementById('topic-text');
        this.powerDot = document.getElementById('power-dot');   // buat fungsi powerStatusUpdate dan powerHandler

        // value element
        this.tempValue = document.getElementById('temp-value');
        this.humidityValue = document.getElementById('humidity-value');

    }

    connectWebsocketServer() {
        try {
            this.ws = new WebSocket(`ws://${window.location.host}`);    // samakan dengan yg di server.js

            // callback function ketika terhubung
            this.ws.onopen = () => {
                console.log('🟩  Koneksi ke WebSocket Server berhasil')
                this.updateStatus(true, 'Connected');
                this.reconnectAttempts = 0;
            }

            // callback function ketika ada message
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);   // mengubah event.data menjadi object JSON
                    console.log('Berhasil parsing message')
                    this.handleMessage(data);
                } catch (error) {
                    console.log(`🟥  Terdapat error ketika parsing message: ${error}`);
                }
            }

            // callback function ketika menutup koneksi
            this.ws.onclose = () => {
                console.log('🟨  Koneksi ke WebSocket Server terputus');
                this.updateStatus(false, 'Koneksi WebSocket Server terputus');
                this.attemptReconnect();
            }

            // callback function ketika ada error
            this.ws.onerror = (error) => {
                if (error.code === 'ECONNRESET') {
                    console.log('🟥  Client terhubung, tetapi tidak ada respons dari WebSocket Server');
                } else {
                    console.log(`🟥  Terdapat error ketika menghubungkan ke WebSocket Server: ${error}`);
                }
                this.updateStatus(false, 'Error');
            }
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.log('🟥  WebSocket Server tidak dapat diakses');
            } else {
                console.log(`🟥  Terdapat error : ${error}`)
            }
        }
    }

    updateStatus(isOnline, statusText) {
        this.statusDot.className = `md:w-6 md:h-6 w-4 h-4 rounded-full ${isOnline ? 'bg-green-online' : 'bg-red-offline'}`;
        this.statusText.textContent = `${statusText}`
        this.statusText.className = `font-light`;
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts ++;
            this.updateStatus(false, `Trying to connect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                this.connect();
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
            case 'data_monitor':
                this.updateData(message.data, message.timestamp);
                break;
            default:
                break;
        }
    }

    updateTopic(topicName) {
        if (this.topicText) {
            this.topicText.textContent = topicName;
        }
    }

    updateData(data, timestamp) {
        // update values
        this.tempValue.textContent = data.temperature.toFixed(2);
        this.humidityValue.textContent = data.humidity.toFixed(2);
    }
}

document.addEventListener('DOMContentLoaded', () => new AirConditionerMonitor());