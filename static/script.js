const API_BASE_URL = window.location.origin;
let playerId = null;
let gameId = null;
let csrfToken = null;

let selectedShipSize = 0;
let selectedOrientation = 'horizontal';
let placedShips = {
    4: 0,  // 4-палубные
    3: 0,  // 3-палубные  
    2: 0,  // 2-палубные
    1: 0   // 1-палубные
};
const MAX_SHIPS = {
    4: 1,
    3: 2,
    2: 2,
    1: 2
};

let currentGameState = null;
let placementInitialized = false;

// ==============================
// WEB SOCKET МЕНЕДЖЕР
// ==============================

let socket = null;
let isSocketConnected = false;
let socketReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

let placementPollInterval = null;
// Функция для остановки опроса расстановки
function stopPlacementPolling() {
    if (placementPollInterval) {
        clearInterval(placementPollInterval);
        placementPollInterval = null;
    }
}

// Инициализация WebSocket
function initWebSocket() {
    console.log('Initializing WebSocket connection...');
    
    // Создаем соединение
    socket = io({
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    // Обработчики событий WebSocket
    socket.on('connect', () => {
        console.log('WebSocket connected:', socket.id);
        isSocketConnected = true;
        socketReconnectAttempts = 0;
        addLog('Соединение с сервером установлено');
        
        // Если есть активная комната - переподключаемся
        if (currentRoomCode && playerId) {
            setTimeout(() => {
                socket.emit('join_room', {
                    room_code: currentRoomCode,
                    player_id: playerId
                });
            }, 500);
        }
    });
    
    socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        isSocketConnected = false;
        
        if (reason === 'io server disconnect') {
            addLog('Сервер отключил соединение. Переподключаемся...');
            setTimeout(() => {
                if (socket) socket.connect();
            }, 1000);
        } else {
            addLog('Соединение разорвано. Попытка переподключения...');
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        socketReconnectAttempts++;
        
        if (socketReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            addLog('Не удалось подключиться к серверу. Используем резервный режим...');
            if (currentRoomCode && gameType === 'multiplayer') {
                startMultiplayerGamePolling();
            }
        }
    });
    
    socket.on('error', (error) => {
        console.error('WebSocket error:', error);
        addLog(`Ошибка соединения: ${error.message || 'неизвестная ошибка'}`);
    });
    
    socket.on('room_joined', (data) => {
        console.log('Successfully joined room via WebSocket:', data);
        addLog('Подключено к комнате через WebSocket');
    });
    
    socket.on('player_joined', (data) => {
        console.log('Another player joined:', data);
        
        // Обновляем список игроков в лобби
        if (currentRoomCode) {
            fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.room) {
                        updatePlayerList(data.room);
                        
                        if (data.room.player2_id && !window.secondPlayerNotified) {
                            addLobbyMessage('Второй игрок присоединился к комнате!');
                            window.secondPlayerNotified = true;
                        }
                    }
                });
        }
    });

    socket.on('placement_started', (data) => {
        console.log('Placement started:', data);
        
        if (data.room && data.room.has_game) {
            addLobbyMessage('Начинаем расстановку кораблей!');
            
            // Переходим к расстановке кораблей
            setTimeout(() => {
                startMultiplayerGame(data);
            }, 1000);
        }
    });
    
    socket.on('player_left', (data) => {
        console.log('Player left:', data);
        addLobbyMessage(`Игрок ${data.player_id} покинул комнату`);
        
        if (currentRoomCode) {
            setTimeout(() => {
                fetchGameState();
            }, 1000);
        }
    });
    
    socket.on('player_ready_update', (data) => {
        console.log('Player ready update:', data);
        
        // Обновляем статус готовности
        if (data.room) {
            updatePlayerList(data.room);
            
            if (data.player_id !== playerId) {
                addLobbyMessage(`Игрок ${data.player_id} готов к игре!`);
            }
        }
    });
    
    socket.on('game_started', (data) => {
        console.log('Game started via WebSocket:', data);
        
        stopLobbyPolling();
        
        // Начинаем игру
        if (data.room && data.room.has_game) {
            startMultiplayerGame(data);
        }
    });
    
    socket.on('move_result', (data) => {
        console.log('Move result received:', data);
        
        // Обрабатываем результат хода
        handleWebSocketMove(data);
    });
    
    socket.on('game_finished', (data) => {
        console.log('Game finished:', data);
        
        // Отображаем результат игры
        if (data.winner_id === playerId) {
            showVictory();
        } else {
            showDefeat();
        }
        
        // Блокируем дальнейшие ходы
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            cell.style.pointerEvents = 'none';
        });
    });
    
    socket.on('game_state_update', (data) => {
        console.log('Game state update:', data);
        
        // Обновляем состояние игры
        if (data.game) {
            currentGameState = data.game;
            updateGameHeaders(data.game);
            
            // Запрашиваем полное состояние для обновления досок
            fetchGameState();
        }
    });


    socket.on('player_placement_complete', (data) => {
        console.log('Player placement complete:', data);
        
        if (data.player_id !== playerId) {
            addLog('Противник завершил расстановку кораблей!');
            addLog(`Готовых игроков: ${data.ready_players.length}/2`);
        }
    });

    socket.on('battle_started', (data) => {
        console.log('Battle started via WebSocket:', data);
        
        // Останавливаем опрос расстановки
        stopPlacementPolling();
        
        // Переходим к битве
        startMultiplayerBattle(data);
    });

    socket.on('placement_error', (data) => {
        console.log('Placement error:', data);
        alert('Ошибка: ' + data.message);
        
        // Разблокируем кнопку готовности
        const btn = document.getElementById('readyButton');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✅ Готов к бою!';
        }
    });

    
    socket.on('move_rejected', (data) => {
        console.log('Move rejected:', data);
        
        if (data.message === 'Not your turn') {
            addLog('Сейчас не ваш ход!');
            updateGameHeaders({
                status: 'active',
                current_turn: data.current_turn
            });
        } else if (data.message === 'Already attacked this cell') {
            addLog(`Вы уже стреляли в (${data.x},${data.y})!`);
        }
    });
    
    // Пинг-понг для поддержания соединения
    setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping');
        }
    }, 30000);
}

function handleWebSocketMove(data) {
    if (!data || !data.move) return;
    
    const move = data.move;
    const gameState = data.game_state;
    
    // Обновляем текущее состояние
    if (gameState) {
        currentGameState = {
            status: gameState.status,
            current_turn: gameState.current_turn,
            winner: gameState.winner
        };
        
        updateGameHeaders(currentGameState);
    }
    
    const isMyMove = (move.player_id === playerId);
    
    if (isMyMove) {
        // Обновляем доску противника (наши выстрелы)
        const cell = getCell('opponentBoard', move.x, move.y);
        if (cell) {
            if (move.result === 'hit') {
                cell.classList.add('hit');
                cell.textContent = '💥';
                
                // Если потоплен корабль
                if (move.sunk && move.sunk_positions) {
                    move.sunk_positions.forEach(pos => {
                        const sunkCell = getCell('opponentBoard', pos[0], pos[1]);
                        if (sunkCell) {
                            sunkCell.classList.add('sunk');
                            sunkCell.textContent = '💀';
                        }
                    });
                    addLog(`Вы потопили корабль! (${move.sunk_positions.length} палуб)`);
                } else {
                    addLog(`Вы попали в (${move.x}, ${move.y})!`);
                }
            } else if (move.result === 'miss') {
                cell.classList.add('miss');
                cell.textContent = '⭕';
                addLog(`Промах в (${move.x}, ${move.y})`);
            }
            
            cell.classList.remove('processing');
        }
    } else {
        // Ход противника - обновляем нашу доску
        const cell = getCell('playerBoard', move.x, move.y);
        if (cell) {
            if (move.result === 'hit') {
                cell.classList.add('hit');
                cell.textContent = '💥';
                addLog(`Противник попал в (${move.x}, ${move.y})!`);
            } else if (move.result === 'miss') {
                cell.classList.add('miss');
                cell.textContent = '⭕';
                addLog(`Противник промахнулся в (${move.x}, ${move.y})`);
            }
        }
    }
    
    // Обновляем индикатор хода
    if (gameState && gameState.status === 'active') {
        const isMyTurn = (gameState.current_turn === playerRole);
        
        if (isMyTurn) {
            addLog('Ваш ход!');
            unlockOpponentBoard();
        } else {
            addLog('Ход противника...');
            lockOpponentBoard();
        }
    }
    
    // Если игра окончена
    if (gameState && gameState.status === 'finished') {
        if (gameState.winner === playerRole) {
            showVictory();
        } else {
            showDefeat();
        }
    }
}

// ==============================
// ПЕРЕМЕННЫЕ И ФУНКЦИИ ДЛЯ МУЛЬТИПЛЕЕРА
// ==============================

