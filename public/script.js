// Variabili globali
let socket;
let localStream;
let remoteStream;
let peerConnection;
let currentRoomId;
let currentUserId;
let isVideoEnabled = true;
let isAudioEnabled = true;
let isChatOpen = false;

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
    });
    
    socket.on('disconnect', () => {
        updateConnectionStatus(false);
    });
    
    // Eventi WebRTC
    socket.on('user-connected', async (userId) => {
        showNotification(`👋 Utente connesso!`, 'success');
        hideWaitingMessage();
        await createPeerConnection();
        await createOffer();
    });
    
    socket.on('user-disconnected', (userId) => {
        showNotification(`👋 Utente disconnesso`, 'info');
        showWaitingMessage();
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
    });
    
    socket.on('offer', async (data) => {
        await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        await createAnswer();
    });
    
    socket.on('answer', async (data) => {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });
    
    socket.on('ice-candidate', async (data) => {
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
        updateRemoteVideoIndicator(data.videoEnabled);
    });
    
    socket.on('user-toggle-audio', (data) => {
        updateRemoteAudioIndicator(data.audioEnabled);
    });
}

// Setup Event Listeners
function setupEventListeners() {
    // Enter key per join room
    document.getElementById('roomInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    document.getElementById('userNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    // Enter key per chat
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        if (peerConnection) {
            peerConnection.close();
        }
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

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    // Aggiungi stream locale
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Gestisci stream remoto
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        remoteVideo.srcObject = remoteStream;
        hideWaitingMessage();
        showNotification('🎥 Videochiamata connessa!', 'success');
    };
    
    // Gestisci ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId: currentRoomId,
                candidate: event.candidate
            });
        }
    };
    
    // Gestisci stato connessione
    peerConnection.onconnectionstatechange = () => {
        console.log('Stato connessione:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected') {
            showWaitingMessage();
        }
    };
}

async function createOffer() {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('offer', {
        roomId: currentRoomId,
        offer: offer
    });
}

async function createAnswer() {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        roomId: currentRoomId,
        answer: answer
    });
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
            
            // Notifica agli altri utenti
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
            
            // Notifica agli altri utenti
            socket.emit('toggle-audio', {
                roomId: currentRoomId,
                audioEnabled: isAudioEnabled
            });
        }
    }
}

function endCall() {
    // Ferma tutti i tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Chiudi connessione peer
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Reset UI
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    // Torna alla schermata di join
    callSection.style.display = 'none';
    joinSection.style.display = 'flex';
    
    // Chiudi chat se aperta
    if (isChatOpen) {
        toggleChat();
    }
    
    // Reset variabili
    currentRoomId = null;
    isVideoEnabled = true;
    isAudioEnabled = true;
    
    showNotification('📞 Chiamata terminata', 'info');
}

// Funzioni chat
function toggleChat() {
    isChatOpen = !isChatOpen;
    chatSidebar.classList.toggle('open', isChatOpen);
    
    const btn = document.querySelector('[onclick="toggleChat()"]');
    btn.classList.toggle('active', isChatOpen);
}

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentRoomId) return;
    
    // Mostra il messaggio localmente
    displayChatMessage(message, 'Tu', new Date().toLocaleTimeString(), true);
    
    // Invia agli altri utenti
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
    
    // Mostra notifica se chat chiusa
    if (!isChatOpen && !isOwn) {
        showNotification(`💬 Nuovo messaggio da ${userId}`, 'info');
    }
}

// Funzioni utility
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

function updateRemoteVideoIndicator(enabled) {
    const indicator = document.getElementById('remoteVideoIndicator');
    indicator.classList.toggle('disabled', !enabled);
}

function updateRemoteAudioIndicator(enabled) {
    const indicator = document.getElementById('remoteAudioIndicator');
    indicator.classList.toggle('disabled', !enabled);
}