class AirConditionerMonitor {
  constructor() {
    this.ws = null;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 3000;
    this.reconnectAttempts = 0;
    this.availableTopics = [];
    this.currentTopic = "temp";
    this.selectedTopic = "temp";

    this.initializeElements();
    this.connectWebsocketServer();
  }

  initializeElements() {
    // status element
    this.statusText = document.getElementById("status-text");
    this.statusDot = document.getElementById("status-dot");
    this.topicText = document.getElementById("topic-text");
    this.powerDot = document.getElementById("power-dot");

    // value element
    this.tempValue = document.getElementById("temp-value");
    this.humidityValue = document.getElementById("humidity-value");

    // topic management elements
    this.topicSelect = document.getElementById("topic-select");
    this.addTopicInput = document.getElementById("add-topic-input");
    this.addTopicBtn = document.getElementById("add-topic-btn");

    // control elements
    this.powerBtn = document.getElementById("power-btn");
    this.tempUpBtn = document.getElementById("temp-up-btn");
    this.tempDownBtn = document.getElementById("temp-down-btn");

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Topic selection
    if (this.topicSelect) {
      this.topicSelect.addEventListener("change", (e) => {
        this.selectedTopic = e.target.value;
        this.subscribeToTopic(this.selectedTopic);
      });
    }

    // Add topic
    if (this.addTopicBtn) {
      this.addTopicBtn.addEventListener("click", () => {
        this.addNewTopic();
      });
    }

    if (this.addTopicInput) {
      this.addTopicInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.addNewTopic();
        }
      });
    }

    // Control buttons
    if (this.powerBtn) {
      this.powerBtn.addEventListener("click", () =>
        this.sendControlMessage("power")
      );
    }
    if (this.tempUpBtn) {
      this.tempUpBtn.addEventListener("click", () =>
        this.sendControlMessage("temp_up")
      );
    }
    if (this.tempDownBtn) {
      this.tempDownBtn.addEventListener("click", () =>
        this.sendControlMessage("temp_down")
      );
    }
  }

  connectWebsocketServer() {
    try {
      this.ws = new WebSocket(`ws://${window.location.host}`); // samakan dengan yg di server.js

      // callback function ketika terhubung
      this.ws.onopen = () => {
        console.log("🟩  Koneksi ke WebSocket Server berhasil");
        this.updateStatus(true, "Connected");
        this.reconnectAttempts = 0;
      };

      // callback function ketika ada message
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data); // mengubah event.data menjadi object JSON
          console.log("Berhasil parsing message");
          this.handleMessage(data);
        } catch (error) {
          console.log(`🟥  Terdapat error ketika parsing message: ${error}`);
        }
      };

      // callback function ketika menutup koneksi
      this.ws.onclose = () => {
        console.log("🟨  Koneksi ke WebSocket Server terputus");
        this.updateStatus(false, "Koneksi WebSocket Server terputus");
        this.attemptReconnect();
      };

      // callback function ketika ada error
      this.ws.onerror = (error) => {
        if (error.code === "ECONNRESET") {
          console.log(
            "🟥  Client terhubung, tetapi tidak ada respons dari WebSocket Server"
          );
        } else {
          console.log(
            `🟥  Terdapat error ketika menghubungkan ke WebSocket Server: ${error}`
          );
        }
        this.updateStatus(false, "Error");
      };
    } catch (error) {
      if (error.code === "ECONNREFUSED") {
        console.log("🟥  WebSocket Server tidak dapat diakses");
      } else {
        console.log(`🟥  Terdapat error : ${error}`);
      }
    }
  }

  updateStatus(isOnline, statusText) {
    this.statusDot.className = `md:w-6 md:h-6 w-4 h-4 rounded-full ${
      isOnline ? "bg-green-online" : "bg-red-offline"
    }`;
    this.statusText.textContent = `${statusText}`;
    this.statusText.className = `font-light`;
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.updateStatus(
        false,
        `Trying to connect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectInterval);
    } else {
      this.updateStatus(false, "Cannot connect");
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        console.log("🎉  " + message.message);
        this.updateTopic(message.topic);
        this.updateTopicList(message.availableTopics);
        this.subscribeToTopic(this.currentTopic);
        break;
      case "data_monitor":
        this.updateData(message.data, message.timestamp);
        break;
      case "subscribe_success":
        console.log(`✅  Successfully subscribed to: ${message.topic}`);
        this.currentTopic = message.topic;
        this.updateTopic(message.topic);
        break;
      case "topic_list_update":
        this.updateTopicList(message.availableTopics);
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

  updateTopicList(topics) {
    this.availableTopics = topics;
    if (this.topicSelect) {
      this.topicSelect.innerHTML = "";
      topics.forEach((topic) => {
        const option = document.createElement("option");
        option.value = topic;
        option.textContent = topic;
        if (topic === this.currentTopic) {
          option.selected = true;
        }
        this.topicSelect.appendChild(option);
      });
    }
  }

  // ws message buat subscribe topik
  subscribeToTopic(topic) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        action: "subscribe",
        topic: topic,
      };
      this.ws.send(JSON.stringify(message));
      console.log(`🔔  Subscribing to topic: ${topic}`);
    }
  }

  // ws message buat nambah topik baru
  addNewTopic() {
    const newTopic = this.addTopicInput?.value.trim();
    if (newTopic && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        action: "add_topic",
        topic: newTopic,
      };
      this.ws.send(JSON.stringify(message));
      this.addTopicInput.value = "";
      console.log(`➕  Adding new topic: ${newTopic}`);
    }
  }

  sendControlMessage(action) {
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.selectedTopic
    ) {
      const controlData = {
        action: action,
        timestamp: new Date().toISOString(),
        // Data buat nanti kode kode buat kontrol tombol ac nyha
      };

      const message = {
        action: "publish",
        topic: this.selectedTopic,
        message: controlData,
      };

      this.ws.send(JSON.stringify(message));
      console.log(`🎮  Sent ${action} to topic: ${this.selectedTopic}`);
    }
  }
}

document.addEventListener(
  "DOMContentLoaded",
  () => new AirConditionerMonitor()
);