let currentRoomCode = null;
let gameType = null;    // 'ai' или 'multiplayer'
let playerRole = null;  // 'player1' или 'player2'
let isGameHost = false;
let lobbyPollInterval = null;
let multiplayerGamePollInterval = null;
let playerName = null;



// Обновляем HTML для мультиплеера (добавьте в DOMContentLoaded или создайте новые элементы)
document.addEventListener('DOMContentLoaded', () => {
    fetchCSRFToken();
    setTimeout(() => {
        initWebSocket();
    }, 1000);
    addMultiplayerInputs();
});

function addMultiplayerInputs() {
    console.log('Инициализация полей мультиплеера...');
}

async function createMultiplayerRoom() {
    const playerNameInput = document.getElementById('playerNameHost')?.value.trim() || 
                           document.getElementById('playerName')?.value.trim() || 
                           'Игрок' + Date.now();
    
    playerName = playerNameInput;
    playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gameType = 'multiplayer';
    isGameHost = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/multiplayer/room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                player_id: playerId,
                player_name: playerName
            })
        });
        
        const data = await response.json();
        if (data.success) {
            currentRoomCode = data.room_code;
            
            // Подключаемся к комнате через WebSocket
            if (socket && socket.connected) {
                socket.emit('join_room', {
                    room_code: currentRoomCode,
                    player_id: playerId,
                    player_name: playerName
                });
            }
            
            // Показываем интерфейс лобби
            document.getElementById('gameSetup').style.display = 'none';
            document.getElementById('lobbyContainer').style.display = 'block';
            
            document.getElementById('lobbyCode').textContent = currentRoomCode;
            document.getElementById('player1Name').textContent = playerName + ' (Вы)';
            document.getElementById('player1Status').textContent = 'ожидает';
            
            addLobbyMessage(`Комната создана! Код: ${currentRoomCode}`);
            addLobbyMessage('Ожидание второго игрока...');
            
        } else {
            alert('Ошибка создания комнаты: ' + (data.error || 'неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка создания комнаты:', error);
        alert(`Ошибка: ${error.message}`);
    }
}


async function joinMultiplayerRoom() {
    const playerNameInput = document.getElementById('playerNameJoin')?.value.trim() || 
                           document.getElementById('playerName')?.value.trim() || 
                           'Игрок' + Date.now();
    const roomCodeInput = document.getElementById('gameCode')?.value.trim().toUpperCase() || 
                         prompt('Введите код комнаты (6 символов):', '').toUpperCase();
    
    if (!roomCodeInput || roomCodeInput.length !== 6) {
        alert('Введите корректный код комнаты (6 символов)');
        return;
    }
    
    playerName = playerNameInput;
    playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gameType = 'multiplayer';
    isGameHost = false;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${roomCodeInput}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                room_code: roomCodeInput,
                player_id: playerId,
                player_name: playerName
            })
        });
        
        const data = await response.json();
        if (data.success) {
            currentRoomCode = roomCodeInput;
            
            // Подключаемся к комнате через WebSocket
            if (socket && socket.connected) {
                socket.emit('join_room', {
                    room_code: currentRoomCode,
                    player_id: playerId,
                    player_name: playerName
                });
            }
            
            // Показываем интерфейс лобби
            document.getElementById('gameSetup').style.display = 'none';
            document.getElementById('lobbyContainer').style.display = 'block';
            
            document.getElementById('lobbyCode').textContent = currentRoomCode;
            
            // Обновляем список игроков
            updatePlayerList(data.room);
            
            addLobbyMessage(`Вы присоединились к комнате ${playerName}!`);
            
            fetchGameState();
            
        } else {
            alert('Ошибка присоединения: ' + (data.error || 'неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка присоединения к комнате:', error);
        alert(`Ошибка: ${error.message}`);
    }
}


function startLobbyPolling() {
    if (lobbyPollInterval) {
        clearInterval(lobbyPollInterval);
    }
    
    // Отслеживаем, присоединился ли второй игрок
    let secondPlayerJoined = false; 
    
    lobbyPollInterval = setInterval(async () => {
        if (!currentRoomCode) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
            
            // Если комната не найдена (404), значит она была удалена
            if (response.status === 404) {
                addLobbyMessage('Комната была удалена. Возвращаемся в меню...');
                setTimeout(() => {
                    stopLobbyPolling();
                    document.getElementById('lobbyContainer').style.display = 'none';
                    document.getElementById('gameSetup').style.display = 'block';
                    currentRoomCode = null;
                }, 2000);
                return;
            }
            
            const data = await response.json();
            
            if (data.room) {
                updatePlayerList(data.room);
                
                // Проверяем, изменился ли статус комнаты
                if (data.room.status === 'placement' && data.room.has_game) {
                    console.log('Комната перешла в состояние placement, начинаем игру!');
                    stopLobbyPolling();
                    startMultiplayerGame(data);
                } else if (data.room.status === 'waiting') {
                    // Ожидаем второго игрока
                    if (data.room.player2_id && !secondPlayerJoined) {
                        addLobbyMessage('Второй игрок присоединился!');
                        secondPlayerJoined = true;
                    }
                    
                    if (!data.room.player2_id && secondPlayerJoined) {
                        addLobbyMessage('Второй игрок покинул лобби.');
                        secondPlayerJoined = false;
                    }
                    
                    if (data.room.player1_ready && data.room.player2_ready) {
                        addLobbyMessage('Оба игрока готовы! Начинаем игру...');
                    }
                } else if (data.room.status === 'active') {
                    // Игра уже активна (возможно, переподключение)
                    console.log('Игра уже активна, присоединяемся...');
                    stopLobbyPolling();
                    startMultiplayerGame(data);
                } else if (data.room.status === 'finished') {
                    addLobbyMessage('Игра завершена. Возвращаемся в меню...');
                    setTimeout(() => {
                        stopLobbyPolling();
                        document.getElementById('lobbyContainer').style.display = 'none';
                        document.getElementById('gameSetup').style.display = 'block';
                        currentRoomCode = null;
                    }, 3000);
                }
            }
        } catch (error) {
            console.error('Ошибка опроса лобби:', error);
        }
    }, 2000);
}

function updatePlayerList(roomData) {
    const isHost = (playerId === roomData.player1_id);
    
    // Отображаем игрока 1
    const player1Name = roomData.player1_id === playerId ? 
        `${playerName} (Вы)` : 
        (roomData.player1_id || 'Ожидание...');
    
    document.getElementById('player1Name').textContent = player1Name;
    document.getElementById('player1Status').textContent = roomData.player1_ready ? 'готов' : 'ожидание';
    
    // Отображаем игрока 2
    if (roomData.player2_id) {
        const player2Name = roomData.player2_id === playerId ? 
            `${playerName} (Вы)` : 
            roomData.player2_id;
        
        document.getElementById('player2Name').textContent = player2Name;
        document.getElementById('player2Status').textContent = roomData.player2_ready ? 'готов' : 'ожидание';
    } else {
        document.getElementById('player2Name').textContent = 'Ожидание игрока...';
        document.getElementById('player2Status').textContent = 'не подключен';
    }
    
    // Если мы хост и второй игрок появился - показываем сообщение
    if (isHost && roomData.player2_id && !window.secondPlayerNotified) {
        addLobbyMessage('Второй игрок присоединился к комнате!');
        window.secondPlayerNotified = true;
    }
    
    // Если второй игрок вышел
    if (!roomData.player2_id && window.secondPlayerNotified) {
        addLobbyMessage('Второй игрок покинул комнату.');
        window.secondPlayerNotified = false;
    }
}

function copyRoomCode() {
    if (!currentRoomCode) return;
    
    navigator.clipboard.writeText(currentRoomCode)
        .then(() => {
            const btn = document.getElementById('copyCodeBtn') || 
                       document.querySelector('.btn-secondary');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '✓ Скопировано!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            }
        })
        .catch(err => {
            console.error('Ошибка копирования: ', err);
            alert('Не удалось скопировать код. Скопируйте вручную: ' + currentRoomCode);
        });
}

