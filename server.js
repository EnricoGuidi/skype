const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Strutture dati per gestire stanze e utenti
const rooms = new Map(); // roomId -> Set di utenti
const users = new Map(); // socketId -> { roomId, userName, socketId }

// Serve static files
app.use(express.static('public'));

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Utility functions
function addUserToRoom(socketId, roomId, userName) {
    // Aggiungi utente alla mappa globale
    users.set(socketId, {
        socketId: socketId,
        roomId: roomId,
        userName: userName,
        videoEnabled: true,
        audioEnabled: true,
        joinedAt: new Date()
    });
    
    // Aggiungi utente alla stanza
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socketId);
    
    console.log(`✅ Utente ${userName} (${socketId}) aggiunto alla stanza ${roomId}`);
    console.log(`📊 Stanza ${roomId} ora ha ${rooms.get(roomId).size} utenti`);
}

function removeUserFromRoom(socketId) {
    const user = users.get(socketId);
    if (!user) return null;
    
    const { roomId, userName } = user;
    
    // Rimuovi dalla stanza
    if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socketId);
        
        // Se la stanza è vuota, rimuovila
        if (rooms.get(roomId).size === 0) {
            rooms.delete(roomId);
            console.log(`🗑️ Stanza ${roomId} rimossa (vuota)`);
        } else {
            console.log(`📊 Stanza ${roomId} ora ha ${rooms.get(roomId).size} utenti`);
        }
    }
    
    // Rimuovi dalla mappa utenti
    users.delete(socketId);
    
    console.log(`❌ Utente ${userName} (${socketId}) rimosso dalla stanza ${roomId}`);
    return user;
}

function getUsersInRoom(roomId) {
    if (!rooms.has(roomId)) return [];
    
    const socketIds = Array.from(rooms.get(roomId));
    return socketIds.map(socketId => users.get(socketId)).filter(user => user);
}

function getOtherUsersInRoom(roomId, excludeSocketId) {
    return getUsersInRoom(roomId).filter(user => user.socketId !== excludeSocketId);
}

function broadcastToRoom(roomId, event, data, excludeSocketId = null) {
    if (!rooms.has(roomId)) return;
    
    const roomUsers = Array.from(rooms.get(roomId));
    roomUsers.forEach(socketId => {
        if (socketId !== excludeSocketId) {
            io.to(socketId).emit(event, data);
        }
    });
}

