import unittest
import sys
import os
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app

class TestAPI(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.app.config['WTF_CSRF_ENABLED'] = False
        self.client = self.app.test_client()
        
        # Создаем тестовый CSRF токен
        with self.app.test_request_context():
            from flask_wtf.csrf import generate_csrf
            self.csrf_token = generate_csrf()
    
    def test_csrf_endpoint(self):
        response = self.client.get('/api/csrf-token')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('csrf_token', data)
    
    def test_create_game(self):
        response = self.client.post('/api/game', 
            json={'player_id': 'test_player', 'vs_ai': True},
            headers={'X-CSRFToken': self.csrf_token}
        )
        self.assertEqual(response.status_code, 201)
        data = json.loads(response.data)
        self.assertIn('game_id', data)
        self.assertIn('status', data)
    
    def test_create_game_no_player_id(self):
        response = self.client.post('/api/game',
            json={'vs_ai': True},
            headers={'X-CSRFToken': self.csrf_token}
        )
        self.assertEqual(response.status_code, 400)
    
    def test_attack_endpoint(self):
        # Сначала создаем игру
        create_response = self.client.post('/api/game',
            json={'player_id': 'test_player', 'vs_ai': True},
            headers={'X-CSRFToken': self.csrf_token}
        )
        game_data = json.loads(create_response.data)
        game_id = game_data['game_id']
        
        # Тестируем атаку
        attack_response = self.client.post(f'/api/game/{game_id}/attack',
            json={'x': 5, 'y': 5, 'game_id': game_id},
            headers={'X-CSRFToken': self.csrf_token}
        )
        self.assertEqual(attack_response.status_code, 200)
        attack_data = json.loads(attack_response.data)
        self.assertIn('result', attack_data)
    
    def test_attack_invalid_game(self):
        response = self.client.post('/api/game/invalid123/attack',
            json={'x': 5, 'y': 5, 'game_id': 'invalid123'},
            headers={'X-CSRFToken': self.csrf_token}
        )
        self.assertEqual(response.status_code, 404)
    
    def test_main_page(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Battleship', response.data)
    
    def test_static_files(self):
        response = self.client.get('/style.css')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'background', response.data)

if __name__ == '__main__':
    unittest.main(verbosity=2)