// Обновленная функция leaveLobby
async function leaveLobby() {
    if (confirm('Вы уверены, что хотите покинуть лобби?')) {
        try {
            // Отправляем через WebSocket
            if (socket && socket.connected) {
                socket.emit('leave_room', {
                    room_code: currentRoomCode,
                    player_id: playerId
                });
            }
            
            // Fallback на REST API
            if (currentRoomCode) {
                const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/leave`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify({
                        player_id: playerId
                    })
                });
            }
            
            // Останавливаем все интервалы
            stopLobbyPolling();
            stopMultiplayerGamePolling();
            
            // Возвращаемся в меню
            document.getElementById('lobbyContainer').style.display = 'none';
            document.getElementById('gameSetup').style.display = 'block';
            
            currentRoomCode = null;
            gameType = null;
            isGameHost = false;
            
            addLog('Вы покинули лобби');
            
        } catch (error) {
            console.error('Ошибка при выходе из лобби:', error);
        }
    }
}

// Остановить опрос лобби
function stopLobbyPolling() {
    if (lobbyPollInterval) {
        clearInterval(lobbyPollInterval);
        lobbyPollInterval = null;
    }
}

// Добавить сообщение в лобби
function addLobbyMessage(message) {
    const messagesDiv = document.getElementById('lobbyMessages');
    if (!messagesDiv) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Обновленная функция startMultiplayerGame
async function startMultiplayerGame(gameData) {
    if (!gameData || !gameData.room) {
        console.error('Нет данных для начала игры');
        return;
    }
    
    const room = gameData.room;
    
    if (room.player1_id === playerId) {
        playerRole = 'player1';
    } else if (room.player2_id === playerId) {
        playerRole = 'player2';
    } else {
        console.error('Игрок не найден в комнате!');
        return;
    }
    
    console.log('Начинаем мультиплеерную игру. Роль:', playerRole, 'Статус комнаты:', room.status);
    
    // Скрываем лобби, показываем расстановку
    document.getElementById('lobbyContainer').style.display = 'none';
    document.getElementById('placementContainer').style.display = 'block';
    
    // Обновляем UI
    document.getElementById('gameIdDisplay').textContent = currentRoomCode;
    document.getElementById('placementGameId').textContent = currentRoomCode;
    document.getElementById('placementPlayerName').textContent = playerName;
    document.getElementById('playerIdDisplay').textContent = playerName;
    document.getElementById('gameTypeIndicator').textContent = 'Против игрока';
    
    // Инициализируем поле для расстановки
    if (!placementInitialized) {
        initPlacementBoard();
    }
    
    // Сбрасываем счетчики кораблей
    placedShips = {4: 0, 3: 0, 2: 0, 1: 0};
    updatePlacementUI();
    
    addLog(`Мультиплеерная игра началась! Вы - ${playerRole === 'player1' ? 'Игрок 1' : 'Игрок 2'}`);
    addLog('Расставьте свои корабли.');
    
    // Обновляем статус противника
    updateOpponentPlacementStatus(room);
    
    // Запускаем опрос для расстановки кораблей (только статус противника)
    startPlacementPolling();
}

// Функция для опроса статуса расстановки
function startPlacementPolling() {
    if (placementPollInterval) {
        clearInterval(placementPollInterval);
    }
    
    placementPollInterval = setInterval(async () => {
        if (!currentRoomCode || !playerId) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
            const data = await response.json();
            
            if (data.room) {
                // Обновляем статус противника
                updateOpponentPlacementStatus(data.room);
                
                // Если игра перешла в активную фазу
                if (data.room.status === 'active' && data.room.has_game) {
                    clearInterval(placementPollInterval);
                    startMultiplayerBattle(data);
                }
            }
        } catch (error) {
            console.error('Ошибка опроса статуса расстановки:', error);
        }
    }, 2000);
}

// Обновить статус противника в расстановке
function updateOpponentPlacementStatus(roomData) {
    let opponentReady = false;
    
    if (playerRole === 'player1') {
        opponentReady = roomData.player2_ready;
    } else {
        opponentReady = roomData.player1_ready;
    }
    
    const statusElement = document.getElementById('opponentPlacementStatus');
    if (statusElement) {
        statusElement.innerHTML = 
            `Противник: <span>${opponentReady ? 'готов' : 'расставляет корабли'}</span>`;
    }
}

function startMultiplayerGamePolling() {
    if (multiplayerGamePollInterval) {
        clearInterval(multiplayerGamePollInterval);
    }
    
    // Увеличиваем интервал опроса для уменьшения нагрузки
    multiplayerGamePollInterval = setInterval(async () => {
        if (!currentRoomCode || !playerId) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
            
            if (response.status === 429) {
                console.log('Rate limit, увеличиваем интервал опроса...');
                clearInterval(multiplayerGamePollInterval);
                multiplayerGamePollInterval = setInterval(() => {
                    startMultiplayerGamePolling();
                }, 5000);
                return;
            }
            
            const data = await response.json();
            
            if (data.room) {
                // Обновляем статус оппонента
                if (playerRole === 'player1') {
                    const opponentReady = data.room.player2_ready;
                    document.getElementById('opponentPlacementStatus').innerHTML = 
                        `Противник: <span>${opponentReady ? 'готов' : 'расставляет корабли'}</span>`;
                } else {
                    const opponentReady = data.room.player1_ready;
                    document.getElementById('opponentPlacementStatus').innerHTML = 
                        `Противник: <span>${opponentReady ? 'готов' : 'расставляет корабли'}</span>`;
                }
                
                // Если игра началась и мы еще не в игре
                if (data.room.status === 'active' && data.room.has_game && 
                    document.getElementById('placementContainer').style.display === 'block') {
                    console.log('Игра началась! Переходим к битве...');
                    stopMultiplayerGamePolling();
                    startMultiplayerBattle(data);
                }
            }
        } catch (error) {
            console.error('Ошибка опроса состояния игры:', error);
        }
    }, 3000);
}

// Остановить опрос мультиплеерной игры
function stopMultiplayerGamePolling() {
    if (multiplayerGamePollInterval) {
        clearInterval(multiplayerGamePollInterval);
        multiplayerGamePollInterval = null;
    }
}

// Обновленная функция readyForGame
async function readyForGame() {
    if (!currentRoomCode || !playerId) return;
    
    // Отключаем кнопку сразу
    const btn = document.getElementById('readyButtonLobby');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '✅ Ожидание второго игрока...';
    }
    
    addLobbyMessage('Вы готовы к игре! Ожидаем второго игрока...');
    
    try {
        // Отправляем через WebSocket
        if (socket && socket.connected) {
            socket.emit('player_ready', {
                room_code: currentRoomCode,
                player_id: playerId
            });
            console.log('WebSocket: player_ready отправлен');
        } else {
            // Fallback на REST API
            console.log('WebSocket недоступен, используем REST API');
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/ready`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    room_code: currentRoomCode,
                    player_id: playerId
                })
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('REST API: Игрок готов');
                
                // Обновляем статус
                if (playerId === data.room.player1_id) {
                    document.getElementById('player1Status').textContent = 'готов';
                } else {
                    document.getElementById('player2Status').textContent = 'готов';
                }
            } else {
                alert('Ошибка: ' + (data.error || 'неизвестная ошибка'));
            }
        }
    } catch (error) {
        console.error('Ошибка при готовности к игре:', error);
        alert(`Ошибка: ${error.message}`);
    }
}

// Добавим глобальные переменные для отслеживания состояния
let lastBoardState = {
    myHits: [],
    opponentHits: []
};

function startMultiplayerBattlePolling() {
    if (gamePollInterval) {
        clearInterval(gamePollInterval);
    }
    
    let pollCount = 0;
    
    const pollFunction = async () => {
        if (!currentRoomCode || !playerId) return;
        
        pollCount++;
        if (pollCount % 10 === 0) {
            console.log(`Опрос ${pollCount}: комната ${currentRoomCode}, роль ${playerRole}`);
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
            
            if (response.status === 429) {
                console.warn('Rate limit, увеличиваем интервал');
                clearInterval(gamePollInterval);
                gamePollInterval = setInterval(pollFunction, 5000);
                return;
            }
            
            if (!response.ok) {
                console.error('Ошибка запроса состояния:', response.status);
                return;
            }
            
            const data = await response.json();
            
            // Обновляем состояние комнаты
            if (data.room) {
                if (data.room.status === 'finished') {
                    clearInterval(gamePollInterval);
                    
                    // Определяем победителя
                    if (data.game && data.game.winner) {
                        if (data.game.winner === playerRole) {
                            showVictory();
                        } else {
                            showDefeat();
                        }
                    } else {
                        addLog('Игра завершена.');
                        updateGameHeaders({ status: 'finished' });
                    }
                    return;
                }
            }
            
            // Обновляем состояние игры
            if (data.game) {
                currentGameState = data.game;
                
                updateGameHeaders(data.game);
                
                updateBoardsFromServer(data.game);
                
                // Проверяем завершение игры
                if (data.game.status === 'finished') {
                    clearInterval(gamePollInterval);
                    if (data.game.winner === playerRole) {
                        showVictory();
                    } else {
                        showDefeat();
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка опроса состояния битвы:', error);
        }
    };
    
    pollFunction();
    gamePollInterval = setInterval(pollFunction, 1000);
}

// Функция для отображения поражения
function showDefeat() {
    addLog('💀 Поражение! Противник выиграл.');
    updateGameHeaders({ 
        status: 'finished', 
        winner: (playerRole === 'player1' ? 'player2' : 'player1')
    });
    
    // Блокируем дальнейшие ходы
    document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
        cell.style.pointerEvents = 'none';
        cell.style.opacity = '0.7';
    });
}

// Функция для отображения победы
function showVictory() {
    addLog('🎉 ПОБЕДА! Вы выиграли!');
    updateGameHeaders({ 
        status: 'finished', 
        winner: playerRole 
    });
    
    // Блокируем дальнейшие ходы
    document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
        cell.style.pointerEvents = 'none';
        cell.style.opacity = '0.7';
    });
}

