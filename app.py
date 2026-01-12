from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from config import Config
from api.routes import api_bp, csrf
from security.rate_limiter import init_rate_limiter
import os
from gevent import monkey
monkey.patch_all()

from api.websocket import init_socketio, register_socketio_handlers

def create_app():
    app = Flask(__name__, 
                static_folder='static',
                static_url_path='',
                template_folder='static')
    
    app.config.from_object(Config)
    
    # Включаем CORS
    CORS(app, supports_credentials=True, origins="*")
    
    # Инициализация CSRF защиты
    csrf.init_app(app)
    
    # Инициализация лимитера запросов
    init_rate_limiter(app)
    
    # Регистрация API blueprint
    app.register_blueprint(api_bp)
    
    # Инициализация WebSocket
    socketio = init_socketio(app)
    
    # Регистрация WebSocket обработчиков
    register_socketio_handlers()
    
    # Статические маршруты
    @app.route('/')
    def index():
        return send_from_directory(app.static_folder, 'index.html')
    
    @app.route('/<path:path>')
    def static_files(path):
        return send_from_directory(app.static_folder, path)
    
    # Обработчик ошибок для 404
    @app.errorhandler(404)
    def not_found(e):
        return send_from_directory(app.static_folder, 'index.html')
    
    # Health check endpoint
    @app.route('/health')
    def health():
        return jsonify({"status": "ok", "message": "Battleship server is running"})
    
    return app, socketio


if __name__ == '__main__':
    app, socketio = create_app()
    
    port = int(os.environ.get("PORT", 5002))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"
    
    socketio.run(
        app, 
        debug=True,
        host='0.0.0.0', 
        port=5002,
        use_reloader=False,
        log_output=True,
        allow_unsafe_werkzeug=True
    )