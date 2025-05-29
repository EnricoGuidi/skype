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
        audioEnabled: true
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

// Gestione delle connessioni Socket.IO
io.on('connection', (socket) => {
    console.log('🔌 Nuovo utente connesso:', socket.id);

    // Entra in una stanza
    socket.on('join-room', (roomId, userName) => {
        // Lascia eventuali stanze precedenti
        const previousUser = users.get(socket.id);
        if (previousUser) {
            socket.leave(previousUser.roomId);
            removeUserFromRoom(socket.id);
        }
        
        // Entra nella nuova stanza
        socket.join(roomId);
        addUserToRoom(socket.id, roomId, userName);
        
        // Notifica agli altri utenti nella stanza
        const otherUsers = getOtherUsersInRoom(roomId, socket.id);
        
        // Invia la lista degli utenti esistenti al nuovo utente
        socket.emit('existing-users', otherUsers.map(user => ({
            socketId: user.socketId,
            userName: user.userName,
            videoEnabled: user.videoEnabled,
            audioEnabled: user.audioEnabled
        })));
        
        // Notifica agli altri utenti del nuovo arrivo
        socket.to(roomId).emit('user-connected', {
            socketId: socket.id,
            userName: userName,
            videoEnabled: true,
            audioEnabled: true
        });
        
        console.log(`🏠 ${userName} è entrato nella stanza ${roomId}`);
    });

    // Gestione della disconnessione
    socket.on('disconnect', () => {
        const user = removeUserFromRoom(socket.id);
        if (user) {
            // Notifica agli altri utenti nella stanza
            socket.to(user.roomId).emit('user-disconnected', {
                socketId: socket.id,
                userName: user.userName
            });
        }
        console.log('🔌 Utente disconnesso:', socket.id);
    });

    // Gestione segnali WebRTC con destinatario specifico
    socket.on('offer', (data) => {
        const { targetSocketId, offer, roomId } = data;
        
        // Verifica che entrambi gli utenti siano nella stessa stanza
        const sender = users.get(socket.id);
        const receiver = users.get(targetSocketId);
        
        if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
            socket.to(targetSocketId).emit('offer', {
                offer: offer,
                fromSocketId: socket.id,
                fromUserName: sender.userName
            });
            console.log(`📤 Offer inviato da ${sender.userName} a ${receiver.userName}`);
        } else {
            console.log(`❌ Offer rifiutato: utenti non nella stessa stanza`);
        }
    });

    socket.on('answer', (data) => {
        const { targetSocketId, answer, roomId } = data;
        
        const sender = users.get(socket.id);
        const receiver = users.get(targetSocketId);
        
        if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
            socket.to(targetSocketId).emit('answer', {
                answer: answer,
                fromSocketId: socket.id,
                fromUserName: sender.userName
            });
            console.log(`📤 Answer inviato da ${sender.userName} a ${receiver.userName}`);
        }
    });

    socket.on('ice-candidate', (data) => {
        const { targetSocketId, candidate, roomId } = data;
        
        const sender = users.get(socket.id);
        const receiver = users.get(targetSocketId);
        
        if (sender && receiver && sender.roomId === receiver.roomId && sender.roomId === roomId) {
            socket.to(targetSocketId).emit('ice-candidate', {
                candidate: candidate,
                fromSocketId: socket.id
            });
        }
    });

    // Gestione messaggi chat
    socket.on('chat-message', (data) => {
        const user = users.get(socket.id);
        if (user && user.roomId === data.roomId) {
            socket.to(data.roomId).emit('chat-message', {
                message: data.message,
                userId: user.userName,
                socketId: socket.id,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    });

    // Gestione controlli video/audio
    socket.on('toggle-video', (data) => {
        const user = users.get(socket.id);
        if (user && user.roomId === data.roomId) {
            // Aggiorna lo stato dell'utente
            user.videoEnabled = data.videoEnabled;
            
            // Notifica agli altri utenti
            socket.to(data.roomId).emit('user-toggle-video', {
                socketId: socket.id,
                userName: user.userName,
                videoEnabled: data.videoEnabled
            });
        }
    });

    socket.on('toggle-audio', (data) => {
        const user = users.get(socket.id);
        if (user && user.roomId === data.roomId) {
            // Aggiorna lo stato dell'utente
            user.audioEnabled = data.audioEnabled;
            
            // Notifica agli altri utenti
            socket.to(data.roomId).emit('user-toggle-audio', {
                socketId: socket.id,
                userName: user.userName,
                audioEnabled: data.audioEnabled
            });
        }
    });

    // Nuovo evento per ottenere info sulla stanza
    socket.on('get-room-info', (roomId) => {
        const usersInRoom = getUsersInRoom(roomId);
        socket.emit('room-info', {
            roomId: roomId,
            userCount: usersInRoom.length,
            users: usersInRoom.map(user => ({
                socketId: user.socketId,
                userName: user.userName,
                videoEnabled: user.videoEnabled,
                audioEnabled: user.audioEnabled
            }))
        });
    });
});

// Endpoint per statistiche (opzionale)
app.get('/stats', (req, res) => {
    res.json({
        totalRooms: rooms.size,
        totalUsers: users.size,
        rooms: Array.from(rooms.entries()).map(([roomId, userSet]) => ({
            roomId,
            userCount: userSet.size,
            users: Array.from(userSet).map(socketId => {
                const user = users.get(socketId);
                return user ? {
                    userName: user.userName,
                    socketId: user.socketId
                } : null;
            }).filter(Boolean)
        }))
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server in esecuzione su porta ${PORT}`);
    console.log(`📱 Apri: http://localhost:${PORT}`);
    console.log(`📊 Statistiche: http://localhost:${PORT}/stats`);
});