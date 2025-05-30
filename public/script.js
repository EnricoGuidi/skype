// Variabili globali
let socket;
let localStream;
let screenStream;
let currentRoomId;
let currentUserId;
let currentUserName;
let isVideoEnabled = true;
let isAudioEnabled = true;
let isChatOpen = false;
let isParticipantsPanelOpen = false;
let isScreenSharing = false;
let unreadMessages = 0;

// Mappa delle connessioni peer (socketId -> RTCPeerConnection)
const peerConnections = new Map();
// Mappa degli stream remoti (socketId -> MediaStream)
const remoteStreams = new Map();
// Mappa degli utenti connessi (socketId -> userData)
const connectedUsers = new Map();
// Mappa degli elementi video (socketId -> videoElement)
const videoElements = new Map();

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
const videosGrid = document.getElementById('videosGrid');
const connectionStatus = document.getElementById('connectionStatus');
const chatSidebar = document.getElementById('chatSidebar');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const notification = document.getElementById('notification');
const participantsPanel = document.getElementById('participantsPanel');
const participantsList = document.getElementById('participantsList');
const participantCount = document.getElementById('participantCount');
const participantsBadge = document.getElementById('participantsBadge');
const chatBadge = document.getElementById('chatBadge');

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
        cleanupAllPeerConnections();
    });
    
    // Eventi WebRTC multi-utente
    socket.on('existing-users', async (users) => {
        console.log('👥 Utenti esistenti nella stanza:', users);
        
        // Aspetta un momento per assicurarsi che lo stream locale sia pronto
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Crea connessioni peer con tutti gli utenti esistenti
        for (const user of users) {
            addUserToInterface(user);
            await createPeerConnection(user.socketId, true);
        }
        
        updateParticipantsCount();
    });
    
    socket.on('user-connected', async (userData) => {
        console.log('👋 Nuovo utente connesso:', userData);
        showNotification(`👋 ${userData.userName} si è unito!`, 'success');
        
        addUserToInterface(userData);
        
        // Aspetta un momento prima di creare la connessione
        await new Promise(resolve => setTimeout(resolve, 500));
        await createPeerConnection(userData.socketId, false);
        
        updateParticipantsCount();
    });
    
    socket.on('user-disconnected', (userData) => {
        console.log('👋 Utente disconnesso:', userData);
        showNotification(`👋 ${userData.userName} ha lasciato la chiamata`, 'info');
        
        removeUserFromInterface(userData.socketId);
        closePeerConnection(userData.socketId);
        updateParticipantsCount();
    });
    
    socket.on('offer', async (data) => {
        console.log('📥 Ricevuto offer da:', data.fromUserName);
        
        let peerConnection = peerConnections.get(data.fromSocketId);
        if (!peerConnection) {
            // Crea la peer connection se non esiste
            await createPeerConnection(data.fromSocketId, false);
            peerConnection = peerConnections.get(data.fromSocketId);
        }
        
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
        if (peerConnection && data.candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (error) {
                console.error('Errore aggiunta ICE candidate:', error);
            }
        }
    });
    
    // Eventi chat
    socket.on('chat-message', (data) => {
        displayChatMessage(data.message, data.userName, data.timestamp, false);
        if (!isChatOpen) {
            unreadMessages++;
            updateChatBadge();
        }
    });
    
    // Eventi controlli
    socket.on('user-toggle-video', (data) => {
        updateUserVideoStatus(data.socketId, data.videoEnabled);
    });
    
    socket.on('user-toggle-audio', (data) => {
        updateUserAudioStatus(data.socketId, data.audioEnabled);
    });
    
    // Screen sharing
    socket.on('user-screen-share', (data) => {
        updateUserScreenShare(data.socketId, data.isSharing);
    });
}

// Gestione interfaccia utenti multi-utente
function addUserToInterface(userData) {
    connectedUsers.set(userData.socketId, userData);
    
    // Crea elemento video per l'utente
    createVideoElement(userData.socketId, userData.userName);
    
    // Aggiungi alla lista partecipanti
    addParticipantToList(userData);
}

function removeUserFromInterface(socketId) {
    connectedUsers.delete(socketId);
    
    // Rimuovi elemento video
    removeVideoElement(socketId);
    
    // Rimuovi dalla lista partecipanti
    removeParticipantFromList(socketId);
}

