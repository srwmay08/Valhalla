# srwmay08/valhalla/Valhalla-ab1992c87ec95d522d735b22aa531c67f43eb590/config.py
"""
Configuration file for the game engine settings.
"""

# --- Game Timing ---
# TICK_INTERVAL_SECONDS: How often the game state updates (e.g., resources are generated).
# Set to 60 for one-minute ticks as requested. Can be adjusted to 3600 for hours, etc.
TICK_INTERVAL_SECONDS = 60

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