// Функция для обновления досок из данных сервера
function updateBoardsFromServer(gameState) {
    if (!gameState) return;
    
    // Обновляем попадания на моей доске (от противника)
    if (gameState.my_board_hits) {
        gameState.my_board_hits.forEach(hit => {
            const cell = getCell('playerBoard', hit.x, hit.y);
            if (cell && !cell.classList.contains('processed')) {
                if (hit.type === 'hit') {
                    if (!cell.classList.contains('hit')) {
                        cell.classList.add('hit');
                        cell.textContent = '💥';
                        if (!isHitInArray(hit, lastBoardState.myHits)) {
                            addLog(`Противник попал в (${hit.x}, ${hit.y})!`);
                        }
                    }
                } else if (hit.type === 'miss') {
                    if (!cell.classList.contains('miss')) {
                        cell.classList.add('miss');
                        cell.textContent = '⭕';
                        if (!isHitInArray(hit, lastBoardState.myHits)) {
                            addLog(`Противник промахнулся в (${hit.x}, ${hit.y})`);
                        }
                    }
                }
                cell.classList.add('processed');
            }
        });
        
        // Обновляем последнее состояние
        lastBoardState.myHits = gameState.my_board_hits;
    }
    
    // Обновляем мои попадания на доске противника
    if (gameState.opponent_board_hits) {
        gameState.opponent_board_hits.forEach(hit => {
            const cell = getCell('opponentBoard', hit.x, hit.y);
            if (cell && !cell.classList.contains('processed')) {
                if (hit.type === 'hit') {
                    if (!cell.classList.contains('hit')) {
                        cell.classList.add('hit');
                        cell.textContent = '💥';
                        if (!isHitInArray(hit, lastBoardState.opponentHits)) {
                        }
                    }
                } else if (hit.type === 'miss') {
                    if (!cell.classList.contains('miss')) {
                        cell.classList.add('miss');
                        cell.textContent = '⭕';
                    }
                }
                cell.classList.add('processed');
            }
        });
        
        // Обновляем последнее состояние
        lastBoardState.opponentHits = gameState.opponent_board_hits;
    }
    
    // Снимаем флаги processed для следующего обновления
    setTimeout(() => {
        document.querySelectorAll('.cell.processed').forEach(cell => {
            cell.classList.remove('processed');
        });
    }, 100);
}

// Вспомогательная функция для проверки наличия попадания в массиве
function isHitInArray(hit, array) {
    return array.some(h => h.x === hit.x && h.y === hit.y && h.type === hit.type);
}

function updateGameHeaders(gameState) {
    if (!gameState) return;
    
    const gameStatusElem = document.getElementById('gameStatus');
    const turnIndicatorElem = document.getElementById('turnIndicator');
    const attackStatusElem = document.getElementById('attackStatus') || document.querySelector('.game-info h3');
    
    if (gameState.status === 'active') {
        const isMyTurn = gameState.current_turn === playerRole;
        
        gameStatusElem.textContent = 'Игра идет';
        turnIndicatorElem.textContent = isMyTurn ? 'Ваш ход!' : 'Ход противника';
        turnIndicatorElem.style.color = isMyTurn ? '#28a745' : '#dc3545';
        
        if (attackStatusElem) {
            attackStatusElem.textContent = isMyTurn ? 'Атакуйте!' : 'Ожидание...';
        }
    } else if (gameState.status === 'finished') {
        if (gameState.winner === playerRole) {
            gameStatusElem.textContent = 'Победа!';
            turnIndicatorElem.textContent = 'Игра завершена';
            turnIndicatorElem.style.color = '#6c757d';
            if (attackStatusElem) attackStatusElem.textContent = 'Победа!';
        } else {
            gameStatusElem.textContent = 'Поражение';
            turnIndicatorElem.textContent = 'Игра завершена';
            turnIndicatorElem.style.color = '#6c757d';
            if (attackStatusElem) attackStatusElem.textContent = 'Поражение';
        }
    } else if (gameState.status === 'placement') {
        gameStatusElem.textContent = 'Расстановка';
        turnIndicatorElem.textContent = 'Расставьте корабли';
        turnIndicatorElem.style.color = '#ffc107';
        if (attackStatusElem) attackStatusElem.textContent = 'Расстановка';
    }
}

async function startMultiplayerBattle(gameData) {
    if (!currentRoomCode || !playerId) {
        console.error('Нет данных для начала битвы');
        return;
    }
    
    // Сначала запрашиваем актуальное состояние
    try {
        const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
        gameData = await response.json();
    } catch (error) {
        console.error('Ошибка при запросе состояния игры:', error);
    }
    
    if (!gameData || !gameData.game) {
        console.error('Нет данных игры для начала битвы:', gameData);
        addLog('Ошибка: нет данных игры');
        return;
    }
    
    // Скрываем расстановку, показываем игровое поле
    document.getElementById('placementContainer').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    
    initializeBoard('playerBoard');
    initializeBoard('opponentBoard');
    
    displayPlayerShipsAfterPlacement();
    
    addLog(`Оба игрока готовы! Игра началась. Комната: ${currentRoomCode}`);
    
    // Устанавливаем текущее состояние игры
    currentGameState = gameData.game;
    
    updateGameHeaders(gameData.game);
    
    if (gameData.game.my_board_hits) {
        updateBoardsFromServer(gameData.game);
    }

    document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
        cell.style.pointerEvents = 'none';
    });
    
    // Определяем, чей ход
    if (gameData.game.current_turn === playerRole) {
        addLog('Ваш ход! Атакуйте поле противника.');
        unlockOpponentBoard();
    } else {
        addLog('Ход противника. Ожидайте...');
        lockOpponentBoard();
    }
    
    // Запускаем опрос ходов
    startMultiplayerBattlePolling();
}

async function handleAttack(x, y) {
    console.log('handleAttack called:', {x, y, gameType, gameId, currentRoomCode, playerId, playerRole});
    
    // Проверка для разных типов игр
    if (gameType === 'ai') {
        if (!gameId) {
            alert('Сначала начните игру');
            return;
        }
        
        // Проверяем, не стреляли ли уже в эту клетку
        const cell = getCell('opponentBoard', x, y);
        if (cell.classList.contains('hit') || cell.classList.contains('miss') || cell.classList.contains('sunk')) {
            addLog('Вы уже стреляли в эту клетку!');
            return;
        }
        
        // Проверяем, чей сейчас ход
        if (currentGameState && currentGameState.status === 'finished') {
            addLog('Игра уже завершена!');
            return;
        }
        if (currentGameState && currentGameState.current_turn !== 'player1') {
            addLog('Сейчас не ваш ход!');
            return;
        }
        
        try {
            addLog(`Атакую (${x}, ${y})...`);
            
            const endpoint = `${API_BASE_URL}/api/game/${gameId}/attack`;
            const requestBody = {
                x: x,
                y: y,
                game_id: gameId
            };
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка атаки');
            }
            
            const data = await response.json();
            console.log('Response data:', data);
            processAIResponse(data, x, y);
            
        } catch (error) {
            console.error('Ошибка атаки:', error);
            addLog(`Ошибка: ${error.message}`);
            
            // При ошибке разблокируем клетки для ИИ
            unlockBoardForAI();
        }
        
    } else if (gameType === 'multiplayer') {
        if (!currentRoomCode) {
            alert('Сначала начните игру');
            return;
        }
        
        // Проверяем, не стреляли ли уже в эту клетку
        const cell = getCell('opponentBoard', x, y);
        if (cell.classList.contains('hit') || cell.classList.contains('miss') || cell.classList.contains('sunk')) {
            addLog('Вы уже стреляли в эту клетку!');
            return;
        }
        
        // Проверяем, чей сейчас ход
        if (currentGameState && currentGameState.status === 'finished') {
            addLog('Игра уже завершена!');
            return;
        }
        if (currentGameState && currentGameState.current_turn !== playerRole) {
            addLog('Сейчас не ваш ход!');
            return;
        }
        
        // Блокируем ВСЕ клетки на время обработки
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            cell.style.pointerEvents = 'none';
        });
        
        // Показываем обработку на конкретной клетке
        cell.classList.add('processing');
        cell.textContent = '🎯';
        
        try {
            addLog(`Атакую (${x}, ${y})...`);
            
            // Используем WebSocket если доступен
            if (socket && socket.connected) {
                socket.emit('make_move', {
                    room_code: currentRoomCode,
                    player_id: playerId,
                    x: x,
                    y: y
                });                
            } else {
                // Fallback на REST API если WebSocket не работает
                const endpoint = `${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/attack`;
                const requestBody = {
                    room_code: currentRoomCode,
                    player_id: playerId,
                    x: x,
                    y: y
                };
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify(requestBody)
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Ошибка атаки');
                }
                
                const data = await response.json();
                processMultiplayerResponse(data, x, y);
            }
            
        } catch (error) {
            console.error('Ошибка атаки:', error);
            addLog(`Ошибка: ${error.message}`);
            
            // При ошибке разблокируем клетки, если все еще наш ход
            if (currentGameState && currentGameState.current_turn === playerRole) {
                unlockOpponentBoard();
            }
            
            // Убираем индикатор обработки с конкретной клетки
            const attackedCell = getCell('opponentBoard', x, y);
            if (attackedCell) {
                attackedCell.classList.remove('processing');
                attackedCell.textContent = '';
            }
        }
    } else {
        alert('Сначала выберите режим игры');
    }
}

