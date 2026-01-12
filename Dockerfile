FROM python:3.12-slim

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Копируем остальной код
COPY . .

# Создаем пользователя для безопасности
RUN useradd -m -u 1000 appuser
USER appuser

# Порт который будет слушать приложение
EXPOSE 5000

# Запускаем приложение
CMD ["python", "app.py"]