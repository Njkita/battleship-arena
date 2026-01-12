from pydantic import BaseModel, Field, validator
from typing import Optional

class AttackRequest(BaseModel):
    x: int = Field(ge=0, le=9, description="Координата X (0-9)")
    y: int = Field(ge=0, le=9, description="Координата Y (0-9)")
    game_id: str = Field(min_length=8, max_length=64)

class CreateGameRequest(BaseModel):
    player_id: str = Field(min_length=3, max_length=50)
    vs_ai: bool = False

class JoinGameRequest(BaseModel):
    game_id: str = Field(min_length=8, max_length=64)
    player_id: str = Field(min_length=3, max_length=50)

# ==============================
# МОДЕЛИ ДЛЯ МУЛЬТИПЛЕЕРА
# ==============================

class CreateRoomRequest(BaseModel):
    player_id: str = Field(min_length=3, max_length=50)
    player_name: str = Field(min_length=3, max_length=50)

class JoinRoomRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=6)
    player_id: str = Field(min_length=3, max_length=50)
    player_name: str = Field(min_length=3, max_length=50)

class LeaveRoomRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=6)
    player_id: str = Field(min_length=3, max_length=50)

class PlayerReadyRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=6)
    player_id: str = Field(min_length=3, max_length=50)

class MultiplayerAttackRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=6)
    player_id: str = Field(min_length=3, max_length=50)
    x: int = Field(ge=0, le=9, description="Координата X (0-9)")
    y: int = Field(ge=0, le=9, description="Координата Y (0-9)")