// Функция для отображения обработки хода
function showProcessingCell(x, y) {
    const cell = getCell('opponentBoard', x, y);
    if (cell) {
        cell.classList.add('processing');
        cell.textContent = '🎯';
        cell.style.pointerEvents = 'none';
    }
}

// Функция для сброса обработки клетки
function resetProcessingCell(x, y) {
    const cell = getCell('opponentBoard', x, y);
    if (cell) {
        cell.classList.remove('processing');
        cell.textContent = '';
        cell.style.pointerEvents = 'auto';
    }
}

function lockOpponentBoard() {
    document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
        cell.style.pointerEvents = 'none';
    });
}

function unlockOpponentBoard() {
    document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
        // Разблокируем только неатакованные клетки
        if (!cell.classList.contains('hit') && 
            !cell.classList.contains('miss') &&
            !cell.classList.contains('sunk')) {
            cell.style.pointerEvents = 'auto';
        }
    });
}

// Функции для блокировки доски в игре с ИИ
function lockBoardForAI() {
    if (gameType === 'ai') {
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            cell.style.pointerEvents = 'none';
        });
    }
}

function unlockBoardForAI() {
    if (gameType === 'ai') {
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            // Разблокируем все неатакованные клетки
            if (!cell.classList.contains('hit') && 
                !cell.classList.contains('miss') &&
                !cell.classList.contains('sunk')) {
                cell.style.pointerEvents = 'auto';
            }
        });
    }
}

// Функция для запроса состояния игры
async function fetchGameState() {
    if (!currentRoomCode || !playerId) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
        const data = await response.json();
        
        if (data.game) {
            currentGameState = data.game;
            updateGameHeaders(data.game);
            updateBoardsFromServer(data.game);
        }
    } catch (error) {
        console.error('Ошибка при запросе состояния:', error);
    }
}

// Обновленная функция обработки результата атаки
function processAttackResult(data, x, y) {
    const cell = getCell('opponentBoard', x, y);
    if (!cell) return;
    
    if (data.result === 'hit') {
        cell.classList.add('hit');
        
        // Если корабль потоплен
        if (data.sunk && data.sunk_positions) {
            data.sunk_positions.forEach(pos => {
                const sunkCell = getCell('opponentBoard', pos[0], pos[1]);
                if (sunkCell) {
                    sunkCell.classList.add('sunk');
                    sunkCell.textContent = '💀';
                }
            });
            addLog(`Корабль потоплен! (${data.sunk_positions.length} палуб)`);
        } else {
            cell.textContent = '💥';
            addLog(`Попадание в (${x}, ${y})!`);
        }
        
        if (data.game_over) {
            addLog('🎉 ПОБЕДА! Все корабли противника потоплены!');
            updateGameHeaders({ 
                status: 'finished', 
                winner: playerRole 
            });
            return;
        }
        
        // Обновляем индикатор хода
        if (data.next_turn === playerRole) {
            updateGameHeaders({ 
                status: 'active', 
                current_turn: playerRole 
            });
            addLog('Вы попали! Ваш ход снова.');
        } else {
            const opponentRole = playerRole === 'player1' ? 'player2' : 'player1';
            updateGameHeaders({ 
                status: 'active', 
                current_turn: opponentRole 
            });
            addLog('Ожидайте ход противника...');
        }
    } else if (data.result === 'miss') {
        cell.classList.add('miss');
        cell.textContent = '⭕';
        addLog(`Промах в (${x}, ${y})`);
        
        const opponentRole = playerRole === 'player1' ? 'player2' : 'player1';
        updateGameHeaders({ 
            status: 'active', 
            current_turn: opponentRole 
        });
        addLog('Промах! Ход переходит к противнику.');
    } else if (data.error) {
        addLog(`Ошибка: ${data.error}`);
    }
}

// Обработка ответа в мультиплеере
function processMultiplayerResponse(data, x, y) {
    console.log('processMultiplayerResponse:', data);
    
    const cell = getCell('opponentBoard', x, y);
    if (!cell) {
        addLog('Ошибка: клетка не найдена');
        return;
    }
    
    if (data.result === 'hit') {
        cell.classList.add('hit');
        
        // Если корабль потоплен
        if (data.sunk && data.sunk_positions) {
            data.sunk_positions.forEach(pos => {
                const sunkCell = getCell('opponentBoard', pos[0], pos[1]);
                if (sunkCell) {
                    sunkCell.classList.add('sunk');
                    sunkCell.textContent = '💀';
                }
            });
            addLog(`Корабль потоплен! (${data.sunk_positions.length} палуб)`);
        } else {
            cell.textContent = '💥';
            addLog(`Попадание в (${x}, ${y})!`);
        }
        
        if (data.game_over) {
            addLog('🎉 ПОБЕДА! Все корабли противника потоплены!');
            updateGameHeaders({ 
                status: 'finished', 
                winner: playerRole 
            });
            return;
        }
        
        // Обновляем текущее состояние игры
        if (currentGameState) {
            currentGameState.current_turn = data.next_turn;
        }
        
        if (data.next_turn === playerRole) {
            updateGameHeaders({ 
                status: 'active', 
                current_turn: playerRole 
            });
            addLog('Вы попали! Ваш ход снова.');
        } else {
            const opponentRole = playerRole === 'player1' ? 'player2' : 'player1';
            updateGameHeaders({ 
                status: 'active', 
                current_turn: opponentRole 
            });
            addLog('Ожидайте ход противника...');
        }
    } else if (data.result === 'miss') {
        cell.classList.add('miss');
        cell.textContent = '⭕';
        addLog(`Промах в (${x}, ${y})`);
        
        if (currentGameState) {
            currentGameState.current_turn = data.next_turn;
        }
        
        const opponentRole = playerRole === 'player1' ? 'player2' : 'player1';
        updateGameHeaders({ 
            status: 'active', 
            current_turn: opponentRole 
        });
        addLog('Промах! Ход переходит к противнику.');
    } else if (data.error) {
        addLog(`Ошибка: ${data.error}`);
    }
    
    // После атаки немедленно запрашиваем обновленное состояние
    setTimeout(() => {
        fetchGameState();
    }, 300);

    if (!data.game_over) {
        if (data.next_turn === playerRole) {
            // Наш ход снова - разблокируем
            setTimeout(() => {
                unlockOpponentBoard();
            }, 300);
        } else {
            // Ход противника - блокируем
            lockOpponentBoard();
        }
    }
}

// Обработка ответа в игре с ИИ
function processAIResponse(data, x, y) {
    const cell = getCell('opponentBoard', x, y);
    if (!cell) return;
    
    if (data.result === 'hit') {
        cell.classList.add('hit');
        
        // Если корабль потоплен
        if (data.sunk && data.sunk_positions) {
            data.sunk_positions.forEach(pos => {
                const sunkCell = getCell('opponentBoard', pos[0], pos[1]);
                if (sunkCell) {
                    sunkCell.classList.add('sunk');
                    sunkCell.textContent = '💀';
                }
            });
            addLog(`Корабль потоплен! (${data.sunk_positions.length} палуб)`);
        } else {
            cell.textContent = '💥';
            addLog(`Попадание в (${x}, ${y})!`);
        }
        
        if (data.game_over) {
            addLog('🎉 ПОБЕДА! Все корабли противника потоплены!');
            document.getElementById('gameStatus').textContent = 'Победа!';
            document.getElementById('turnIndicator').textContent = 'Игра завершена';
            return;
        }
        
        updateTurnIndicator('player1');
        addLog('Вы попали! Ваш ход снова.');
        
    } else if (data.result === 'miss') {
        cell.classList.add('miss');
        cell.textContent = '⭕';
        addLog(`Промах в (${x}, ${y})`);
        
        // Обработка хода ИИ
        if (data.ai_shots) {
            updateTurnIndicator('AI');
            addLog('Ход переходит к ИИ...');
            
            lockBoardForAI();
            
            setTimeout(() => {
                processAIShots(data.ai_shots);
            }, 1000);
        }
    }
}

