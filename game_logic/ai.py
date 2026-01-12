import random
from typing import Tuple, List, Set
from .core import Board

class BattleshipAI:
    """Умный ИИ с логикой добивания кораблей"""
    
    def __init__(self, board_size: int = 10):
        self.board_size = board_size
        self.hits = []         # Все попадания
        self.misses = set()    # Промахи
        self.last_hits = []    # Попадания в текущий корабль
        self.hunting = False   # Режим охоты
        self.direction = None  # Направление корабля
        self.sunk_ships = []   # Потопленные корабли
        self.shot_history = set()
        self.forbidden_cells = set()  # Клетки вокруг потопленных кораблей
    
    def generate_shot(self) -> Tuple[int, int]:
        """Генерация умного выстрела"""
        if self.hunting and self.last_hits:
            return self._continue_hunt()
        
        # Исключаем клетки вокруг потопленных кораблей
        excluded = self.shot_history.union(self.forbidden_cells)
        
        candidates = []
        for x in range(self.board_size):
            for y in range(self.board_size):
                if (x + y) % 2 == 0 and (x, y) not in excluded:
                    candidates.append((x, y))
        
        if candidates:
            return random.choice(candidates)
        
        # Любая свободная клетка
        for x in range(self.board_size):
            for y in range(self.board_size):
                if (x, y) not in excluded:
                    return (x, y)
        
        return (random.randint(0, self.board_size-1), random.randint(0, self.board_size-1))
    
    def _continue_hunt(self) -> Tuple[int, int]:
        """Продолжение охоты за раненым кораблем"""
        if len(self.last_hits) == 1:
            # Первое попадание - пробуем все 4 стороны
            last_hit = self.last_hits[0]
            directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
            random.shuffle(directions)
            
            for dx, dy in directions:
                x, y = last_hit[0] + dx, last_hit[1] + dy
                if self._is_valid_target(x, y):
                    self.direction = (dx, dy)
                    return (x, y)
        else:
            # Уже есть направление - продолжаем в ту же сторону
            if self.direction:
                for end in [self.last_hits[0], self.last_hits[-1]]:
                    x, y = end[0] + self.direction[0], end[1] + self.direction[1]
                    if self._is_valid_target(x, y):
                        return (x, y)
                
                dx, dy = self.direction
                self.direction = (-dy, -dx) if random.choice([True, False]) else (dy, dx)
                last_hit = self.last_hits[0]
                x, y = last_hit[0] + self.direction[0], last_hit[1] + self.direction[1]
                if self._is_valid_target(x, y):
                    return (x, y)
        
        self.hunting = False
        self.direction = None
        return self.generate_shot()
    
    def _is_valid_target(self, x: int, y: int) -> bool:
        """Проверка, можно ли стрелять в клетку"""
        return (0 <= x < self.board_size and 0 <= y < self.board_size and
                (x, y) not in self.shot_history and
                (x, y) not in self.forbidden_cells)
    
    def record_shot(self, x: int, y: int, result: str, sunk_positions=None):
        """Запись результата выстрела"""
        self.shot_history.add((x, y))
        
        if result == 'hit':
            self.hits.append((x, y))
            self.last_hits.append((x, y))
            self.hunting = True
            
            if sunk_positions:
                self.sunk_ships.append(sunk_positions)
                # Добавляем запретные клетки вокруг корабля
                for sx, sy in sunk_positions:
                    for dx in [-1, 0, 1]:
                        for dy in [-1, 0, 1]:
                            nx, ny = sx + dx, sy + dy
                            if 0 <= nx < self.board_size and 0 <= ny < self.board_size:
                                self.forbidden_cells.add((nx, ny))
                # Сбрасываем охоту
                self.hunting = False
                self.last_hits = []
                self.direction = None
        else:
            self.misses.add((x, y))
            if self.hunting and len(self.last_hits) > 1:
                self.direction = (-self.direction[0], -self.direction[1])