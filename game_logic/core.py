import random
from typing import List, Tuple, Optional, Set

class Ship:
    def __init__(self, length: int, positions: List[Tuple[int, int]]):
        self.length = length
        self.positions = positions
        self.hits = set()
    
    def is_sunk(self) -> bool:
        return len(self.hits) == len(self.positions)

class Board:
    SIZE = 10
    
    def __init__(self):
        self.grid = [['~' for _ in range(self.SIZE)] for _ in range(self.SIZE)]
        self.ships = []
        self.misses = set()
    
    def place_ship(self, ship: Ship) -> bool:
        """Старый метод для обратной совместимости"""
        return self.place_ship_manual(ship.positions)[0]
    
    def place_ship_manual(self, positions):
        """Размещение корабля вручную с проверкой правил"""
        try:
            int_positions = []
            for pos in positions:
                if isinstance(pos, list):
                    x, y = int(pos[0]), int(pos[1])
                else:
                    x, y = int(pos[0]), int(pos[1])
                int_positions.append((x, y))
            positions = int_positions
        except (ValueError, TypeError, IndexError) as e:
            return False, f"Некорректные координаты: {pos}"
        
        # Проверяем, что все клетки в пределах доски
        for x, y in positions:
            if not (0 <= x < self.SIZE and 0 <= y < self.SIZE):
                return False, "Корабль выходит за пределы доски"
        
        # Проверяем, что клетки свободны
        for x, y in positions:
            if self.grid[y][x] != '~':
                return False, "Клетка уже занята"
        
        # Проверяем, что корабли не соприкасаются
        for x, y in positions:
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    nx, ny = x + dx, y + dy
                    if (0 <= nx < self.SIZE and 0 <= ny < self.SIZE and 
                        self.grid[ny][nx] != '~'):
                        return False, "Корабли не должны соприкасаться"
        
        # Если все проверки пройдены - размещаем корабль
        ship = Ship(len(positions), positions)
        for x, y in positions:
            self.grid[y][x] = 'S'
        self.ships.append(ship)
        return True, "Корабль размещен"

    def auto_place_all_ships(self):
        """Автоматическая расстановка всех кораблей по правилам"""
        ship_lengths = [4, 3, 3, 2, 2, 1, 1]
        self.ships = []
        self.grid = [['~' for _ in range(self.SIZE)] for _ in range(self.SIZE)]
        
        for length in ship_lengths:
            placed = False
            attempts = 0
            
            while not placed and attempts < 100:
                horizontal = random.choice([True, False])
                
                if horizontal:
                    max_x = self.SIZE - length
                    max_y = self.SIZE - 1
                    start_x = random.randint(0, max_x)
                    start_y = random.randint(0, max_y)
                    positions = [(start_x + i, start_y) for i in range(length)]
                else:
                    max_x = self.SIZE - 1
                    max_y = self.SIZE - length
                    start_x = random.randint(0, max_x)
                    start_y = random.randint(0, max_y)
                    positions = [(start_x, start_y + i) for i in range(length)]
                
                # Проверяем, можно ли разместить
                can_place = True
                for x, y in positions:
                    if not (0 <= x < self.SIZE and 0 <= y < self.SIZE) or self.grid[y][x] != '~':
                        can_place = False
                        break
                    
                    for dx in [-1, 0, 1]:
                        for dy in [-1, 0, 1]:
                            nx, ny = x + dx, y + dy
                            if (0 <= nx < self.SIZE and 0 <= ny < self.SIZE and 
                                self.grid[ny][nx] != '~'):
                                can_place = False
                                break
                    if not can_place:
                        break
                
                if can_place:
                    ship = Ship(length, positions)
                    for x, y in positions:
                        self.grid[y][x] = 'S'
                    self.ships.append(ship)
                    placed = True
                
                attempts += 1
            
            if not placed:
                # Если не удалось разместить - начинаем заново
                return self.auto_place_all_ships()
        
        return True

    def receive_attack(self, x: int, y: int) -> dict:
        """Обработка атаки по координатам"""
        # Валидация координат
        if not (0 <= x < self.SIZE and 0 <= y < self.SIZE):
            return {'result': 'invalid'}
        
        # Проверка попадания
        for i, ship in enumerate(self.ships):
            if (x, y) in ship.positions:
                ship.hits.add((x, y))
                self.grid[y][x] = 'X'
                
                result = {
                    'result': 'hit',
                    'sunk': ship.is_sunk(),
                    'ship_id': i,
                    'ship_length': ship.length
                }
                
                if ship.is_sunk():
                    result['ship_positions'] = list(ship.positions)
                
                # Проверка победы
                if all(s.is_sunk() for s in self.ships):
                    result['game_over'] = True
                
                return result
        
        # Промах
        if (x, y) not in self.misses:
            self.misses.add((x, y))
            self.grid[y][x] = 'O'
        return {'result': 'miss'}
    
    def get_all_ship_positions(self):
        """Возвращает все позиции кораблей"""
        positions = []
        for ship in self.ships:
            positions.extend(ship.positions)
        return positions
    
class Game:
    def __init__(self, game_id: str, player1_id: str):
        self.id = game_id
        self.players = {'player1': player1_id, 'player2': None}
        self.boards = {'player1': Board(), 'player2': Board()}
        self.current_turn = 'player1'
        self.status = 'placement'
        self.winner = None
        self.ready_players = set()
        self.last_move = None
    
    def join_game(self, player2_id: str) -> bool:
        if self.players['player2'] is None:
            self.players['player2'] = player2_id
            return True
        return False
    