function processAIShots(aiShots) {
    if (!aiShots || aiShots.length === 0) return;
    
    let delay = 0;
    
    aiShots.forEach((shot, index) => {
        setTimeout(() => {
            const cell = getCell('playerBoard', shot.x, shot.y);
            
            if (shot.result === 'hit') {
                cell.classList.add('hit');
                cell.textContent = '💥';
                
                if (shot.sunk && shot.sunk_positions) {
                    shot.sunk_positions.forEach(pos => {
                        const sunkCell = getCell('playerBoard', pos[0], pos[1]);
                        if (sunkCell) {
                            sunkCell.classList.add('sunk');
                            sunkCell.textContent = '💀';
                        }
                    });
                    addLog(`ИИ потопил ваш корабль!`);
                } else {
                    addLog(`ИИ попал в (${shot.x}, ${shot.y})!`);
                }
                
                // Если ИИ попал и это последний выстрел в серии
                if (index === aiShots.length - 1) {
                    updateTurnIndicator('player1');
                    addLog('ИИ закончил серию выстрелов. Ваш ход!');
                    
                    // Разблокируем поле для игрока
                    unlockBoardForAI();
                }
            } else {
                cell.classList.add('miss');
                cell.textContent = '⭕';
                addLog(`ИИ промахнулся в (${shot.x}, ${shot.y})`);
                
                if (index === aiShots.length - 1) {
                    updateTurnIndicator('player1');
                    addLog('ИИ промахнулся. Ваш ход!');
                    
                    // Разблокируем поле для игрока
                    unlockBoardForAI();
                }
            }
        }, delay);
        
        delay += 1000;
    });
}

async function finishPlacement() {
    if (!playerId) return;
    
    // Проверяем, все ли корабли расставлены
    const totalPlaced = Object.values(placedShips).reduce((a, b) => a + b, 0);
    const totalNeeded = Object.values(MAX_SHIPS).reduce((a, b) => a + b, 0);
    
    if (totalPlaced < totalNeeded) {
        alert(`Нужно расставить еще ${totalNeeded - totalPlaced} кораблей!`);
        return;
    }
    
    // Для мультиплеера
    if (gameType === 'multiplayer' && currentRoomCode) {
        try {
            // Отправляем через WebSocket, что расстановка завершена
            if (socket && socket.connected) {
                socket.emit('placement_complete', {
                    room_code: currentRoomCode,
                    player_id: playerId
                });
                
                addLog('Вы завершили расстановку! Ожидаем противника...');
                document.getElementById('readyButton').disabled = true;
                document.getElementById('readyButton').textContent = 'Ожидаем противника...';
            } else {
                // Fallback на REST API
                const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/ready`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify({
                        room_code: currentRoomCode,
                        player_id: playerId,
                        placement_complete: true
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    addLog('Вы завершили расстановку! Ожидаем противника...');
                    document.getElementById('readyButton').disabled = true;
                    document.getElementById('readyButton').textContent = 'Ожидаем противника...';
                } else {
                    alert('Ошибка: ' + (data.error || 'неизвестная ошибка'));
                }
            }
        } catch (error) {
            console.error('Ошибка при завершении расстановки:', error);
            alert('Ошибка при завершении расстановки: ' + error.message);
        }
    } else if (gameType === 'ai') {
        // Логика для ИИ
        try {
            const response = await fetch(`${API_BASE_URL}/api/game/${gameId}/ready`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    player_id: playerId
                })
            });
            
            const data = await response.json();
            if (data.success) {
                document.getElementById('placementContainer').style.display = 'none';
                document.getElementById('gameContainer').style.display = 'block';
                
                initializeBoard('playerBoard');
                initializeBoard('opponentBoard');
                displayPlayerShipsAfterPlacement();
                
                addLog('Игра началась! Ваш ход.');
                
                // Разблокируем поле для первого хода
                unlockBoardForAI();
            } else {
                alert(data.error || 'Ошибка');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Ошибка при готовности к игре');
        }
    }
}

async function startGameAI() {
    const playerNameInput = document.getElementById('playerNameAI')?.value.trim() || 
                           document.getElementById('playerName')?.value.trim() || 
                           'Игрок' + Date.now();
    
    if (!playerNameInput) {
        alert('Введите ваше имя');
        return;
    }
    
    playerName = playerNameInput;
    playerId = playerName; // Для обратной совместимости
    gameType = 'ai';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/game`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                player_id: playerId,
                vs_ai: true
            })
        });
        
        const data = await response.json();
        gameId = data.game_id;
        currentGameState = data;

        currentGameState.current_turn = 'player1';
        
        // Показываем интерфейс расстановки
        document.getElementById('gameIdDisplay').textContent = gameId;
        document.getElementById('placementGameId').textContent = gameId;
        document.getElementById('placementPlayerName').textContent = playerName;
        document.getElementById('playerIdDisplay').textContent = playerName;
        document.getElementById('gameTypeIndicator').textContent = 'Против ИИ';
        
        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('placementContainer').style.display = 'block';
        
        // Инициализируем поле для расстановки
        if (!placementInitialized) {
            initPlacementBoard();
        }
        updatePlacementUI();
        
        addLog('Игра против ИИ создана! Расставьте свои корабли.');
        
    } catch (error) {
        console.error('Ошибка создания игры:', error);
        alert(`Ошибка: ${error.message}`);
    }
}

async function joinGame() {
    await joinMultiplayerRoom();
}

function restartGame() {
    if (confirm('Начать новую игру?')) {
        // Останавливаем все интервалы опроса
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        if (gamePollInterval) clearInterval(gamePollInterval);
        if (multiplayerGamePollInterval) clearInterval(multiplayerGamePollInterval);
        
        // Сбрасываем переменные
        currentRoomCode = null;
        gameType = null;
        playerRole = null;
        isGameHost = false;
        playerName = null;
        
        // Показываем меню, скрываем все остальное
        document.getElementById('gameSetup').style.display = 'block';
        document.getElementById('lobbyContainer').style.display = 'none';
        document.getElementById('placementContainer').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'none';
        
        // Сбрасываем игровое состояние
        playerId = null;
        gameId = null;
        placedShips = {4: 0, 3: 0, 2: 0, 1: 0};
        selectedShipSize = 0;
        
        addLog('Игра перезапущена. Выберите режим игры.');
    }
}

function surrender() {
    if (confirm('Вы уверены, что хотите сдаться?')) {
        if (gameType === 'multiplayer') {
            // В мультиплеере отправляем сообщение о сдаче
            addLog('Вы сдались. Противник победил.');
            // Отправляем уведомление на сервер
            fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/surrender`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    player_id: playerId
                })
            }).catch(err => console.error('Ошибка при сдаче:', err));
            
            setTimeout(() => {
                leaveLobby();
                addLog('Вы вернулись в главное меню.');
            }, 3000);
        } else {
            // В игре с ИИ - просто завершаем игру
            addLog('Вы сдались. Игра завершена.');
            document.getElementById('gameStatus').textContent = 'Поражение';
            document.getElementById('turnIndicator').textContent = 'Игра завершена';
        }
    }
}

// ==============================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ МУЛЬТИПЛЕЕРА
// ==============================

// Создаем элементы интерфейса для мультиплеера если их нет
function createMultiplayerUI() {
    // Проверяем, есть ли уже элементы для мультиплеера
    if (!document.getElementById('lobbyContainer')) {
        const lobbyContainer = document.createElement('div');
        lobbyContainer.id = 'lobbyContainer';
        lobbyContainer.className = 'lobby-container';
        lobbyContainer.style.display = 'none';
        
        // Добавляем HTML для лобби
        lobbyContainer.innerHTML = `
            <h2>👥 Лобби: <span id="lobbyCode"></span></h2>
            <div class="lobby-info">
                <div class="player-list">
                    <h3>Игроки в комнате:</h3>
                    <div id="playerList">
                        <div class="player-item waiting">
                            <span class="player-name" id="player1Name">Загрузка...</span>
                            <span class="player-status" id="player1Status">ожидание</span>
                        </div>
                        <div class="player-item waiting">
                            <span class="player-name" id="player2Name">Ожидание игрока...</span>
                            <span class="player-status" id="player2Status">не подключен</span>
                        </div>
                    </div>
                </div>
                <div class="lobby-controls">
                    <button onclick="copyRoomCode()" class="btn btn-secondary" id="copyCodeBtn">
                        📋 Скопировать код
                    </button>
                    <button onclick="leaveLobby()" class="btn btn-warning">
                        🚪 Покинуть лобби
                    </button>
                </div>
                <div class="lobby-messages" id="lobbyMessages">
                    <div class="message">Создана комната. Ожидание второго игрока...</div>
                </div>
            </div>
        `;
        
        // Добавляем в контейнер
        const container = document.querySelector('.container');
        const gameSetup = document.getElementById('gameSetup');
        container.insertBefore(lobbyContainer, gameSetup.nextSibling);
    }
    
    // Обновляем HTML для расстановки кораблей
    const placementContainer = document.getElementById('placementContainer');
    if (placementContainer && !document.getElementById('opponentPlacementStatus')) {
        const placementHeader = placementContainer.querySelector('.placement-info');
        if (placementHeader) {
            const opponentStatus = document.createElement('div');
            opponentStatus.id = 'opponentPlacementStatus';
            opponentStatus.className = 'opponent-status';
            opponentStatus.innerHTML = 'Противник: <span>расставляет корабли</span>';
            placementHeader.appendChild(opponentStatus);
        }
    }
}

// Инициализируем UI для мультиплеера при загрузке
document.addEventListener('DOMContentLoaded', () => {
    createMultiplayerUI();
});

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    fetchCSRFToken();
});

// Получение CSRF токена
async function fetchCSRFToken() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`);
        const data = await response.json();
        csrfToken = data.csrf_token;
        document.getElementById('csrf-token').content = csrfToken;
    } catch (error) {
        console.error('Ошибка получения CSRF токена:', error);
    }
}

