# config.py
"""
Configuration file for the game engine and world generation settings.
"""
import os # Recommended for accessing environment variables

# --- Security and Authentication ---
# This is required by Flask for session management, flashing messages, and security.
# It should be a long, random, and secret string.
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'a-default-secret-key-for-development-only')

# --- Google OAuth Credentials ---
# These are obtained from the Google Cloud Console.
# It's best practice to store these as environment variables, not directly in the code.
GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID')
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET')

# --- MONGO DB
MONGO_URI = "mongodb://localhost:27017/valhalla_db"

# --- World Generation: General ---
# Number of oceans on the surface.
SURFACE_OCEANS = 4

# Number of separate seas in the subterranean layer.
SUBTERRANEAN_SEAS = 15

# --- World Generation: Geography ---
# RENAMED: For clarity, these now specify they are for the surface
MIN_SURFACE_DEEP_SEA_PERCENT = 0.20
MAX_SURFACE_DEEP_SEA_PERCENT = 0.40

# NEW: Configuration for Subterranean Sea coverage
MIN_SUBTERRANEAN_SEA_PERCENT = 0.05
MAX_SUBTERRANEAN_SEA_PERCENT = 0.15

# --- World Generation: Lava River Generation ---
# If True, generates long "rivers" of lava. If False, generates round "seas" of lava.
LAVA_RIVERS = True
# How many lava rivers to generate if LAVA_RIVERS is True.
NUM_LAVA_RIVERS = 25
# Lava River length
LAVA_RIVERS_MIN_LENGTH = 15
LAVA_RIVERS_MAX_LENGTH = 35

# --- World Generation: Terrain Spawn Chances ---
SPAWN_CHANCE_WASTE = 0.03
SPAWN_CHANCE_FARM = 0.02
SPAWN_CHANCE_CAVERN = 0.005 # 0.5% chance for a cavern

# --- Mountain Ranges ---
MOUNTAIN_RANGE_MIN_LENGTH = 8
MOUNTAIN_RANGE_MAX_LENGTH = 22

# --- Player and Game Setup ---
MAX_PLAYERS = 4
STARTING_RESOURCES = {
    "Platinum": 1000, "Food": 500, "Lumber": 500, "Mana": 100,
    "Ore": 100, "Gems": 10, "Research Points": 0, "Draftees": 50, "Peasants": 100
}
PLAYER_COLORS = [(255,0,0), (0,0,255), (0,255,255), (255,255,0)]

# --- World Scales ---
SCALES = ["Life/Death", "Heat/Cold", "Exertion/Torpor", "Magic/Drain", "Order/Chaos", "Luck/Woe"]

# --- Terrain Colors for Visualization ---
TERRAIN_COLORS = {
    "Deep Sea": 0x000033,
    "Sea": 0x00008B,
    "Plain": 0x90EE90,
    "Hill": 0x8B4513,
    "Forest": 0x006400,
    "Mountain": 0x808080,
    "Swamp": 0x556B2F,
    "Waste": 0xDEB887,
    "Farm": 0xFFD700,
    "Lava": 0xFC470A,
    # A default color for any unhandled cases
    "None": 0xff00ff, # Bright pink for debugging
}