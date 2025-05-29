# 📞 VideoChat - Skype Clone

Un'applicazione di videochat moderna e completamente funzionante, simile a Skype, costruita con WebRTC, Socket.IO e tecnologie web moderne.

## ✨ Caratteristiche

- 🎥 **Videochiamate HD** - Video e audio di alta qualità
- 💬 **Chat in tempo reale** - Messaggi istantanei durante le chiamate
- 📱 **Responsive** - Funziona su desktop, tablet e smartphone
- 🏠 **Stanze private** - Crea stanze con ID personalizzati
- 🎛️ **Controlli completi** - On/off per video, audio e altre funzioni  
- 🔄 **Connessione automatica** - WebRTC peer-to-peer per performance ottimali
- 🎨 **Design moderno** - Interfaccia pulita e intuitiva

## 🚀 Installazione e Setup

### Prerequisiti
- Node.js (versione 14 o superiore)
- NPM o Yarn
- Browser moderno con supporto WebRTC

### Setup Locale

1. **Clona o scarica il progetto**
```bash
git clone <url-repository>
cd videochat-skype
```

2. **Installa le dipendenze**
```bash
npm install
```

3. **Avvia il server**
```bash
npm start
```

4. **Apri nel browser**
```
http://localhost:3000
```

### Deploy su Render

1. **Carica su GitHub**
   - Crea un nuovo repository su GitHub
   - Carica tutti i file del progetto

2. **Connetti a Render**
   - Vai su [render.com](https://render.com)
   - Crea nuovo "Web Service"
   - Connetti il tuo repository GitHub

3. **Configurazione Render**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`  
   - **Environment**: Node
   - Clicca "Deploy"

4. **Accedi alla tua app**
   - Render fornirà un URL tipo: `https://your-app-name.onrender.com`

## 📱 Come Usare

1. **Crea una stanza**
   - Inserisci un ID per la stanza (es: "mia-stanza-2024")
   - Inserisci il tuo nome
   - Clicca "Entra nella Stanza"

2. **Condividi l'ID**
   - Condividi l'ID della stanza con chi vuoi chiamare
   - L'altra persona deve entrare nella stessa stanza

3. **Inizia la videochiamata**
   - Entrambi permettete l'accesso a camera e microfono
   - La connessione si stabilirà automaticamente

4. **Usa i controlli**
   - 📹 **Video ON/OFF** - Attiva/disattiva la camera
   - 🎤 **Audio ON/OFF** - Attiva/disattiva il microfono
   - 💬 **Chat** - Messaggi in tempo reale
   - 🔲 **Schermo** - Modalità schermo intero
   - 📞 **Termina** - Chiudi la chiamata

## 🛠️ Tecnologie Utilizzate

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Video**: WebRTC
- **Styling**: CSS Grid, Flexbox, CSS Custom Properties
- **Responsive**: Mobile-first design

## 🔧 Struttura del Progetto

```
videochat-skype/
├── package.json          # Dipendenze e scripts
├── server.js            # Server Express + Socket.IO  
├── README.md            # Documentazione
└── public/              # File statici
    ├── index.html       # Interfaccia principale
    ├── style.css        # Stili CSS
    └── script.js        # Logica client-side
```

## 🌐 Compatibilità Browser

- ✅ Chrome 60+
- ✅ Firefox 55+  
- ✅ Safari 11+
- ✅ Edge 79+
- 📱 Safari Mobile
- 📱 Chrome Mobile

## 🔒 Sicurezza e Privacy

- Le videochiamate sono peer-to-peer (WebRTC)
- Nessun video/audio viene salvato sul server
- Comunicazione criptata end-to-end
- Server utilizzato solo per signaling iniziale

## 🐛 Risoluzione Problemi

### La camera/microfono non funziona
- Assicurati di permettere l'accesso quando richiesto
- Verifica che nessun'altra app stia usando camera/microfono
- Prova a ricaricare la pagina

### Non vedo l'altra persona
- Entrambi devono essere nella stessa stanza
- Verifica la connessione internet
- Alcuni firewall possono bloccare WebRTC

### Audio/video di bassa qualità
- Controlla la velocità della connessione internet
- Chiudi altre applicazioni che usano banda
- Prova a disattivare/riattivare video

## 📝 Personalizzazione

Puoi facilmente personalizzare:
- **Colori**: Modifica le variabili CSS in `style.css`
- **Layout**: Adatta la struttura in `index.html`
- **Funzionalità**: Aggiungi nuove feature in `script.js`
- **Server**: Estendi la logica in `server.js`

## 🤝 Contributi

Contributi benvenuti! Sentiti libero di:
- Segnalare bug
- Proporre nuove funzionalità
- Migliorare il codice
- Aggiornare la documentazione

## 📄 Licenza

MIT License - Vedi file LICENSE per dettagli.

---

💡 **Suggerimento**: Per la migliore esperienza, usa una connessione internet stabile e permetti sempre l'accesso a camera e microfono quando richiesto dal browser!