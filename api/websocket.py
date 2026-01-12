from flask_socketio import SocketIO, emit, join_room, leave_room
from flask import request
import json
import time
from datetime import datetime
from game_logic.core import game_manager

# Инициализация SocketIO
socketio = None

def init_socketio(app):
    """Инициализация SocketIO с приложением"""
    global socketio
    socketio = SocketIO(app, 
                       cors_allowed_origins="*",
                       async_mode='threading',  # ← МЕНЯЕМ на 'threading'
                       ping_timeout=60,
                       ping_interval=25,
                       logger=True,
                       engineio_logger=False)
    return socketio

# Словарь для связи player_id и socket_id
player_sockets = {}
socket_players = {}

def get_players_in_room(room_code):
    """Получить всех игроков в комнате по их player_id"""
    room = game_manager.get_room(room_code)
    if not room:
        return []
    
    players = []
    if room.player1_id:
        players.append(room.player1_id)
    if room.player2_id:
        players.append(room.player2_id)
    return players

def broadcast_to_room(room_code, event, data, exclude_sid=None):
    """Отправить событие всем в комнате"""
    if socketio:
        socketio.emit(event, data, room=room_code, skip_sid=exclude_sid)
        print(f"[WebSocket] Broadcast {event} to room {room_code}")

def register_socketio_handlers():
    """Регистрация всех обработчиков WebSocket"""
    
    @socketio.on('connect')
    def handle_connect():
        print(f"[WebSocket] Client connected: {request.sid}")
        emit('connected', {'message': 'Connected to server'})
    
    @socketio.on('disconnect')
    def handle_disconnect():
        print(f"[WebSocket] Client disconnected: {request.sid}")
        
        player_id = socket_players.pop(request.sid, None)
        if player_id:
            player_sockets.pop(player_id, None)
            print(f"[WebSocket] Player {player_id} disconnected")
    
    @socketio.on('join_room')
    def handle_join_room(data):
        """Присоединиться к комнате"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            
            if not room_code or not player_id:
                emit('error', {'message': 'Missing room_code or player_id'})
                return
            
            room = game_manager.get_room(room_code)
            if not room:
                emit('error', {'message': 'Room not found'})
                return
            
            if player_id not in [room.player1_id, room.player2_id]:
                emit('error', {'message': 'Player not in room'})
                return
            
            join_room(room_code)
            
            # Сохраняем связь socket_id <-> player_id
            socket_players[request.sid] = player_id
            player_sockets[player_id] = request.sid
            
            print(f"[WebSocket] Player {player_id} joined room {room_code}")
            
            emit('room_joined', {
                'room_code': room_code,
                'player_id': player_id,
                'timestamp': time.time()
            })
            
            # Уведомляем других игроков в комнате
            broadcast_to_room(room_code, 'player_joined', {
                'player_id': player_id,
                'timestamp': time.time()
            }, exclude_sid=request.sid)
            
        except Exception as e:
            print(f"[WebSocket] Error in join_room: {e}")
            emit('error', {'message': str(e)})
    
    @socketio.on('leave_room')
    def handle_leave_room(data):
        """Покинуть комнату"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            
            if room_code:
                leave_room(room_code)
            
            if player_id:
                if player_id in player_sockets:
                    socket_id = player_sockets.pop(player_id)
                    socket_players.pop(socket_id, None)
                
                # Уведомляем комнату, что игрок вышел
                if room_code:
                    broadcast_to_room(room_code, 'player_left', {
                        'player_id': player_id,
                        'timestamp': time.time()
                    })
            
            print(f"[WebSocket] Player {player_id} left room {room_code}")
            
        except Exception as e:
            print(f"[WebSocket] Error in leave_room: {e}")
    
    @socketio.on('placement_complete')
    def handle_placement_complete(data):
        """Игрок завершил расстановку кораблей"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            
            if not room_code or not player_id:
                emit('error', {'message': 'Missing room_code or player_id'})
                return
            
            room = game_manager.get_room(room_code)
            if not room or not room.game:
                emit('error', {'message': 'Room or game not found'})
                return
            
            game = room.game
            
            player_role = None
            if player_id == game.players['player1']:
                player_role = 'player1'
            elif player_id == game.players['player2']:
                player_role = 'player2'
            
            if not player_role:
                emit('error', {'message': 'Player not in game'})
                return
            
            print(f"[WebSocket] Игрок {player_id} завершил расстановку в комнате {room_code}")
            
            # Проверяем, сколько кораблей расставлено у игрока
            ships_count = len(game.boards[player_role].ships)
            required_ships = 7  # 1x4, 2x3, 2x2, 2x1
            
            if ships_count < required_ships:
                emit('placement_error', {
                    'message': f'Нужно расставить {required_ships} кораблей, а у вас {ships_count}'
                })
                return
            
            game.ready_players.add(player_role)
            
            if len(game.ready_players) == 2:
                game.status = 'active'
                game.current_turn = 'player1'
                room.status = 'active'
                
                print(f"[WebSocket] Оба игрока готовы! Начинаем битву в комнате {room_code}")
                
                # Отправляем событие начала битвы всем игрокам
                broadcast_to_room(room_code, 'battle_started', {
                    'room': room.to_dict(),
                    'game': {
                        'game_id': game.id,
                        'status': game.status,
                        'current_turn': game.current_turn,
                        'players': game.players
                    },
                    'timestamp': time.time()
                })
            else:
                # Еще не все готовы - отправляем обновление
                broadcast_to_room(room_code, 'player_placement_complete', {
                    'player_id': player_id,
                    'ready_players': list(game.ready_players),
                    'ships_count': ships_count,
                    'timestamp': time.time()
                })
            
        except Exception as e:
            print(f"[WebSocket] Ошибка в placement_complete: {e}")
            emit('error', {'message': str(e)})


    @socketio.on('player_ready')
    def handle_player_ready(data):
        """Игрок готов к игре в мультиплеере"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            
            if not room_code or not player_id:
                emit('error', {'message': 'Missing room_code or player_id'})
                return
            
            room = game_manager.get_room(room_code)
            if not room:
                emit('error', {'message': 'Комната не найдена'})
                return
            
            print(f"[WebSocket] Игрок {player_id} готов в комнате {room_code}")
            print(f"[WebSocket] Статус комнаты: {room.status}")
            print(f"[WebSocket] Игроки: player1={room.player1_id}, player2={room.player2_id}")
            
            # Отмечаем игрока как готового
            if player_id == room.player1_id:
                room.player1_ready = True
                print(f"[WebSocket] Игрок 1 готов")
            elif player_id == room.player2_id:
                room.player2_ready = True
                print(f"[WebSocket] Игрок 2 готов")
            
            room.update_activity()
            
            # Проверяем, оба ли игрока готовы и есть ли второй игрок
            if room.player2_id and room.player1_ready and room.player2_ready:
                print(f"[WebSocket] Оба игрока готовы! Начинаем игру...")
                
                if not room.game:
                    room.start_game()
                
                room.status = 'placement'
                
                # Отправляем событие начала расстановки всем игрокам
                broadcast_to_room(room_code, 'placement_started', {
                    'room': room.to_dict(),
                    'message': 'Начинаем расстановку кораблей!',
                    'timestamp': time.time()
                })
                
                print(f"[WebSocket] Отправлено событие placement_started в комнату {room_code}")
            else:
                # Отправляем обновление о готовности
                broadcast_to_room(room_code, 'player_ready_update', {
                    'player_id': player_id,
                    'room': room.to_dict(),
                    'timestamp': time.time()
                })
            
        except Exception as e:
            print(f"[WebSocket] Ошибка в player_ready: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('make_move')
    def handle_make_move(data):
        """Игрок делает ход"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            x = data.get('x')
            y = data.get('y')
            
            if not room_code or not player_id or x is None or y is None:
                emit('error', {'message': 'Missing required data'})
                return
            
            # Проверяем координаты
            if not (0 <= x < 10 and 0 <= y < 10):
                emit('error', {'message': 'Invalid coordinates'})
                return
            
            room = game_manager.get_room(room_code)
            if not room or not room.game:
                emit('error', {'message': 'Room or game not found'})
                return
            
            game = room.game
            
            # Определяем роль игрока
            player_role = None
            if player_id == game.players['player1']:
                player_role = 'player1'
            elif player_id == game.players['player2']:
                player_role = 'player2'
            
            if not player_role:
                emit('error', {'message': 'Player not in game'})
                return
            
            # Проверяем, чей ход
            if game.current_turn != player_role:
                emit('move_rejected', {
                    'message': 'Not your turn',
                    'current_turn': game.current_turn
                })
                return
            
            # Выполняем атаку
            target_role = 'player2' if player_role == 'player1' else 'player1'
            target_board = game.boards[target_role]
            
            # Проверяем, не стреляли ли уже сюда
            if target_board.grid[y][x] in ['X', 'O']:
                emit('move_rejected', {
                    'message': 'Already attacked this cell',
                    'x': x,
                    'y': y
                })
                return
            
            result = target_board.receive_attack(x, y)
            
            # Если корабль потоплен, добавляем позиции
            if result['result'] == 'hit' and result.get('sunk'):
                ship_index = result.get('ship_id')
                if ship_index is not None:
                    ship = target_board.ships[ship_index]
                    result['sunk_positions'] = list(ship.positions)
            
            # Обновляем состояние игры
            game.last_move = {
                'player': player_role,
                'x': x,
                'y': y,
                'result': result['result'],
                'timestamp': time.time()
            }
            
            # Проверяем окончание игры
            if result.get('game_over'):
                game.status = 'finished'
                game.winner = player_role
                room.status = 'finished'
                result['winner'] = player_role
                result['next_turn'] = None
            else:
                if result['result'] == 'hit':
                    # Попал - ходит снова
                    game.current_turn = player_role
                    result['next_turn'] = player_role
                else:
                    # Промах - передаем ход
                    game.current_turn = target_role
                    result['next_turn'] = target_role
            
            room.update_activity()
            
            response_data = {
                'move': {
                    'player_id': player_id,
                    'player_role': player_role,
                    'x': x,
                    'y': y,
                    'result': result['result'],
                    'sunk': result.get('sunk', False),
                    'sunk_positions': result.get('sunk_positions', []),
                    'timestamp': time.time()
                },
                'game_state': {
                    'status': game.status,
                    'current_turn': game.current_turn,
                    'winner': game.winner if game.status == 'finished' else None
                }
            }
            
            # Отправляем результат хода ВСЕМ в комнате
            broadcast_to_room(room_code, 'move_result', response_data)
            
            print(f"[WebSocket] Move in room {room_code}: {player_id} attacked ({x},{y}) = {result['result']}")
            
            if result.get('game_over'):
                broadcast_to_room(room_code, 'game_finished', {
                    'winner': player_role,
                    'winner_id': player_id,
                    'room': room.to_dict(),
                    'timestamp': time.time()
                })
            
        except Exception as e:
            print(f"[WebSocket] Error in make_move: {e}")
            emit('error', {'message': str(e)})
    
    @socketio.on('get_game_state')
    def handle_get_game_state(data):
        """Запрос текущего состояния игры"""
        try:
            room_code = data.get('room_code')
            player_id = data.get('player_id')
            
            if not room_code or not player_id:
                emit('error', {'message': 'Missing room_code or player_id'})
                return
            
            room = game_manager.get_room(room_code)
            if not room or not room.game:
                emit('error', {'message': 'Room or game not found'})
                return
            
            game = room.game
            
            # Определяем роль игрока
            player_role = None
            if player_id == game.players['player1']:
                player_role = 'player1'
            elif player_id == game.players['player2']:
                player_role = 'player2'
            
            if not player_role:
                emit('error', {'message': 'Player not in game'})
                return
            
            # Формируем состояние игры
            game_state = {
                'room': room.to_dict(),
                'game': {
                    'status': game.status,
                    'current_turn': game.current_turn,
                    'winner': game.winner,
                    'player_role': player_role,
                    'last_move': game.last_move if hasattr(game, 'last_move') else None
                }
            }
            
            emit('game_state_update', game_state)
            
        except Exception as e:
            print(f"[WebSocket] Error in get_game_state: {e}")
            emit('error', {'message': str(e)})
    
    @socketio.on('ping')
    def handle_ping():
        """Пинг для поддержания соединения"""
        emit('pong', {'timestamp': time.time()})
    
    print("[WebSocket] Handlers registered")