import re

def validate_game_input(x: int, y: int) -> bool:
    """Валидация игровых координат[citation:9]"""
    return isinstance(x, int) and isinstance(y, int) and 0 <= x <= 9 and 0 <= y <= 9

def sanitize_string(input_str: str, max_length=50) -> str:
    """Очистка строковых входных данных от опасных символов"""
    if not input_str:
        return ""
    
    cleaned = re.sub(r'[<>\"\';(){}[\]]', '', input_str)
    
    return cleaned[:max_length]