// Creazione dinamica elementi video
function createVideoElement(socketId, userName) {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    videoItem.id = `video-container-${socketId}`;
    
    const video = document.createElement('video');
    video.id = `video-${socketId}`;
    video.autoplay = true;
    video.playsInline = true;
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
        <span class="video-label">${userName}</span>
        <div class="video-controls-overlay">
            <span class="control-indicator" id="video-indicator-${socketId}">📹</span>
            <span class="control-indicator" id="audio-indicator-${socketId}">🎤</span>
            <span class="screen-indicator" id="screen-indicator-${socketId}" style="display: none;">🖥️</span>
        </div>
    `;
    
    videoItem.appendChild(video);
    videoItem.appendChild(overlay);
    
    // Aggiungi al grid
    videosGrid.appendChild(videoItem);
    
    // Salva riferimento
    videoElements.set(socketId, video);
    
    // Aggiorna layout grid
    updateVideoGrid();
}

function removeVideoElement(socketId) {
    const container = document.getElementById(`video-container-${socketId}`);
    if (container) {
        container.remove();
    }
    videoElements.delete(socketId);
    updateVideoGrid();
}

// Aggiorna layout video grid in base al numero di partecipanti
function updateVideoGrid() {
    const totalVideos = videosGrid.children.length;
    
    // Reset delle classi
    videosGrid.className = 'videos-grid';
    
    // Applica layout appropriato
    if (totalVideos === 1) {
        videosGrid.classList.add('single');
    } else if (totalVideos === 2) {
        videosGrid.classList.add('two');
    } else if (totalVideos <= 4) {
        videosGrid.classList.add('four');
    } else if (totalVideos <= 6) {
        videosGrid.classList.add('six');
    } else if (totalVideos <= 9) {
        videosGrid.classList.add('nine');
    } else {
        videosGrid.classList.add('many');
    }
}

// Gestione lista partecipanti
function addParticipantToList(userData) {
    const participantItem = document.createElement('div');
    participantItem.className = 'participant-item';
    participantItem.id = `participant-${userData.socketId}`;
    participantItem.innerHTML = `
        <div class="participant-avatar">👤</div>
        <div class="participant-info">
            <div class="participant-name">${userData.userName}</div>
            <div class="participant-status">
                <span class="status-icon ${userData.videoEnabled ? '' : 'disabled'}" id="participant-video-${userData.socketId}">📹</span>
                <span class="status-icon ${userData.audioEnabled ? '' : 'disabled'}" id="participant-audio-${userData.socketId}">🎤</span>
            </div>
        </div>
    `;
    
    participantsList.appendChild(participantItem);
}

function removeParticipantFromList(socketId) {
    const participant = document.getElementById(`participant-${socketId}`);
    if (participant) {
        participant.remove();
    }
}

function updateParticipantsCount() {
    const count = connectedUsers.size + 1; // +1 per includere se stessi
    participantCount.textContent = count;
    participantsBadge.textContent = count;
}

// Gestione connessioni WebRTC multi-utente
async function createPeerConnection(remoteSocketId, shouldCreateOffer) {
    console.log(`🔗 Creando connessione peer con ${remoteSocketId}, offer: ${shouldCreateOffer}`);
    
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections.set(remoteSocketId, peerConnection);
    
    // Aggiungi stream locale se presente
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`📤 Aggiunto track ${track.kind} alla peer connection ${remoteSocketId}`);
        });
    }
    
    // Aggiungi screen share se attivo
    if (screenStream && isScreenSharing) {
        screenStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, screenStream);
        });
    }
    
    // Gestisci stream remoto
    peerConnection.ontrack = (event) => {
        console.log('🎥 Ricevuto stream remoto da:', remoteSocketId);
        console.log('Track ricevuto:', event.track.kind);
        
        const remoteStream = event.streams[0];
        if (remoteStream) {
            remoteStreams.set(remoteSocketId, remoteStream);
            
            // Assegna stream al video element
            const videoElement = videoElements.get(remoteSocketId);
            if (videoElement) {
                videoElement.srcObject = remoteStream;
                console.log(`✅ Stream assegnato al video element ${remoteSocketId}`);
            } else {
                console.error(`❌ Video element non trovato per ${remoteSocketId}`);
            }
        }
        
        // Prima connessione stabilita
        if (remoteStreams.size === 1) {
            showNotification('🎥 Videochiamata connessa!', 'success');
        }
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
        if (peerConnection.connectionState === 'failed') {
            closePeerConnection(remoteSocketId);
            setTimeout(() => createPeerConnection(remoteSocketId, true), 3000);
        }
    };
    
    // Gestisci stato ICE
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`Stato ICE con ${remoteSocketId}:`, peerConnection.iceConnectionState);
    };
    
    // Crea offer se richiesto
    if (shouldCreateOffer) {
        await createOffer(remoteSocketId);
    }
    
    return peerConnection;
}

async function createOffer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
    console.log('📤 Creando offer per:', targetSocketId);
    
    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: true
        });
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            roomId: currentRoomId,
            targetSocketId: targetSocketId,
            offer: offer
        });
    } catch (error) {
        console.error('Errore creazione offer:', error);
    }
}

async function createAnswer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
    console.log('📤 Creando answer per:', targetSocketId);
    
    try {
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        javascript       socket.emit('answer', {
            roomId: currentRoomId,
            targetSocketId: targetSocketId,
            answer: answer
        });
    } catch (error) {
        console.error('Errore creazione answer:', error);
    }
 }
 
 function closePeerConnection(socketId) {
    const peerConnection = peerConnections.get(socketId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(socketId);
    }
    
    remoteStreams.delete(socketId);
 }
 
 function cleanupAllPeerConnections() {
    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();
    remoteStreams.clear();
    connectedUsers.clear();
    
    // Rimuovi tutti i video remoti
    const remoteVideos = document.querySelectorAll('.video-item:not(.local-video-item)');
    remoteVideos.forEach(video => video.remove());
    
    updateVideoGrid();
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
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        cleanupAllPeerConnections();
    });
    
    // Gestione resize per adattare il layout
    window.addEventListener('resize', () => {
        updateVideoGrid();
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
        
        // Ottieni stream locale PRIMA di unirsi alla stanza
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
        
        // Mostra sezione chiamata
        joinSection.style.display = 'none';
        callSection.style.display = 'flex';
        
        // Aggiorna UI
        document.getElementById('currentRoomId').textContent = roomId;
        
        // Aggiungi se stesso alla lista partecipanti
        addParticipantToList({
            socketId: 'local',
            userName: userName + ' (Tu)',
            videoEnabled: true,
            audioEnabled: true
        });
        
        updateParticipantsCount();
        
        // Aspetta che lo stream sia completamente inizializzato
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // ORA unisciti alla stanza
        socket.emit('join-room', roomId, userName);
        
        showNotification(`🏠 Connesso alla stanza: ${roomId}`, 'success');
        
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
            updateParticipantStatus('local', 'video', isVideoEnabled);
            
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
            updateParticipantStatus('local', 'audio', isAudioEnabled);
            
            socket.emit('toggle-audio', {
                roomId: currentRoomId,
                audioEnabled: isAudioEnabled
            });
        }
    }
 }
 
 // Screen sharing
 async function toggleScreenShare() {
    const btn = document.getElementById('screenShareBtn');
    
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            
            isScreenSharing = true;
            btn.classList.add('active');
            
            // Sostituisci video track in tutte le connessioni
            const videoTrack = screenStream.getVideoTracks()[0];
            peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
            
            // Mostra preview locale dello schermo
            localVideo.srcObject = screenStream;
            
            // Gestisci fine condivisione
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
            socket.emit('screen-share', {
                roomId: currentRoomId,
                isSharing: true
            });
            
            showNotification('🖥️ Condivisione schermo attiva', 'success');
            
        } catch (error) {
            console.error('Errore condivisione schermo:', error);
            showNotification('❌ Impossibile condividere lo schermo', 'error');
        }
    } else {
        stopScreenShare();
    }
 }
 
 function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    const btn = document.getElementById('screenShareBtn');
    btn.classList.remove('active');
    
    // Ripristina video camera
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        peerConnections.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
            }
        });
        
        localVideo.srcObject = localStream;
    }
    
    socket.emit('screen-share', {
        roomId: currentRoomId,
        isSharing: false
    });
 }
 
 function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    cleanupAllPeerConnections();
    
    localVideo.srcObject = null;
    
    callSection.style.display = 'none';
    joinSection.style.display = 'flex';
    
    if (isChatOpen) {
        toggleChat();
    }
    
    if (isParticipantsPanelOpen) {
        toggleParticipants();
    }
    
    // Reset partecipanti
    participantsList.innerHTML = '';
    
    currentRoomId = null;
    currentUserName = null;
    isVideoEnabled = true;
    isAudioEnabled = true;
    isScreenSharing = false;
    unreadMessages = 0;
    
    showNotification('📞 Chiamata terminata', 'info');
 }
 
 // Funzioni pannello partecipanti
 function toggleParticipants() {
    isParticipantsPanelOpen = !isParticipantsPanelOpen;
    participantsPanel.classList.toggle('open', isParticipantsPanelOpen);
    
    const btn = document.querySelector('[onclick="toggleParticipants()"]');
    btn.classList.toggle('active', isParticipantsPanelOpen);
 }
 
 // Funzioni chat
 function toggleChat() {
    isChatOpen = !isChatOpen;
    chatSidebar.classList.toggle('open', isChatOpen);
    
    const btn = document.querySelector('[onclick="toggleChat()"]');
    btn.classList.toggle('active', isChatOpen);
    
    if (isChatOpen) {
        unreadMessages = 0;
        updateChatBadge();
    }
 }
 
 function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentRoomId) return;
    
    displayChatMessage(message, 'Tu', new Date().toLocaleTimeString(), true);
    
    socket.emit('chat-message', {
        roomId: currentRoomId,
        message: message,
        userName: currentUserName
    });
    
    chatInput.value = '';
 }
 
 function displayChatMessage(message, userName, timestamp, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-user">${userName}</span>
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="message-text">${escapeHtml(message)}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (!isChatOpen && !isOwn) {
        showNotification(`💬 ${userName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`, 'info');
    }
 }
 
 function updateChatBadge() {
    const badge = document.getElementById('chatBadge');
    if (unreadMessages > 0) {
        badge.textContent = unreadMessages > 99 ? '99+' : unreadMessages;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
 }
 
 // Funzioni utility
 function generateRoomId() {
    const adjectives = ['blu', 'rosso', 'verde', 'giallo', 'viola', 'arancione', 'silver', 'gold'];
    const nouns = ['casa', 'stanza', 'sala', 'spazio', 'luogo', 'mondo', 'team', 'gruppo'];
    const numbers = Math.floor(Math.random() * 10000);
    
    const roomId = `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${numbers}`;
    document.getElementById('roomInput').value = roomId;
 }
 
 function copyRoomId() {
    if (currentRoomId) {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            showNotification('📋 ID stanza copiato!', 'success');
        }).catch(() => {
            showNotification('❌ Impossibile copiare', 'error');
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
 
 function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
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
    notification.className = `notification show ${type}`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 4000);
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
        
        // Aggiorna indicatore video
        const indicator = document.getElementById(`video-indicator-${socketId}`);
        if (indicator) {
            indicator.classList.toggle('disabled', !enabled);
        }
        
        // Aggiorna status nella lista partecipanti
        updateParticipantStatus(socketId, 'video', enabled);
    }
 }
 
 function updateUserAudioStatus(socketId, enabled) {
    const user = connectedUsers.get(socketId);
    if (user) {
        user.audioEnabled = enabled;
        
        // Aggiorna indicatore audio
        const indicator = document.getElementById(`audio-indicator-${socketId}`);
        if (indicator) {
            indicator.classList.toggle('disabled', !enabled);
        }
        
        // Aggiorna status nella lista partecipanti
        updateParticipantStatus(socketId, 'audio', enabled);
    }
 }
 
 function updateUserScreenShare(socketId, isSharing) {
    const indicator = document.getElementById(`screen-indicator-${socketId}`);
    if (indicator) {
        indicator.style.display = isSharing ? 'flex' : 'none';
    }
    
    if (isSharing) {
        showNotification(`🖥️ ${connectedUsers.get(socketId)?.userName || 'Utente'} sta condividendo lo schermo`, 'info');
    }
 }
 
 function updateParticipantStatus(socketId, type, enabled) {
    const statusIcon = document.getElementById(`participant-${type}-${socketId}`);
    if (statusIcon) {
        statusIcon.classList.toggle('disabled', !enabled);
    }
 }
 
 // Gestione riconnessione
 let reconnectInterval;
 
 socket.on('disconnect', () => {
    showNotification('⚠️ Connessione persa, tentativo di riconnessione...', 'error');
    
    reconnectInterval = setInterval(() => {
        if (socket.connected) {
            clearInterval(reconnectInterval);
            if (currentRoomId && currentUserName) {
                showNotification('✅ Riconnesso! Rientrando nella stanza...', 'success');
                socket.emit('join-room', currentRoomId, currentUserName);
            }
        }
    }, 3000);
 });
 
 // Statistiche chiamata
 let statsInterval;
 
 function startCallStats() {
    statsInterval = setInterval(async () => {
        for (const [socketId, pc] of peerConnections) {
            try {
                const stats = await pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        const fps = report.framesPerSecond;
                        const bitrate = report.bytesReceived;
                        console.log(`📊 Stats ${socketId}: ${fps} FPS, ${bitrate} bytes`);
                    }
                });
            } catch (error) {
                console.error('Errore statistiche:', error);
            }
        }
    }, 5000);
 }
 
 function stopCallStats() {
    if (statsInterval) {
        clearInterval(statsInterval);
    }
 }
 
 // Avvia statistiche quando inizia la chiamata
 socket.on('existing-users', () => {
    startCallStats();
 });
 
 // Ferma statistiche quando termina la chiamata
 window.addEventListener('beforeunload', () => {
    stopCallStats();
 });