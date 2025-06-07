# srwmay08/valhalla/Valhalla-ab1992c87ec95d522d735b22aa531c67f43eb590/config.py
"""
Configuration file for the game engine settings.
"""

# --- Game Timing ---
# GAME_SETUP_COUNTDOWN: The number of seconds the countdown lasts after a player chooses a start tile.
GAME_SETUP_COUNTDOWN = 15

# SECONDS_BETWEEN_TICKS: How often resources are generated once the game is running.
SECONDS_BETWEEN_TICKS = 60

# --- Player and Game Setup ---
# Starting resources for each player
STARTING_RESOURCES = {
    "Platinum": 1000,
    "Food": 500,
    "Lumber": 500,
    "Mana": 100,
    "Ore": 100,
    "Gems": 10,
    "Research Points": 0,
    "Draftees": 50,
    "Peasants": 100
}

# Maximum number of players and AI in a game session
MAX_PLAYERS = 4

# Colors to assign to players for visualization on the sphere
PLAYER_COLORS = [
    (255, 0, 0),     # Red
    (0, 0, 255),     # Blue
    (0, 255, 255),   # Cyan
    (255, 255, 0)    # Yellow
]