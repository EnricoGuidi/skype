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
    socket.on('existing-users', (users) => {
        console.log('👥 Utenti esistenti nella stanza:', users);
        
        // Crea connessioni peer con tutti gli utenti esistenti
        users.forEach(user => {
            addUserToInterface(user);
            createPeerConnection(user.socketId, true);
        });
        
        updateParticipantsCount();
    });
    
    socket.on('user-connected', (userData) => {
        console.log('👋 Nuovo utente connesso:', userData);
        showNotification(`👋 ${userData.userName} si è unito!`, 'success');
        
        addUserToInterface(userData);
        createPeerConnection(userData.socketId, false);
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
        if (peerConnection && data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
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
    
    // Aggiungi stream locale
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
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
        const remoteStream = event.streams[0];
        remoteStreams.set(remoteSocketId, remoteStream);
        
        // Assegna stream al video element
        const videoElement = videoElements.get(remoteSocketId);
        if (videoElement) {
            videoElement.srcObject = remoteStream;
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
    
    // Crea offer se richiesto
    if (shouldCreateOffer) {
        await createOffer(remoteSocketId);
    }
}

async function createOffer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
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
}

async function createAnswer(targetSocketId) {
    const peerConnection = peerConnections.get(targetSocketId);
    if (!peerConnection) return;
    
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
        
        // Aggiungi se stesso alla lista partecipanti
        addParticipantToList({
            socketId: 'local',
            userName: userName + ' (Tu)',
            videoEnabled: true,
            audioEnabled: true
        });
        
        updateParticipantsCount();
        
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
    
    displayChatMessage(message, 'Tu', new Date().to