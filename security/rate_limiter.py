from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["500 per hour", "100 per minute", "10 per second"],
    storage_uri="memory://",
    strategy="moving-window",
    headers_enabled=True
)

def init_rate_limiter(app):
    limiter.init_app(app)
    app.config['limiter'] = limiter
    return limiter