# ==============================
# КЛАССЫ ДЛЯ МУЛЬТИПЛЕЕРА
# ==============================

import time
from typing import Dict, Optional

class GameRoom:
    """Комната для мультиплеерной игры"""
    
    def __init__(self, room_code: str, creator_id: str):
        self.room_code = room_code
        self.creator_id = creator_id
        self.player1_id = creator_id
        self.player2_id = None
        self.game: Optional[Game] = None
        self.status = 'waiting'
        self.created_at = time.time()
        self.last_activity = time.time()
        self.player1_ready = False
        self.player2_ready = False
    
    def join(self, player_id: str) -> bool:
        """Присоединить второго игрока"""
        if self.player2_id is None and player_id != self.player1_id:
            self.player2_id = player_id
            self.last_activity = time.time()
            return True
        return False
    
    def leave(self, player_id: str):
        """Игрок покидает комнату"""
        was_creator = (player_id == self.player1_id)
        
        if player_id == self.player1_id:
            self.player1_id = None
        elif player_id == self.player2_id:
            self.player2_id = None
        
        
        if was_creator and self.status == 'waiting':
            # Создатель вышел до начала игры - удаляем комнату
            self.game = None
            self.player1_ready = False
            self.player2_ready = False
            return True
        
        elif self.status in ['placement', 'active']:
            # Игра началась и кто-то вышел - удаляем комнату
            self.game = None
            self.status = 'waiting'
            self.player1_ready = False
            self.player2_ready = False
            return True
        
        elif player_id == self.player2_id and self.status == 'waiting':
            # Второй игрок вышел из лобби - сбрасываем его готовность
            self.player2_ready = False
            return False
        
        return False
    
    def is_full(self) -> bool:
        """Проверка, что комната заполнена"""
        return self.player1_id is not None and self.player2_id is not None
    
    def set_player_ready(self, player_id: str):
        """Игрок готов к игре"""
        if player_id == self.player1_id:
            self.player1_ready = True
        elif player_id == self.player2_id:
            self.player2_ready = True
        
        # Проверяем, оба ли игрока готовы и комната полна
        if self.is_full() and self.player1_ready and self.player2_ready and self.status == 'waiting':
            self.start_game()
    
    def start_game(self):
        """Начать игру в комнате"""
        if self.is_full() and self.player1_ready and self.player2_ready:
            # Создаем игру
            self.game = Game(
                game_id=f"multi_{self.room_code}",
                player1_id=self.player1_id
            )
            self.game.players['player2'] = self.player2_id
            self.game.status = 'placement'
            self.status = 'placement'
            self.last_activity = time.time()
            print(f"Создана игра в комнате {self.room_code}, статус: placement")
    
    def update_activity(self):
        """Обновить время последней активности"""
        self.last_activity = time.time()
    
    def cleanup_if_inactive(self, timeout_seconds: int = 300) -> bool:
        """Очистить комнату если она неактивна. Возвращает True если комната была очищена"""
        if time.time() - self.last_activity > timeout_seconds:
            # Комната неактивна более 5 минут
            return True
        return False
    
    def to_dict(self):
        """Преобразовать комнату в словарь для JSON"""
        return {
            'room_code': self.room_code,
            'player1_id': self.player1_id,
            'player2_id': self.player2_id,
            'status': self.status,
            'created_at': self.created_at,
            'player1_ready': self.player1_ready,
            'player2_ready': self.player2_ready,
            'has_game': self.game is not None
        }


class GameManager:
    """Менеджер для управления игровыми комнатами"""
    
    def __init__(self):
        self.rooms: Dict[str, GameRoom] = {}
        self.room_codes = set()
    
    def create_room(self, player_id: str) -> str:
        """Создать новую комнату с уникальным кодом"""
        import random
        import string
        
        # Генерация 6-значного кода
        while True:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in self.room_codes:
                break
        
        room = GameRoom(code, player_id)
        self.rooms[code] = room
        self.room_codes.add(code)
        return code
    
    def join_room(self, room_code: str, player_id: str) -> bool:
        """Присоединиться к комнате"""
        room = self.rooms.get(room_code)
        if room and not room.is_full() and room.status == 'waiting':
            return room.join(player_id)
        return False
    
    def leave_room(self, room_code: str, player_id: str):
        """Покинуть комнату"""
        room = self.rooms.get(room_code)
        if room:
            should_delete = room.leave(player_id)
            
            if should_delete:
                # Удаляем комнату полностью
                del self.rooms[room_code]
                self.room_codes.remove(room_code)
            else:
                # Обновляем активность, но сохраняем комнату
                room.update_activity()
                
                # Если оба игрока вышли - все равно удаляем комнату
                if room.player1_id is None and room.player2_id is None:
                    del self.rooms[room_code]
                    self.room_codes.remove(room_code)
    
    def get_room(self, room_code: str) -> Optional[GameRoom]:
        """Получить комнату по коду"""
        return self.rooms.get(room_code)
    
    def cleanup_inactive_rooms(self):
        """Очистить неактивные комнаты"""
        inactive_codes = []
        for code, room in self.rooms.items():
            if room.cleanup_if_inactive():
                inactive_codes.append(code)
        
        for code in inactive_codes:
            del self.rooms[code]
            self.room_codes.remove(code)

    def get_room_for_player(self, player_id: str) -> Optional[str]:
        """Найти комнату по ID игрока"""
        for code, room in self.rooms.items():
            if room.player1_id == player_id or room.player2_id == player_id:
                return code
        return None

# Создаем глобальный экземпляр менеджера комнат
game_manager = GameManager()