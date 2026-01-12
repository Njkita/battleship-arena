from flask import Blueprint, request, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect, generate_csrf
import uuid
import json
import random
import time

from config import Config
from game_logic.core import Game, Board, Ship, GameManager, GameRoom, game_manager
from game_logic.ai import BattleshipAI
from security.rate_limiter import limiter
from security.validation import validate_game_input
from api.models import (
    AttackRequest, CreateGameRequest, JoinGameRequest,
    CreateRoomRequest, JoinRoomRequest, LeaveRoomRequest,
    PlayerReadyRequest, MultiplayerAttackRequest
)

api_bp = Blueprint('api', __name__)
CORS(api_bp, supports_credentials=True)
csrf = CSRFProtect()

# хранилище игр
active_games = {}
ai_players = {}

@api_bp.route('/api/csrf-token', methods=['GET'])
def get_csrf_token():
    """Возвращает CSRF-токен для защиты форм"""
    return jsonify({'csrf_token': generate_csrf()})

@api_bp.route('/api/game', methods=['POST'])
@limiter.limit("10 per minute")
def create_game():
    """Создание новой игровой сессии с фазой расстановки (ПРОТИВ ИИ)"""
    try:
        data = CreateGameRequest(**request.get_json())
        game_id = str(uuid.uuid4())[:8]
        
        new_game = Game(game_id=game_id, player1_id=data.player_id)
                
        # Если игра против ИИ, создаем бота и расставляем ему корабли
        if data.vs_ai:
            new_game.players['player2'] = 'AI_BOT'
            new_game.boards['player2'].auto_place_all_ships()
            ai_players[game_id] = BattleshipAI()
        
        active_games[game_id] = new_game
        
        return jsonify({
            'game_id': game_id,
            'status': new_game.status,
            'player': 'player1'
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# ==============================
# API ДЛЯ МУЛЬТИПЛЕЕРА
# ==============================

@api_bp.route('/api/multiplayer/room', methods=['POST'])
@limiter.limit("10 per minute")
def create_multiplayer_room():
    """Создание комнаты для мультиплеера"""
    try:
        data = CreateRoomRequest(**request.get_json())
        
        room_code = game_manager.create_room(data.player_id)
        room = game_manager.get_room(room_code)
        
        return jsonify({
            'success': True,
            'room_code': room_code,
            'player_id': data.player_id,
            'room': room.to_dict()
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/room/<room_code>/join', methods=['POST'])
@limiter.limit("10 per minute")
def join_multiplayer_room(room_code):
    """Присоединение к комнате мультиплеера"""
    try:
        data = JoinRoomRequest(**request.get_json())
        
        room = game_manager.get_room(room_code)
        if not room:
            return jsonify({'error': 'Комната не найдена'}), 404
        
        success = room.join(data.player_id)
        if not success:
            return jsonify({'error': 'Не удалось присоединиться к комнате'}), 400
        
        room.update_activity()
        
        return jsonify({
            'success': True,
            'room_code': room_code,
            'player_id': data.player_id,
            'room': room.to_dict()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/room/<room_code>/leave', methods=['POST'])
def leave_multiplayer_room(room_code):
    """Покинуть комнату"""
    try:
        data = LeaveRoomRequest(**request.get_json())
        
        room = game_manager.get_room(room_code)
        if not room:
            return jsonify({'error': 'Комната не найдена'}), 404
        
        player_left_message = f"Игрок {data.player_id} покинул комнату"
        
        game_manager.leave_room(room_code, data.player_id)
        
        return jsonify({
            'success': True,
            'message': player_left_message,
            'room_deleted': game_manager.get_room(room_code) is None
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/room/<room_code>/ready', methods=['POST'])
@limiter.limit("30 per minute")
def multiplayer_player_ready(room_code):
    """Игрок готов к игре в мультиплеере"""
    try:
        data = PlayerReadyRequest(**request.get_json())
        
        room = game_manager.get_room(room_code)
        if not room:
            return jsonify({'error': 'Комната не найдена'}), 404
        
        if data.player_id not in [room.player1_id, room.player2_id]:
            return jsonify({'error': 'Вы не в этой комнате'}), 403
        
        print(f"Игрок {data.player_id} готов в комнате {room_code}")
        print(f"Статус комнаты до: {room.status}")
        print(f"Игроки: {room.player1_id} (готов: {room.player1_ready}), {room.player2_id} (готов: {room.player2_ready})")
        
        room.set_player_ready(data.player_id)
        room.update_activity()
        
        print(f"Статус комнаты после: {room.status}")
        print(f"Игра создана: {room.game is not None}")
        
        # Если игра создана, проверяем, все ли корабли расставлены
        if room.game:
            game = room.game
            
            player_role = None
            if data.player_id == game.players['player1']:
                player_role = 'player1'
            elif data.player_id == game.players['player2']:
                player_role = 'player2'
            
            if player_role:
                ships_count = len(game.boards[player_role].ships)
                required_ships = 7
                
                if ships_count != required_ships:
                    return jsonify({
                        'success': False,
                        'error': f'Нужно расставить {required_ships} кораблей, а у вас {ships_count}'
                    }), 400
                
                # Добавляем игрока в ready_players игры
                game.ready_players.add(player_role)
                
                # Проверяем, все ли игроки готовы (имеют корабли и нажали готов)
                if len(game.ready_players) == 2:
                    game.status = 'active'
                    game.current_turn = 'player1'
                    room.status = 'active'
                    print(f"Игра {room_code} началась! Все игроки готовы.")
        
        return jsonify({
            'success': True,
            'room': room.to_dict(),
            'game_id': room.game.id if room.game else None
        })
        
    except Exception as e:
        print(f"Ошибка в multiplayer_player_ready: {e}")
        return jsonify({'error': str(e)}), 400

def get_limiter():
    return Limiter(
        key_func=get_remote_address,
        default_limits=["200 per minute", "3 per second"],
        storage_uri="memory://"
    )

@api_bp.route('/api/multiplayer/room/<room_code>/state', methods=['GET'])
@limiter.limit("100 per minute, 5 per second")
def get_multiplayer_room_state(room_code):
    """Получить состояние комнаты"""
    room = game_manager.get_room(room_code)
    if not room:
        return jsonify({'error': 'Комната не найдена'}), 404
    
    room.update_activity()
    
    response = {
        'room': room.to_dict()
    }
    
    # Если игра уже началась, добавляем информацию об игре
    if room.game:
        game = room.game
        
        # Определяем, какой игрок делает запрос
        player_id = request.args.get('player_id')
        if player_id:
            player_role = None
            if player_id == game.players['player1']:
                player_role = 'player1'
            elif player_id == game.players['player2']:
                player_role = 'player2'
            
            if player_role:
                opponent_role = 'player2' if player_role == 'player1' else 'player1'
                
                my_board = game.boards[player_role]
                opponent_board = game.boards[opponent_role]
                
                # Собираем полную информацию о попаданиях
                my_hits = []
                opponent_hits = []
                
                # Собираем информацию о попаданиях на моей доске
                for y in range(10):
                    for x in range(10):
                        cell = my_board.grid[y][x]
                        if cell == 'X':  # Попадание по моему кораблю
                            my_hits.append({'x': x, 'y': y, 'type': 'hit'})
                        elif cell == 'O':  # Промах по моей доске
                            my_hits.append({'x': x, 'y': y, 'type': 'miss'})
                
                # Собираем информацию о попаданиях на доске противника
                for y in range(10):
                    for x in range(10):
                        cell = opponent_board.grid[y][x]
                        if cell == 'X':  # Мое попадание
                            opponent_hits.append({'x': x, 'y': y, 'type': 'hit'})
                        elif cell == 'O':  # Мой промах
                            opponent_hits.append({'x': x, 'y': y, 'type': 'miss'})
                
                response['game'] = {
                    'game_id': game.id,
                    'status': game.status,
                    'current_turn': game.current_turn,
                    'winner': game.winner,
                    'player_role': player_role,
                    'my_board_hits': my_hits,
                    'opponent_board_hits': opponent_hits,
                    'my_ships_remaining': len([s for s in my_board.ships if not s.is_sunk()]),
                    'opponent_ships_remaining': len([s for s in opponent_board.ships if not s.is_sunk()])
                }
    
    return jsonify(response)

@api_bp.route('/api/multiplayer/room/<room_code>/place_ship', methods=['POST'])
def multiplayer_place_ship(room_code):
    """Размещение корабля в мультиплеерной игре"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        positions = data.get('positions')
        
        room = game_manager.get_room(room_code)
        if not room or not room.game:
            return jsonify({'error': 'Room or game not found'}), 404
        
        game = room.game
        
        player_role = None
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
        
        if not player_role:
            return jsonify({'error': 'Player not found in game'}), 404
        
        # Преобразуем формат данных из фронтенда
        formatted_positions = []
        for pos in positions:
            if isinstance(pos, dict) and 'x' in pos and 'y' in pos:
                formatted_positions.append([pos['x'], pos['y']])
            elif isinstance(pos, list) and len(pos) == 2:
                formatted_positions.append(pos)
            else:
                return jsonify({'success': False, 'error': f'Некорректный формат позиции: {pos}'}), 400
        
        success, message = game.boards[player_role].place_ship_manual(formatted_positions)
        
        if success:
            return jsonify({
                'success': True,
                'message': message,
                'ships_count': len(game.boards[player_role].ships)
            })
        else:
            return jsonify({'success': False, 'error': message}), 400
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/room/<room_code>/auto_place', methods=['POST'])
def multiplayer_auto_place(room_code):
    """Автоматическая расстановка всех кораблей в мультиплеерной игре"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        
        room = game_manager.get_room(room_code)
        if not room or not room.game:
            return jsonify({'error': 'Room or game not found'}), 404
        
        game = room.game
        
        player_role = None
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
        
        if not player_role:
            return jsonify({'error': 'Player not found in game'}), 404
        
        # Автоматическая расстановка
        game.boards[player_role].auto_place_all_ships()
        
        # Получаем позиции всех кораблей для отображения
        all_ship_positions = []
        for ship in game.boards[player_role].ships:
            all_ship_positions.extend(ship.positions)
        
        return jsonify({
            'success': True,
            'message': 'Корабли расставлены автоматически',
            'ships_count': len(game.boards[player_role].ships),
            'ship_positions': all_ship_positions
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@api_bp.route('/api/multiplayer/room/<room_code>/attack', methods=['POST'])
@limiter.limit("30 per minute")
def multiplayer_attack(room_code):
    """Ход в мультиплеерной игре"""
    try:
        data = MultiplayerAttackRequest(**request.get_json())
        
        # Валидация входных данных
        if not validate_game_input(data.x, data.y):
            return jsonify({'error': 'Invalid coordinates'}), 400
        
        # Проверяем комнату
        room = game_manager.get_room(room_code)
        if not room:
            print(f"Комната {room_code} не найдена")
            return jsonify({'error': 'Комната не найдена'}), 404
        
        if not room.game:
            print(f"В комнате {room_code} нет игры")
            return jsonify({'error': 'Игра не найдена'}), 404
        
        game = room.game
        
        # Проверяем статус игры
        if game.status != 'active':
            return jsonify({'error': 'Игра еще не началась'}), 400
        
        # Определяем, какой игрок атакует
        attacker_role = None
        if data.player_id == game.players['player1']:
            attacker_role = 'player1'
        elif data.player_id == game.players['player2']:
            attacker_role = 'player2'
        
        if not attacker_role:
            return jsonify({'error': 'Вы не участвуете в этой игре'}), 403
        
        # Проверяем, чей сейчас ход
        if game.current_turn != attacker_role:
            return jsonify({'error': 'Сейчас не ваш ход'}), 403
        
        # Определяем цель атаки
        target_role = 'player2' if attacker_role == 'player1' else 'player1'
        target_board = game.boards[target_role]
        
        # Выполняем атаку
        result = target_board.receive_attack(data.x, data.y)
        
        # Если попадание, находим корабль и добавляем позиции если потоплен
        if result['result'] == 'hit':
            ship_index = result.get('ship_id')
            if ship_index is not None:
                ship = target_board.ships[ship_index]
                
                # Если корабль потоплен - добавляем его позиции в ответ
                if result.get('sunk'):
                    result['sunk_positions'] = list(ship.positions)
        
        if result.get('game_over'):
            game.status = 'finished'
            game.winner = attacker_role
            result['winner'] = attacker_role
            result['next_turn'] = None
            
            # Обновляем статус комнаты
            room.status = 'finished'
        else:
            # Передаем ход другому игроку
            if result['result'] == 'hit':
                # Попал - ходит снова
                game.current_turn = attacker_role
                result['next_turn'] = attacker_role
            else:
                # Промахнулся - передаем ход
                game.current_turn = target_role
                result['next_turn'] = target_role
        
        room.update_activity()
        
        response_data = {
            'result': result['result'],
            'sunk': result.get('sunk', False),
            'sunk_positions': result.get('sunk_positions', []),
            'game_over': result.get('game_over', False),
            'next_turn': result.get('next_turn', target_role),
            'attacker': attacker_role,
            'x': data.x,
            'y': data.y
        }
        
        # Добавляем победителя если игра завершена
        if result.get('game_over'):
            response_data['winner'] = attacker_role
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"Ошибка в multiplayer_attack: {e}")
        return jsonify({'error': str(e)}), 400

# ==============================
# СУЩЕСТВУЮЩИЕ API ДЛЯ ИГРЫ С ИИ
# ==============================

@api_bp.route('/api/game/<game_id>/place_ship', methods=['POST'])
def place_ship(game_id):
    """Размещение корабля игроком (работает для обеих игр)"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        positions = data.get('positions')
        
        # Определяем, это игра с ИИ или мультиплеер
        game = active_games.get(game_id)
        if not game:
            # Может быть мультиплеерная игра
            # Ищем комнату по ID игры (формат multi_XXXXXX)
            if game_id.startswith('multi_'):
                room_code = game_id[6:]  # Убираем 'multi_'
                room = game_manager.get_room(room_code)
                if room and room.game:
                    game = room.game
        
        if not game:
            return jsonify({'error': 'Game not found'}), 404
        
        # Определяем доску игрока
        player_role = None
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
        
        if not player_role:
            return jsonify({'error': 'Player not found in game'}), 404
        
        # Преобразуем формат данных из фронтенда
        formatted_positions = []
        for pos in positions:
            if isinstance(pos, dict) and 'x' in pos and 'y' in pos:
                formatted_positions.append([pos['x'], pos['y']])
            elif isinstance(pos, list) and len(pos) == 2:
                formatted_positions.append(pos)
            else:
                return jsonify({'success': False, 'error': f'Некорректный формат позиции: {pos}'}), 400
        
        # Вызываем метод place_ship_manual
        success, message = game.boards[player_role].place_ship_manual(formatted_positions)
        
        if success:
            return jsonify({
                'success': True,
                'message': message,
                'ships_count': len(game.boards[player_role].ships)
            })
        else:
            return jsonify({'success': False, 'error': message}), 400
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/game/<game_id>/auto_place', methods=['POST'])
def auto_place_ships(game_id):
    """Автоматическая расстановка всех кораблей (работает для обеих игр)"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        
        game = active_games.get(game_id)
        if not game:
            if game_id.startswith('multi_'):
                room_code = game_id[6:]
                room = game_manager.get_room(room_code)
                if room and room.game:
                    game = room.game
        
        if not game:
            return jsonify({'error': 'Game not found'}), 404
        
        player_role = None
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
        
        if not player_role:
            return jsonify({'error': 'Player not found in game'}), 404
        
        # Автоматическая расстановка
        game.boards[player_role].auto_place_all_ships()
        
        # Получаем позиции всех кораблей для отображения
        all_ship_positions = []
        for ship in game.boards[player_role].ships:
            all_ship_positions.extend(ship.positions)
        
        return jsonify({
            'success': True,
            'message': 'Корабли расставлены автоматически',
            'ships_count': len(game.boards[player_role].ships),
            'ship_positions': all_ship_positions
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/game/<game_id>/ready', methods=['POST'])
def player_ready(game_id):
    """Игрок готов начать (завершил расстановку) - работает для обеих игр"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        
        game = active_games.get(game_id)
        room = None
        
        if not game:
            if game_id.startswith('multi_'):
                room_code = game_id[6:]
                room = game_manager.get_room(room_code)
                if room and room.game:
                    game = room.game
        
        if not game:
            return jsonify({'error': 'Game not found'}), 404
        
        # Определяем, какой это игрок
        player_role = None
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
        
        if not player_role:
            return jsonify({'error': 'Player not found in game'}), 404
        
        ships_count = len(game.boards[player_role].ships)
        required_ships = 7  # 1x4, 2x3, 2x2, 2x1
        
        if ships_count != required_ships:
            return jsonify({
                'success': False,
                'error': f'Нужно расставить {required_ships} кораблей, а у вас {ships_count}'
            }), 400
        
        game.ready_players.add(player_role)
        
        if room:
            print(f"Игрок {player_id} готов к бою в мультиплеере. Готовых: {len(game.ready_players)}/2")
        
        # Если все игроки готовы (или игра с ИИ) - начинаем
        if len(game.ready_players) == 2 or (game.players['player2'] == 'AI_BOT' and player_role == 'player1'):
            game.status = 'active'
            game.current_turn = 'player1'
            
            if room:
                room.status = 'active'
                print(f"Мультиплеерная игра {room_code} началась!")
        
        return jsonify({
            'success': True,
            'status': game.status,
            'ready_players': list(game.ready_players)
        })
        
    except Exception as e:
        print(f"Ошибка в player_ready: {e}")
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/room/<room_code>/surrender', methods=['POST'])
def multiplayer_surrender(room_code):
    """Игрок сдался"""
    try:
        data = request.get_json()
        player_id = data.get('player_id')
        
        room = game_manager.get_room(room_code)
        if not room or not room.game:
            return jsonify({'error': 'Игра не найдена'}), 404
        
        game = room.game
        
        # Определяем, кто сдался
        surrender_role = None
        winner_role = None
        if player_id == game.players['player1']:
            surrender_role = 'player1'
            winner_role = 'player2'
        elif player_id == game.players['player2']:
            surrender_role = 'player2'
            winner_role = 'player1'
        
        if surrender_role:
            game.status = 'finished'
            game.winner = winner_role
            room.status = 'finished'
            
            return jsonify({
                'success': True,
                'message': f'Игрок {surrender_role} сдался. Победитель: {winner_role}',
                'winner': winner_role
            })
        
        return jsonify({'error': 'Игрок не найден'}), 404
        
    except Exception as e:
        print(f"Ошибка в multiplayer_surrender: {e}")
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/game/<game_id>/state', methods=['GET'])
def get_game_state(game_id):
    """Получение текущего состояния игры (работает для обеих игр)"""
    game = active_games.get(game_id)
    room = None
    
    if not game:
        if game_id.startswith('multi_'):
            room_code = game_id[6:]
            room = game_manager.get_room(room_code)
            if room and room.game:
                game = room.game
    
    if not game:
        return jsonify({'error': 'Game not found'}), 404
    
    # Определяем, какой игрок делает запрос
    player_id = request.args.get('player_id')
    player_role = None
    if player_id:
        if player_id == game.players['player1']:
            player_role = 'player1'
        elif player_id == game.players['player2']:
            player_role = 'player2'
    
    player1_ships = len(game.boards['player1'].ships)
    player2_ships = len(game.boards['player2'].ships)
    
    response = {
        'game_id': game.id,
        'status': game.status,
        'current_turn': game.current_turn,
        'players': game.players,
        'ready_players': list(game.ready_players),
        'player1_ships': player1_ships,
        'player2_ships': player2_ships,
        'winner': game.winner
    }
    
    if player_role:
        response['player_role'] = player_role
    
    return jsonify(response)

@api_bp.route('/api/game/<game_id>/attack', methods=['POST'])
@limiter.limit("30 per minute")
def attack(game_id):
    """Выполнение хода в игре с поддержкой ИИ"""
    try:
        data = AttackRequest(**request.get_json())
        
        # Валидация входных данных
        if not validate_game_input(data.x, data.y):
            return jsonify({'error': 'Invalid coordinates'}), 400
        
        game = active_games.get(game_id)
        if not game:
            return jsonify({'error': 'Game not found'}), 404
        
        if game.status != 'active':
            return jsonify({'error': 'Game is not active'}), 400
        
        if game.current_turn != 'player1':
            return jsonify({'error': 'Not your turn'}), 403
        
        # Ход игрока: атакуем поле ИИ (player2)
        target_board = game.boards['player2']
        result = target_board.receive_attack(data.x, data.y)
        
        # Если попадание, находим корабль и добавляем позиции если потоплен
        if result['result'] == 'hit':
            ship_index = result.get('ship_id')
            if ship_index is not None:
                ship = target_board.ships[ship_index]
                
                # Если корабль потоплен - добавляем его позиции в ответ
                if result.get('sunk'):
                    result['sunk_positions'] = list(ship.positions)
                
                # Если это ход ИИ и корабль потоплен - передаем позиции в ИИ
                if game.players['player2'] == 'AI_BOT' and result.get('sunk'):
                    ai = ai_players[game_id]
                    ai.record_shot(data.x, data.y, 'hit', list(ship.positions))
        
        # Записываем выстрел в историю ИИ (даже если промах)
        if game.players['player2'] == 'AI_BOT':
            ai = ai_players[game_id]
            sunk_positions = result.get('sunk_positions')
            ai.record_shot(data.x, data.y, result['result'], sunk_positions)
        
        if result.get('game_over'):
            game.status = 'finished'
            game.winner = 'player1'
            result['winner'] = 'player1'
            return jsonify(result)
        
        # Если игра против ИИ - делаем ответный ход
        if game.players['player2'] == 'AI_BOT' and not result.get('game_over'):
            ai_shots = []
            ai = ai_players[game_id]
            
            while True:
                # Генерируем ход ИИ
                ai_x, ai_y = ai.generate_shot()
                
                player_board = game.boards['player1']
                ai_result = player_board.receive_attack(ai_x, ai_y)
                
                if ai_result.get('sunk'):
                    ship_index = ai_result.get('ship_id')
                    if ship_index is not None:
                        ship = player_board.ships[ship_index]
                        ai_result['sunk_positions'] = list(ship.positions)
                
                ai.record_shot(ai_x, ai_y, ai_result['result'], 
                              ai_result.get('sunk_positions'))
                
                ai_shots.append({
                    'x': ai_x,
                    'y': ai_y,
                    'result': ai_result['result'],
                    'sunk': ai_result.get('sunk', False),
                    'sunk_positions': ai_result.get('sunk_positions')
                })
                
                if ai_result.get('game_over'):
                    game.status = 'finished'
                    game.winner = 'player2'
                    result['game_over'] = True
                    result['winner'] = 'player2'
                    break
                
                if ai_result['result'] != 'hit':
                    break
            
            result['ai_shots'] = ai_shots
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    
@api_bp.route('/api/game/<game_id>/ai-turn', methods=['POST'])
def ai_turn(game_id):
    """Отдельный endpoint для хода ИИ"""
    try:
        game = active_games.get(game_id)
        if not game:
            return jsonify({'error': 'Game not found'}), 404
        
        if game.players['player2'] != 'AI_BOT':
            return jsonify({'error': 'Not an AI game'}), 400
        
        if game.current_turn != 'player2':
            return jsonify({'error': 'Not AI turn'}), 400
        
        ai = ai_players.get(game_id)
        if not ai:
            return jsonify({'error': 'AI not initialized'}), 400
        
        # ИИ делает один выстрел
        ai_x, ai_y = ai.generate_shot()
        player_board = game.boards['player1']
        ai_result = player_board.receive_attack(ai_x, ai_y)
        
        # Если ИИ попал и потопил корабль, находим позиции
        if ai_result.get('sunk'):
            ship_index = ai_result.get('ship_id')
            if ship_index is not None:
                ship = player_board.ships[ship_index]
                ai_result['sunk_positions'] = list(ship.positions)
        
        # Записываем результат выстрела ИИ
        ai.record_shot(ai_x, ai_y, ai_result['result'], 
                      ai_result.get('sunk_positions'))
        
        if ai_result.get('game_over'):
            game.status = 'finished'
            game.winner = 'player2'
            ai_result['game_over'] = True
            ai_result['winner'] = 'player2'
            ai_result['next_turn'] = None
        
        elif ai_result['result'] == 'hit':
            game.current_turn = 'player2'
            ai_result['next_turn'] = 'ai'
        else:
            game.current_turn = 'player1'
            ai_result['next_turn'] = 'player'
        
        ai_result['ai_shots'] = [{
            'x': ai_x,
            'y': ai_y,
            'result': ai_result['result'],
            'sunk': ai_result.get('sunk', False),
            'sunk_positions': ai_result.get('sunk_positions')
        }]
        
        return jsonify(ai_result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# ==============================
# УТИЛИТЫ ДЛЯ МУЛЬТИПЛЕЕРА
# ==============================

@api_bp.route('/api/multiplayer/cleanup', methods=['POST'])
def cleanup_inactive_rooms():
    """Очистка неактивных комнат (админский эндпоинт)"""
    try:
        game_manager.cleanup_inactive_rooms()
        return jsonify({
            'success': True,
            'message': 'Неактивные комнаты очищены',
            'active_rooms': len(game_manager.rooms)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@api_bp.route('/api/multiplayer/stats', methods=['GET'])
def get_multiplayer_stats():
    """Получить статистику по мультиплееру"""
    return jsonify({
        'active_rooms': len(game_manager.rooms),
        'total_codes': len(game_manager.room_codes)
    })