// Gestione delle connessioni Socket.IO
io.on('connection', (socket) => {
    console.log('🔌 Nuovo utente connesso:', socket.id);

    // Entra in una stanza
    socket.on('join-room', (roomId, userName) => {
        try {
            // Lascia eventuali stanze precedenti
            const previousUser = users.get(socket.id);
            if (previousUser) {
                socket.leave(previousUser.roomId);
                removeUserFromRoom(socket.id);
                
                // Notifica la vecchia stanza
                broadcastToRoom(previousUser.roomId, 'user-disconnected', {
                    socketId: socket.id,
                    userName: previousUser.userName
                });
            }
            
            // Validazione input
            if (!roomId || !userName || roomId.length > 50 || userName.length > 30) {
                socket.emit('error', { message: 'Dati non validi' });
                return;
            }
            
            // Entra nella nuova stanza
            socket.join(roomId);
            addUserToRoom(socket.id, roomId, userName);
            
            // Ottieni altri utenti nella stanza
            const otherUsers = getOtherUsersInRoom(roomId, socket.id);
            
            // Invia la lista degli utenti esistenti al nuovo utente
            socket.emit('existing-users', otherUsers.map(user => ({
                socketId: user.socketId,
                userName: user.userName,
                videoEnabled: user.videoEnabled,
                audioEnabled: user.audioEnabled
            })));
            
            // Notifica agli altri utenti del nuovo arrivo
            broadcastToRoom(roomId, 'user-connected', {
                socketId: socket.id,
                userName: userName,
                videoEnabled: true,
                audioEnabled: true
            }, socket.id);
            
            console.log(`🏠 ${userName} è entrato nella stanza ${roomId} (${otherUsers.length + 1} utenti totali)`);
            
        } catch (error) {
            console.error('Errore join-room:', error);
            socket.emit('error', { message: 'Errore nell\'entrare nella stanza' });
        }
    });

    // Gestione della disconnessione
    socket.on('disconnect', (reason) => {
        console.log(`🔌 Utente disconnesso: ${socket.id} (${reason})`);
        
        const user = removeUserFromRoom(socket.id);
        if (user) {
            // Notifica agli altri utenti nella stanza
            broadcastToRoom(user.roomId, 'user-disconnected', {
                socketId: socket.id,
                userName: user.userName
            });
        }
    });

    // Gestione segnali WebRTC con validazione migliorata
    socket.on('offer', (data) => {
        try {
            const { targetSocketId, offer, roomId } = data;
            
            if (!targetSocketId || !offer || !roomId) {
                console.log('❌ Offer con dati mancanti');
                return;
            }
            
            // Verifica che entrambi gli utenti siano nella stessa stanza
            const sender = users.get(socket.id);
            const receiver = users.get(targetSocketId);
            
            if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
                socket.to(targetSocketId).emit('offer', {
                    offer: offer,
                    fromSocketId: socket.id,
                    fromUserName: sender.userName
                });
                console.log(`📤 Offer: ${sender.userName} → ${receiver.userName}`);
            } else {
                console.log(`❌ Offer rifiutato: utenti non nella stessa stanza o non trovati`);
            }
        } catch (error) {
            console.error('Errore offer:', error);
        }
    });

    socket.on('answer', (data) => {
        try {
            const { targetSocketId, answer, roomId } = data;
            
            if (!targetSocketId || !answer || !roomId) {
                console.log('❌ Answer con dati mancanti');
                return;
            }
            
            const sender = users.get(socket.id);
            const receiver = users.get(targetSocketId);
            
            if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
                socket.to(targetSocketId).emit('answer', {
                    answer: answer,
                    fromSocketId: socket.id,
                    fromUserName: sender.userName
                });
                console.log(`📤 Answer: ${sender.userName} → ${receiver.userName}`);
            } else {
                console.log(`❌ Answer rifiutato: utenti non nella stessa stanza o non trovati`);
            }
        } catch (error) {
            console.error('Errore answer:', error);
        }
    });

    socket.on('ice-candidate', (data) => {
        try {
            const { targetSocketId, candidate, roomId } = data;
            
            if (!targetSocketId || !candidate || !roomId) {
                return;
            }
            
            const sender = users.get(socket.id);
            const receiver = users.get(targetSocketId);
            
            if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
                socket.to(targetSocketId).emit('ice-candidate', {
                    candidate: candidate,
                    fromSocketId: socket.id
                });
            }
        } catch (error) {
            console.error('Errore ice-candidate:', error);
        }
    });

    // Gestione messaggi chat con validazione
    socket.on('chat-message', (data) => {
        try {
            const { message, roomId, userName } = data;
            const user = users.get(socket.id);
            
            if (!user || !message || !roomId || user.roomId !== roomId) {
                return;
            }
            
            // Validazione lunghezza messaggio
            if (message.length > 500) {
                socket.emit('error', { message: 'Messaggio troppo lungo' });
                return;
            }
            
            // Invia a tutti gli altri utenti nella stanza
            broadcastToRoom(roomId, 'chat-message', {
                message: message.trim(),
                userName: user.userName,
                userId: user.userName,
                socketId: socket.id,
                timestamp: new Date().toLocaleTimeString()
            }, socket.id);
            
            console.log(`💬 ${user.userName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
            
        } catch (error) {
            console.error('Errore chat-message:', error);
        }
    });

    // Gestione controlli video/audio
    socket.on('toggle-video', (data) => {
        try {
            const { videoEnabled, roomId } = data;
            const user = users.get(socket.id);
            
            if (user && user.roomId === roomId && typeof videoEnabled === 'boolean') {
                // Aggiorna lo stato dell'utente
                user.videoEnabled = videoEnabled;
                
                // Notifica agli altri utenti
                broadcastToRoom(roomId, 'user-toggle-video', {
                    socketId: socket.id,
                    userName: user.userName,
                    videoEnabled: videoEnabled
                }, socket.id);
                
                console.log(`📹 ${user.userName} video: ${videoEnabled ? 'ON' : 'OFF'}`);
            }
        } catch (error) {
            console.error('Errore toggle-video:', error);
        }
    });

    socket.on('toggle-audio', (data) => {
        try {
            const { audioEnabled, roomId } = data;
            const user = users.get(socket.id);
            
            if (user && user.roomId === roomId && typeof audioEnabled === 'boolean') {
                // Aggiorna lo stato dell'utente
                user.audioEnabled = audioEnabled;
                
                // Notifica agli altri utenti
                broadcastToRoom(roomId, 'user-toggle-audio', {
                    socketId: socket.id,
                    userName: user.userName,
                    audioEnabled: audioEnabled
                }, socket.id);
                
                console.log(`🎤 ${user.userName} audio: ${audioEnabled ? 'ON' : 'OFF'}`);
            }
        } catch (error) {
            console.error('Errore toggle-audio:', error);
        }
    });

    // Gestione screen sharing
    socket.on('screen-share', (data) => {
        try {
            const { isSharing, roomId } = data;
            const user = users.get(socket.id);
            
            if (user && user.roomId === roomId && typeof isSharing === 'boolean') {
                // Notifica agli altri utenti
                broadcastToRoom(roomId, 'user-screen-share', {
                    socketId: socket.id,
                    userName: user.userName,
                    isSharing: isSharing
                }, socket.id);
                
                console.log(`🖥️ ${user.userName} screen sharing: ${isSharing ? 'ON' : 'OFF'}`);
            }
        } catch (error) {
            console.error('Errore screen-share:', error);
        }
    });

    // Nuovo evento per ottenere info sulla stanza
    socket.on('get-room-info', (roomId) => {
        try {
            const usersInRoom = getUsersInRoom(roomId);
            socket.emit('room-info', {
                roomId: roomId,
                userCount: usersInRoom.length,
                users: usersInRoom.map(user => ({
                    socketId: user.socketId,
                    userName: user.userName,
                    videoEnabled: user.videoEnabled,
                    audioEnabled: user.audioEnabled,
                    joinedAt: user.joinedAt
                }))
            });
        } catch (error) {
            console.error('Errore get-room-info:', error);
        }
    });

    // Gestione errori generici
    socket.on('error', (error) => {
        console.error('Errore socket:', error);
    });
});

// Endpoint per statistiche (migliorato)
app.get('/stats', (req, res) => {
    try {
        const stats = {
            totalRooms: rooms.size,
            totalUsers: users.size,
            serverUptime: process.uptime(),
            timestamp: new Date().toISOString(),
            rooms: Array.from(rooms.entries()).map(([roomId, userSet]) => ({
                roomId,
                userCount: userSet.size,
                users: Array.from(userSet).map(socketId => {
                    const user = users.get(socketId);
                    return user ? {
                        userName: user.userName,
                        socketId: user.socketId,
                        videoEnabled: user.videoEnabled,
                        audioEnabled: user.audioEnabled,
                        joinedAt: user.joinedAt
                    } : null;
                }).filter(Boolean)
            }))
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Errore stats:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Endpoint per la salute del server
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Gestione errori del server
server.on('error', (error) => {
    console.error('Errore server:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM ricevuto, chiudendo il server...');
    server.close(() => {
        console.log('👋 Server chiuso');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT ricevuto, chiudendo il server...');
    server.close(() => {
        console.log('👋 Server chiuso');
        process.exit(0);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server VideoChat Multi-Utente in esecuzione`);
    console.log(`📱 URL locale: http://localhost:${PORT}`);
    console.log(`📊 Statistiche: http://localhost:${PORT}/stats`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
    console.log(`🌐 Porta: ${PORT}`);
});