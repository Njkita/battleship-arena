import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from game_logic.core import Ship, Board, Game

class TestShip(unittest.TestCase):
    def test_ship_creation(self):
        ship = Ship(3, [(0, 0), (0, 1), (0, 2)])
        self.assertEqual(ship.length, 3)
        self.assertFalse(ship.is_sunk())
    
    def test_ship_hit(self):
        ship = Ship(2, [(0, 0), (0, 1)])
        ship.hits.add((0, 0))
        self.assertFalse(ship.is_sunk())
        ship.hits.add((0, 1))
        self.assertTrue(ship.is_sunk())

class TestBoard(unittest.TestCase):
    def setUp(self):
        self.board = Board()
    
    def test_board_initialization(self):
        self.assertEqual(len(self.board.grid), 10)
        self.assertEqual(len(self.board.grid[0]), 10)
        self.assertEqual(self.board.grid[0][0], '~')
    
    def test_valid_ship_placement(self):
        ship = Ship(3, [(0, 0), (0, 1), (0, 2)])
        result = self.board.place_ship(ship)
        self.assertTrue(result)
        self.assertEqual(len(self.board.ships), 1)
    
    def test_invalid_ship_placement(self):
        ship = Ship(3, [(0, 0), (0, 1), (0, 10)])  # y=10 вне границ
        result = self.board.place_ship(ship)
        self.assertFalse(result)
    
    def test_attack_hit(self):
        ship = Ship(1, [(5, 5)])
        self.board.place_ship(ship)
        result = self.board.receive_attack(5, 5)
        self.assertEqual(result['result'], 'hit')
        self.assertTrue(result['sunk'])
    
    def test_attack_miss(self):
        result = self.board.receive_attack(0, 0)
        self.assertEqual(result['result'], 'miss')
    
    def test_attack_invalid(self):
        result = self.board.receive_attack(10, 10)
        self.assertEqual(result['result'], 'invalid')

class TestGame(unittest.TestCase):
    def test_game_creation(self):
        game = Game("test123", "player1")
        self.assertEqual(game.id, "test123")
        self.assertEqual(game.players['player1'], "player1")
        self.assertIsNone(game.players['player2'])
        self.assertEqual(game.status, 'waiting')
    
    def test_join_game(self):
        game = Game("test123", "player1")
        result = game.join_game("player2")
        self.assertTrue(result)
        self.assertEqual(game.players['player2'], "player2")
        self.assertEqual(game.status, 'active')
    
    def test_double_join(self):
        game = Game("test123", "player1")
        game.join_game("player2")
        result = game.join_game("player3")
        self.assertFalse(result)

if __name__ == '__main__':
    unittest.main(verbosity=2)