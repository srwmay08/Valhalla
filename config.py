# config.py
"""
Configuration file for the game engine and world generation settings.
"""
import os

# --- Security and Authentication ---
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'a-default-secret-key-for-development-only')
GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID')
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET')

# --- MONGO DB ---
MONGO_URI = "mongodb://localhost:27017/valhalla_db"

# ==========================================
#        LEGACY WORLD GENERATION
# (Preserved for future terrain integration)
# ==========================================

# --- General ---
SURFACE_OCEANS = 4
SUBTERRANEAN_SEAS = 15

# --- Geography ---
MIN_SURFACE_DEEP_SEA_PERCENT = 0.20
MAX_SURFACE_DEEP_SEA_PERCENT = 0.40
MIN_SUBTERRANEAN_SEA_PERCENT = 0.05
MAX_SUBTERRANEAN_SEA_PERCENT = 0.15

# --- Lava ---
LAVA_RIVERS = True
NUM_LAVA_RIVERS = 25
LAVA_RIVERS_MIN_LENGTH = 15
LAVA_RIVERS_MAX_LENGTH = 35

# --- Terrain Spawn Chances ---
SPAWN_CHANCE_WASTE = 0.03
SPAWN_CHANCE_FARM = 0.02
SPAWN_CHANCE_CAVERN = 0.005

# --- Mountain Ranges ---
MOUNTAIN_RANGE_MIN_LENGTH = 8
MOUNTAIN_RANGE_MAX_LENGTH = 22

# --- World Scales ---
SCALES = ["Life/Death", "Heat/Cold", "Exertion/Torpor", "Magic/Drain", "Order/Chaos", "Luck/Woe"]

# --- Terrain Colors ---
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
    "None": 0xff00ff
}

# ==========================================
#        TOWER DEFENSE GAME SETTINGS
# ==========================================

# --- Game Setup ---
MAX_PLAYERS = 4
# 2 = 42 vertices (Small/Strategic), 3 = 162 vertices (Large)
ICO_SUBDIVISIONS = 2  

# --- Resources & Economy ---
STARTING_RESOURCES = {
    "Platinum": 1000, "Food": 500, "Lumber": 500, "Mana": 100,
    "Ore": 100, "Gems": 10, "Research Points": 0, "Draftees": 50, "Peasants": 100
}
STARTING_UNITS = 20
NEUTRAL_GARRISON = 5

# --- Visual Settings ---
PLAYER_COLORS = [(255,0,0), (0,0,255), (0,255,255), (255,255,0)]
COLOR_NEUTRAL = 0x555555
COLOR_HIGHLIGHT = 0xffff00
COLOR_CONN_VALID = 0x00ff00
COLOR_CONN_INVALID = 0xff0000

# --- Races & Units ---
# Special units are unlocked when a player owns all 3 vertices of a triangle.
RACES = {
    "Human": {
        "color": 0x3366ff,
        "base_atk": 1.0,
        "base_def": 1.0,
        "speed": 1.0,
        "special_unit": "Paladin",
        "special_bonus": 1.5
    },
    "Orc": {
        "color": 0xff3333,
        "base_atk": 1.3,
        "base_def": 0.8,
        "speed": 1.1,
        "special_unit": "Berserker",
        "special_bonus": 1.6
    },
    "Dark Elf": {
        "color": 0x9933ff,
        "base_atk": 1.1,
        "base_def": 0.9,
        "speed": 1.4,
        "special_unit": "Assassin",
        "special_bonus": 1.4
    },
    "Troll": {
        "color": 0x00cc66,
        "base_atk": 0.9,
        "base_def": 1.4,
        "speed": 0.8,
        "special_unit": "Giant",
        "special_bonus": 1.8
    }
}