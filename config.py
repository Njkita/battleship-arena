import os
from dotenv import load_dotenv

load_dotenv()  # Загружаем переменные из .env

class Config:
    # Безопасность
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-fallback-key-change-in-production')
    DEBUG = os.getenv('FLASK_ENV') == 'development'
    
    # Разрешенные хосты для разработки
    ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
    
    # CSRF защита
    WTF_CSRF_ENABLED = os.getenv('CSRF_ENABLED', 'True').lower() == 'true'
    
    # Безопасные cookies (отключено для разработки)
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    CSRF_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    
    # Лимиты запросов
    RATELIMIT_DEFAULT = "200 per hour"
    RATELIMIT_STORAGE_URL = os.getenv('RATELIMIT_STORAGE_URL', 'memory://')
    
    # Отключаем сортировку JSON для удобства отладки
    JSON_SORT_KEYS = False