// ==============================
// УЛУЧШЕННАЯ РАССТАНОВКА КОРАБЛЕЙ
// ==============================

// Функция выбора корабля
function selectShip(size) {
    if (placedShips[size] >= MAX_SHIPS[size]) {
        alert(`Все ${size}-палубные корабли уже расставлены!`);
        return;
    }
    selectedShipSize = size;
    selectedOrientation = document.querySelector('input[name="orientation"]:checked').value;
    
    // Показываем подсказку без alert
    document.getElementById('placementStatus').textContent = 
        `Выбран ${size}-палубный корабль (${selectedOrientation === 'horizontal' ? 'горизонтально' : 'вертикально'}). Кликните на поле для размещения.`;
    
    // Подсвечиваем выбранную кнопку
    document.querySelectorAll('.btn-ship').forEach(btn => btn.classList.remove('selected'));
    event.target.classList.add('selected');
    
    // Если есть клетка под курсором - сразу показываем превью
    const hoveredCell = document.querySelector('#placementBoard .cell:hover');
    if (hoveredCell) {
        const x = parseInt(hoveredCell.dataset.x);
        const y = parseInt(hoveredCell.dataset.y);
        showShipPreview(x, y);
    }
}

async function autoPlaceAllShips() {
    // Определяем endpoint в зависимости от типа игры
    let endpoint, requestBody;
    
    if (gameType === 'ai') {
        if (!gameId) {
            alert('Сначала создайте игру');
            return;
        }
        endpoint = `${API_BASE_URL}/api/game/${gameId}/auto_place`;
        requestBody = {
            player_id: playerId
        };
    } else if (gameType === 'multiplayer') {
        if (!currentRoomCode) {
            alert('Сначала создайте игру');
            return;
        }
        endpoint = `${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/auto_place`;
        requestBody = {
            player_id: playerId
        };
    } else {
        alert('Сначала выберите режим игры');
        return;
    }
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        if (data.success) {
            placedShips = {4: 1, 3: 2, 2: 2, 1: 2};
            updatePlacementUI();
            
            // Очищаем поле
            const cells = document.querySelectorAll('#placementBoard .cell');
            cells.forEach(cell => {
                cell.classList.remove('ship');
            });
            
            // Отображаем корабли на поле расстановки
            if (data.ship_positions) {
                data.ship_positions.forEach(pos => {
                    const cell = getCell('placementBoard', pos[0], pos[1]);
                    if (cell) {
                        cell.classList.add('ship');
                    }
                });
            }
            
            addLog('Корабли расставлены автоматически!');
            
            // Сбрасываем выбор
            selectedShipSize = 0;
            document.querySelectorAll('.btn-ship').forEach(btn => btn.classList.remove('selected'));
            clearPreview();
        } else {
            alert(data.error || 'Ошибка автоматической расстановки');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при автоматической расстановке: ' + error.message);
    }
}

// Очистить поле
function clearAllShips() {
    if (confirm('Очистить все расставленные корабли?')) {
        placedShips = {4: 0, 3: 0, 2: 0, 1: 0};
        updatePlacementUI();
        const cells = document.querySelectorAll('#placementBoard .cell');
        cells.forEach(cell => {
            cell.classList.remove('ship');
        });
        addLog('Поле очищено');
    }
}

// Обновление UI расстановки
function updatePlacementUI() {
    for (let size in MAX_SHIPS) {
        const element = document.getElementById(`ship${size}`);
        if (element) {
            element.textContent = MAX_SHIPS[size] - placedShips[size];
        }
    }
    
    // Если все корабли расставлены - активируем кнопку "Готов"
    const totalPlaced = Object.values(placedShips).reduce((a, b) => a + b, 0);
    const totalNeeded = Object.values(MAX_SHIPS).reduce((a, b) => a + b, 0);
    
    if (totalPlaced === totalNeeded) {
        document.getElementById('readyButton').disabled = false;
        document.getElementById('placementStatus').textContent = 'Все корабли расставлены!';
    } else {
        document.getElementById('readyButton').disabled = true;
        document.getElementById('placementStatus').textContent = 
            `Расставьте корабли: ${totalPlaced}/${totalNeeded}`;
    }
}

// Добавляем обработчик изменения ориентации в initPlacementBoard:
function initPlacementBoard() {
    const board = document.getElementById('placementBoard');
    board.innerHTML = '';
    
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            
            // Превью при наведении
            cell.addEventListener('mouseenter', () => {
                if (selectedShipSize > 0) {
                    showShipPreview(x, y);
                }
            });
            
            cell.addEventListener('mouseleave', clearPreview);
            
            cell.addEventListener('click', () => placeShipOnBoard(x, y));
            
            board.appendChild(cell);
        }
    }
    
    // Добавляем обработчики изменения ориентации
    const orientationRadios = document.querySelectorAll('input[name="orientation"]');
    orientationRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (selectedShipSize > 0) {
                // Обновляем ориентацию
                selectedOrientation = e.target.value;
                
                // Обновляем текст подсказки
                document.getElementById('placementStatus').textContent = 
                    `Выбран ${selectedShipSize}-палубный корабль (${selectedOrientation === 'horizontal' ? 'горизонтально' : 'вертикально'}). Кликните на поле для размещения.`;
                
                // Если есть клетка под курсором - обновляем превью
                const hoveredCell = document.querySelector('#placementBoard .cell:hover');
                if (hoveredCell) {
                    const x = parseInt(hoveredCell.dataset.x);
                    const y = parseInt(hoveredCell.dataset.y);
                    showShipPreview(x, y);
                }
            }
        });
    });
    
    placementInitialized = true;
}

function changeOrientation(orientation) {
    selectedOrientation = orientation;
    if (selectedShipSize > 0) {
        // Обновляем превью если корабль выбран
        const hoveredCell = document.querySelector('#placementBoard .cell:hover');
        if (hoveredCell) {
            const x = parseInt(hoveredCell.dataset.x);
            const y = parseInt(hoveredCell.dataset.y);
            showShipPreview(x, y);
        }
    }
}

function showShipPreview(startX, startY) {
    clearPreview();
    
    const positions = getShipPositions(startX, startY, selectedShipSize, selectedOrientation);
    let canPlace = true;
    
    // Проверяем возможность размещения
    for (let pos of positions) {
        const cell = getCell('placementBoard', pos.x, pos.y);
        if (!cell || cell.classList.contains('ship')) {
            canPlace = false;
            break;
        }
    }
    
    for (let pos of positions) {
        const cell = getCell('placementBoard', pos.x, pos.y);
        if (cell) {
            cell.classList.add(canPlace ? 'preview' : 'preview-invalid');
            if (canPlace) {
                cell.classList.add('preview-' + selectedShipSize);
            }
        }
    }
}

function clearPreview() {
    document.querySelectorAll('#placementBoard .cell').forEach(cell => {
        cell.classList.remove('preview', 'preview-invalid', 'preview-4', 'preview-3', 'preview-2', 'preview-1');
    });
}

