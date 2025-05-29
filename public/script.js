// Variabili globali
let socket;
let localStream;
let currentRoomId;
let currentUserId;
let currentUserName;
let isVideoEnabled = true;
let isAudioEnabled = true;
let isChatOpen = false;

// Mappa delle connessioni peer (socketId -> RTCPeerConnection)
const peerConnections = new Map();
// Mappa degli stream remoti (socketId -> MediaStream)
const remoteStreams = new Map();
// Mappa degli utenti connessi (socketId -> userData)
const connectedUsers = new Map();

// Configurazione WebRTC
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.relay.metered.ca:80' }
    ]
};

// Elementi DOM
const joinSection = document.getElementById('joinSection');
const callSection = document.getElementById('callSection');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const connectionStatus = document.getElementById('connectionStatus');
const waitingMessage = document.getElementById('waitingMessage');
const chatSidebar = document.getElementById('chatSidebar');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const notification = document.getElementById('notification');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    initializeSocketConnection();
    setupEventListeners();
});

// Connessione Socket.IO
function initializeSocketConnection() {
    socket = io();
    
    socket.on('connect', () => {
        updateConnectionStatus(true);
        currentUserId = socket.id;
        console.log('🔌 Connesso con ID:', currentUserId);
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        // Pulisci tutte le connessioni peer
        cleanupAllPeerConnections();
    });
    
    // Eventi WebRTC migliorati
    socket.on('existing-users', (users) => {
        console.log('👥 Utenti esistenti nella stanza:', users);
        hideWaitingMessage();
        
        // Crea connessioni peer con tutti gli utenti esistenti
        users.forEach(user => {
            addUserToInterface(user);
            createPeerConnection(user.socketId, true); // true = siamo noi a iniziare
        });
    });
    
    socket.on('user-connected', (userData) => {
        console.log('👋 Nuovo utente connesso:', userData);
        showNotification(`👋 ${userData.userName} si è unito!`, 'success');
        hideWaitingMessage();
        
        addUserToInterface(userData);
        createPeerConnection(userData.socketId, false); // false = aspettiamo l'offer
    });
    
    socket.on('user-disconnected', (userData) => {
        console.log('👋 Utente disconnesso:', userData);
        showNotification(`👋 ${userData.userName} ha lasciato la chiamata`, 'info');
        
        removeUserFromInterface(userData.socketId);
        closePeerConnection(userData.socketId);
        
        // Se non ci sono più utenti, mostra messaggio di attesa
        if (connectedUsers.size === 0) {
            showWaitingMessage();
        }
    });
    
    socket.on('offer', async (data) => {
        console.log('📥 Ricevuto offer da:', data.fromUserName);
        const peerConnection = peerConnections.get(data.fromSocketId);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            await createAnswer(data.fromSocketId);
        }
    });
    
    socket.on('answer', async (data) => {
        console.log('📥 Ricevuto answer da:', data.fromUserName);
        const peerConnection = peerConnections.get(data.fromSocketId);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
    
    socket.on('ice-candidate', async (data) => {
        const peerConnection = peerConnections.get(data.fromSocketId);
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });
    
    // Eventi chat
    socket.on('chat-message', (data) => {
        displayChatMessage(data.message, data.userId, data.timestamp, false);
    });
    
    // Eventi controlli
    socket.on('user-toggle-video', (data) => {
        updateUserVideoStatus(data.socketId, data.videoEnabled);
    });
    
    socket.on('user-toggle-audio', (data) => {
        updateUserAudioStatus(data.socketId, data.audioEnabled);
    });
}

// Gestione interfaccia utenti
function addUserToInterface(userData) {
    connectedUsers.set(userData.socketId, userData);
    updateUsersDisplay();
}

function removeUserFromInterface(socketId) {
    connectedUsers.delete(socketId);
    updateUsersDisplay();
}

function updateUsersDisplay() {
    // Aggiorna il display dei video remoti
    // Per semplicità, mostriamo solo il primo utente nel video principale
    const users = Array.from(connectedUsers.values());
    const remoteUserName = document.getElementById('remoteUserName');
    
    if (users.length > 0) {
        remoteUserName.textContent = users.length === 1 ? 
            users[0].userName : 
            `${users[0].userName} +${users.length - 1} altri`;
    } else {
        remoteUserName.textContent = 'In attesa...';
    }
}

// Gestione connessioni WebRTC
async function createPeerConnection(remoteSocketId, shouldCreateOffer) {
    console.log(`🔗 Creando connessione peer con ${remoteSocketId}, offer: ${shouldCreateOffer}`);
    
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections.set(remoteSocketId, peerConnection);
    
    // Aggiungi stream locale se disponibile
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Gestisci stream remoto
    peerConnection.ontrack = (event) => {
        console.log('🎥 Ricevuto stream remoto da:', remoteSocketId);
        const remoteStream = event.streams[0];
        remoteStreams.set(remoteSocketId, remoteStream);
        
        // Mostra il primo stream remoto nel video principale
        if (remoteStreams.size === 1) {
            remoteVideo.srcObject = remoteStream;
            hideWaitingMessage();
        }
        
        showNotification('🎥 Videochiamata connessa!', 'success');
    };
    
    // Gestisci ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId: currentRoomId,
                targetSocketId: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // Gestisci stato connessione
    peerConnection.onconnectionstatechange = () => {
        console.log(`Stato connessione con ${remoteSocketId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            closePeerConnection(remoteSocketId);
        }
    };
    
    // Crea offer se richiesto
    if (shouldCreateOffer) {
        await createOffer(remoteSocketId);
    }
}

async function createOffer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
    console.log('📤 Creando offer per:', targetSocketId);
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('offer', {
        roomId: currentRoomId,
        targetSocketId: targetSocketId,
        offer: offer
    });
}

async function createAnswer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
    console.log('📤 Creando answer per:', targetSocketId);
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        roomId: currentRoomId,
        targetSocketId: targetSocketId,
        answer: answer
    });
}

function closePeerConnection(socketId) {
    const peerConnection = peerConnections.get(socketId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(socketId);
    }
    
    // Rimuovi stream remoto
    remoteStreams.delete(socketId);
    
    // Se era l'unico stream, pulisci il video
    if (remoteStreams.size === 0) {
        remoteVideo.srcObject = null;
        showWaitingMessage();
    } else {
        // Mostra il prossimo stream disponibile
        const firstStream = remoteStreams.values().next().value;
        if (firstStream) {
            remoteVideo.srcObject = firstStream;
        }
    }
}

function cleanupAllPeerConnections() {
    peerConnections.forEach((pc, socketId) => {
        pc.close();
    });
    peerConnections.clear();
    remoteStreams.clear();
    connectedUsers.clear();
}

// Setup Event Listeners
function setupEventListeners() {
    document.getElementById('roomInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    document.getElementById('userNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    window.addEventListener('beforeunload', () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        cleanupAllPeerConnections();
    });
}

// Funzioni principali
async function joinRoom() {
    const roomInput = document.getElementById('roomInput');
    const userNameInput = document.getElementById('userNameInput');
    const roomId = roomInput.value.trim();
    const userName = userNameInput.value.trim();
    
    if (!roomId) {
        showNotification('⚠️ Inserisci l\'ID della stanza!', 'error');
        return;
    }
    
    if (!userName) {
        showNotification('⚠️ Inserisci il tuo nome!', 'error');
        return;
    }
    
    try {
        currentRoomId = roomId;
        currentUserName = userName;
        
        // Ottieni stream locale
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        localVideo.srcObject = localStream;
        
        // Unisciti alla stanza
        socket.emit('join-room', roomId, userName);
        
        // Mostra sezione chiamata
        joinSection.style.display = 'none';
        callSection.style.display = 'flex';
        
        // Aggiorna UI
        document.getElementById('currentRoomId').textContent = roomId;
        showNotification(`🏠 Connesso alla stanza: ${roomId}`, 'success');
        showWaitingMessage();
        
    } catch (error) {
        console.error('Errore nell\'entrare nella stanza:', error);
        showNotification('❌ Errore nell\'accedere a camera/microfono. Assicurati di dare i permessi.', 'error');
    }
}

// Controlli video/audio
function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isVideoEnabled = videoTrack.enabled;
            
            const btn = document.getElementById('toggleVideoBtn');
            btn.classList.toggle('disabled', !isVideoEnabled);
            
            updateLocalVideoIndicator(isVideoEnabled);
            
            socket.emit('toggle-video', {
                roomId: currentRoomId,
                videoEnabled: isVideoEnabled
            });
        }
    }
}

function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isAudioEnabled = audioTrack.enabled;
            
            const btn = document.getElementById('toggleAudioBtn');
            btn.classList.toggle('disabled', !isAudioEnabled);
            
            updateLocalAudioIndicator(isAudioEnabled);
            
            socket.emit('toggle-audio', {
                roomId: currentRoomId,
                audioEnabled: isAudioEnabled
            });
        }
    }
}

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    cleanupAllPeerConnections();
    
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    callSection.style.display = 'none';
    joinSection.style.display = 'flex';
    
    if (isChatOpen) {
        toggleChat();
    }
    
    currentRoomId = null;
    currentUserName = null;
    isVideoEnabled = true;
    isAudioEnabled = true;
    
    showNotification('📞 Chiamata terminata', 'info');
}

// Funzioni chat (invariate)
function toggleChat() {
    isChatOpen = !isChatOpen;
    chatSidebar.classList.toggle('open', isChatOpen);
    
    const btn = document.querySelector('[onclick="toggleChat()"]');
    btn.classList.toggle('active', isChatOpen);
}

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentRoomId) return;
    
    displayChatMessage(message, 'Tu', new Date().toLocaleTimeString(), true);
    
    socket.emit('chat-message', {
        roomId: currentRoomId,
        message: message,
        userId: currentUserId
    });
    
    chatInput.value = '';
}

function displayChatMessage(message, userId, timestamp, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;
    
    messageDiv.innerHTML = `
        <div style="font-size: 0.8em; opacity: 0.7; margin-bottom: 0.25rem;">
            ${userId} • ${timestamp}
        </div>
        <div>${message}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (!isChatOpen && !isOwn) {
        showNotification(`💬 Nuovo messaggio da ${userId}`, 'info');
    }
}

// Funzioni utility (invariate)
function generateRoomId() {
    const adjectives = ['blu', 'rosso', 'verde', 'giallo', 'viola', 'arancione'];
    const nouns = ['casa', 'stanza', 'posto', 'spazio', 'luogo', 'mondo'];
    const numbers = Math.floor(Math.random() * 1000);
    
    const roomId = `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${numbers}`;
    document.getElementById('roomInput').value = roomId;
}

function copyRoomId() {
    if (currentRoomId) {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            showNotification('📋 ID stanza copiato!', 'success');
        });
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('Errore fullscreen:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// Funzioni UI
function updateConnectionStatus(connected) {
    const statusIndicator = connectionStatus.querySelector('.status-indicator');
    const statusText = connectionStatus.querySelector('.status-text');
    
    if (connected) {
        statusIndicator.className = 'status-indicator online';
        statusText.textContent = 'Online';
    } else {
        statusIndicator.className = 'status-indicator offline';
        statusText.textContent = 'Offline';
    }
}

function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification show${type === 'error' ? ' error' : ''}`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 4000);
}

function showWaitingMessage() {
    waitingMessage.style.display = 'block';
}

function hideWaitingMessage() {
    waitingMessage.style.display = 'none';
}

function updateLocalVideoIndicator(enabled) {
    const indicator = document.getElementById('localVideoIndicator');
    indicator.classList.toggle('disabled', !enabled);
}

function updateLocalAudioIndicator(enabled) {
    const indicator = document.getElementById('localAudioIndicator');
    indicator.classList.toggle('disabled', !enabled);
}

function updateUserVideoStatus(socketId, enabled) {
    const user = connectedUsers.get(socketId);
    if (user) {
        user.videoEnabled = enabled;
        // Se è l'utente principale mostrato, aggiorna l'indicatore
        const indicator = document.getElementById('remoteVideoIndicator');
        indicator.classList.toggle('disabled', !enabled);
    }
}

function updateUserAudioStatus(socketId, enabled) {
    const user = connectedUsers.get(socketId);
    if (user) {
        user.audioEnabled = enabled;
        // Se è l'utente principale mostrato, aggiorna l'indicatore  
        const indicator = document.getElementById('remoteAudioIndicator');
        indicator.classList.toggle('disabled', !enabled);
    }
}