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

// Serve static files
app.use(express.static('public'));

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gestione delle connessioni Socket.IO
io.on('connection', (socket) => {
    console.log('Utente connesso:', socket.id);

    // Entra in una stanza
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId);
        console.log(`Utente ${userId} è entrato nella stanza ${roomId}`);

        // Gestione della disconnessione
        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', userId);
            console.log(`Utente ${userId} si è disconnesso dalla stanza ${roomId}`);
        });
    });

    // Gestione segnali WebRTC
    socket.on('offer', (data) => {
        socket.to(data.roomId).emit('offer', {
            offer: data.offer,
            userId: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.roomId).emit('answer', {
            answer: data.answer,
            userId: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.roomId).emit('ice-candidate', {
            candidate: data.candidate,
            userId: socket.id
        });
    });

    // Gestione messaggi chat
    socket.on('chat-message', (data) => {
        socket.to(data.roomId).emit('chat-message', {
            message: data.message,
            userId: data.userId,
            timestamp: new Date().toLocaleTimeString()
        });
    });

    // Gestione controlli video/audio
    socket.on('toggle-video', (data) => {
        socket.to(data.roomId).emit('user-toggle-video', {
            userId: socket.id,
            videoEnabled: data.videoEnabled
        });
    });

    socket.on('toggle-audio', (data) => {
        socket.to(data.roomId).emit('user-toggle-audio', {
            userId: socket.id,
            audioEnabled: data.audioEnabled
        });
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server in esecuzione su porta ${PORT}`);
    console.log(`📱 Apri: http://localhost:${PORT}`);
});