function getShipPositions(startX, startY, size, orientation) {
    const positions = [];
    for (let i = 0; i < size; i++) {
        if (orientation === 'horizontal') {
            if (startX + i < 10) {
                positions.push({x: startX + i, y: startY});
            }
        } else {
            if (startY + i < 10) {
                positions.push({x: startX, y: startY + i});
            }
        }
    }
    return positions;
}

async function placeShipOnBoard(startX, startY) {
    if (selectedShipSize === 0) return;
    
    const positions = getShipPositions(startX, startY, selectedShipSize, selectedOrientation);
    
    // Проверка на выход за границы
    if (positions.length !== selectedShipSize) {
        alert('Корабль выходит за границы поля!');
        return;
    }
    
    // Проверка на пересечение с уже стоящими кораблями
    for (let pos of positions) {
        const cell = getCell('placementBoard', pos.x, pos.y);
        if (cell && cell.classList.contains('ship')) {
            alert('Корабль пересекается с уже стоящим кораблем!');
            return;
        }
    }
    
    // Определяем endpoint в зависимости от типа игры
    let endpoint, requestBody;
    
    if (gameType === 'ai') {
        if (!gameId) {
            alert('Сначала создайте игру');
            return;
        }
        endpoint = `${API_BASE_URL}/api/game/${gameId}/place_ship`;
        requestBody = {
            player_id: playerId,
            positions: positions.map(pos => [pos.x, pos.y])
        };
    } else if (gameType === 'multiplayer') {
        if (!currentRoomCode) {
            alert('Сначала создайте игру');
            return;
        }
        endpoint = `${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/place_ship`;
        requestBody = {
            player_id: playerId,
            positions: positions.map(pos => [pos.x, pos.y])
        };
    } else {
        alert('Сначала выберите режим игры');
        return;
    }
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        if (data.success) {
            // Отображаем корабль
            for (let pos of positions) {
                const cell = getCell('placementBoard', pos.x, pos.y);
                if (cell) {
                    cell.classList.add('ship');
                    cell.classList.remove('preview');
                }
            }
            
            placedShips[selectedShipSize]++;
            updatePlacementUI();
            
            // Сбрасываем выбор
            selectedShipSize = 0;
            document.querySelectorAll('.btn-ship').forEach(btn => btn.classList.remove('selected'));
            clearPreview();
        } else {
            alert(data.error || 'Не удалось разместить корабль');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при размещении корабля: ' + error.message);
    }
}


// ==============================
// ИГРОВАЯ ФАЗА
// ==============================

// Начать игру (создать новую игру против ИИ)
async function startGame(vsAI = true) {
    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        alert('Введите ваше имя');
        return;
    }
    
    playerId = playerName;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/game`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                player_id: playerId,
                vs_ai: vsAI
            })
        });
        
        const data = await response.json();
        gameId = data.game_id;
        currentGameState = data;
        
        // Показываем интерфейс расстановки
        document.getElementById('gameIdDisplay').textContent = gameId;
        document.getElementById('placementGameId').textContent = gameId;
        document.getElementById('playerIdDisplay').textContent = playerId;
        
        document.querySelector('.game-setup').style.display = 'none';
        document.getElementById('placementContainer').style.display = 'block';
        
        initPlacementBoard();
        updatePlacementUI();
        
        addLog('Игра создана! Расставьте свои корабли.');
        
    } catch (error) {
        console.error('Ошибка создания игры:', error);
        alert(`Ошибка: ${error.message}`);
    }
}

// Инициализация игрового поля
function initializeBoard(boardId) {
    const board = document.getElementById(boardId);
    board.innerHTML = '';
    
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            
            if (boardId === 'opponentBoard') {
                cell.addEventListener('click', () => handleAttack(x, y));
            }
            
            board.appendChild(cell);
        }
    }
}

async function displayPlayerShipsAfterPlacement() {
    // Если есть корабли на поле расстановки - копируем на игровое поле
    const shipCells = document.querySelectorAll('#placementBoard .cell.ship');
    
    if (shipCells.length > 0) {
        shipCells.forEach(placementCell => {
            const x = placementCell.dataset.x;
            const y = placementCell.dataset.y;
            const gameCell = getCell('playerBoard', x, y);
            if (gameCell) {
                gameCell.classList.add('ship', 'player-ship');
                gameCell.textContent = '🚢';
            }
        });
    } else {
        await fetchPlayerShipPositions();
    }
}

async function fetchPlayerShipPositions() {
    if (gameType === 'multiplayer' && currentRoomCode) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/multiplayer/room/${currentRoomCode}/state?player_id=${playerId}`);
            const data = await response.json();
            
            if (data.game) {
                console.log('Game state loaded:', data.game);
            }
        } catch (error) {
            console.error('Ошибка при получении состояния игры:', error);
        }
    }
}

// Функция для симуляции хода ИИ
async function simulateAITurn() {
    try {
        // Запрашиваем у сервера ход ИИ
        const response = await fetch(`${API_BASE_URL}/api/game/${gameId}/ai-turn`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.ai_shots) {
                processAIShots(data.ai_shots);
            }
        }
    } catch (error) {
        console.error('Ошибка симуляции хода ИИ:', error);
    }
}

function processAIShots(aiShots) {
    if (!aiShots || aiShots.length === 0) return;
    
    let delay = 0;
    
    aiShots.forEach((shot, index) => {
        setTimeout(() => {
            const cell = getCell('playerBoard', shot.x, shot.y);
            
            if (shot.result === 'hit') {
                cell.classList.add('hit');
                cell.textContent = '💥';
                
                // Если ИИ потопил корабль
                if (shot.sunk && shot.sunk_positions) {
                    shot.sunk_positions.forEach(pos => {
                        const sunkCell = getCell('playerBoard', pos[0], pos[1]);
                        if (sunkCell) {
                            sunkCell.classList.add('sunk');
                            sunkCell.textContent = '💀';
                        }
                    });
                    addLog(`ИИ потопил ваш корабль!`);
                } else {
                    addLog(`ИИ попал в (${shot.x}, ${shot.y})!`);
                }
                
                // Если ИИ попал и это последний выстрел в серии
                if (index === aiShots.length - 1) {
                    updateTurnIndicator('player1');
                    addLog('ИИ закончил серию выстрелов. Ваш ход!');
                }
            } else {
                cell.classList.add('miss');
                cell.textContent = '⭕';
                addLog(`ИИ промахнулся в (${shot.x}, ${shot.y})`);
                
                // ИИ промахнулся - ход игрока
                if (index === aiShots.length - 1) {
                    updateTurnIndicator('player1');
                    addLog('ИИ промахнулся. Ваш ход!');
                }
            }
            
            if (shot.result === 'hit' && shot.sunk && index === aiShots.length - 1) {
            }
        }, delay);
        
        delay += 1000;
    });
}

// Вспомогательная функция для получения клетки
function getCell(boardId, x, y) {
    return document.querySelector(`#${boardId} .cell[data-x="${x}"][data-y="${y}"]`);
}

// Функция опроса состояния игры
function startGamePolling() {
    setInterval(async () => {
        if (!gameId) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/game/${gameId}/state`);
            currentGameState = await response.json();
            
            // Обновляем UI в зависимости от состояния
            if (currentGameState.status === 'active') {
                document.getElementById('gameStatus').textContent = 'Игра идет';
                document.getElementById('turnIndicator').textContent = 
                    currentGameState.current_turn === 'player1' ? 'Ваш ход!' : 'Ход противника';
            }
        } catch (error) {
            console.error('Ошибка опроса:', error);
        }
    }, 2000);
}

// Обновите функцию updateTurnIndicator
function updateTurnIndicator(turn) {
    const indicator = document.getElementById('turnIndicator');
    const status = document.getElementById('gameStatus');
    
    if (turn === 'player1') {
        indicator.textContent = 'Ваш ход';
        indicator.style.color = '#28a745';
        status.textContent = 'Атакуйте!';
        
        // Для ИИ разблокируем поле
        if (gameType === 'ai') {
            unlockBoardForAI();
        }
    } else if (turn === 'player2') {
        indicator.textContent = 'Ход противника';
        indicator.style.color = '#dc3545';
        status.textContent = 'Ожидание...';
    } else if (turn === 'AI') {
        indicator.textContent = 'Ходит ИИ';
        indicator.style.color = '#ffc107';
        status.textContent = 'ИИ думает...';
        
        // Для ИИ блокируем поле
        if (gameType === 'ai') {
            lockBoardForAI();
        }
    }
}

// Добавление записи в журнал
function addLog(message) {
    const log = document.getElementById('gameLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

async function joinGame() {
    alert('Режим мультиплеера пока не реализован. Создайте игру против ИИ.');
}

// Начать новую игру
function restartGame() {
    if (confirm('Начать новую игру?')) {
        location.reload();
    }
}