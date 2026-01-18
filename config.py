# config.py
"""
Configuration file for Valhalla Tower Defense.
"""
import os

# --- Security and Authentication ---
SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'a-default-secret-key-for-development-only')
MONGO_URI = "mongodb://localhost:27017/valhalla_db"
GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID')
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET')

# ==========================================
#        LEGACY WORLD GENERATION
# ==========================================
SURFACE_OCEANS = 4
SUBTERRANEAN_SEAS = 15
MIN_SURFACE_DEEP_SEA_PERCENT = 0.20
MAX_SURFACE_DEEP_SEA_PERCENT = 0.40
MIN_SUBTERRANEAN_SEA_PERCENT = 0.05
MAX_SUBTERRANEAN_SEA_PERCENT = 0.15
LAVA_RIVERS = True
NUM_LAVA_RIVERS = 25
LAVA_RIVERS_MIN_LENGTH = 15
LAVA_RIVERS_MAX_LENGTH = 35
SPAWN_CHANCE_WASTE = 0.03
SPAWN_CHANCE_FARM = 0.02
SPAWN_CHANCE_CAVERN = 0.005
MOUNTAIN_RANGE_MIN_LENGTH = 8
MOUNTAIN_RANGE_MAX_LENGTH = 22
SCALES = ["Life/Death", "Heat/Cold", "Exertion/Torpor", "Magic/Drain", "Order/Chaos", "Luck/Woe"]
TERRAIN_COLORS = {
    "Deep Sea": 0x000033, "Sea": 0x00008B, "Plain": 0x90EE90, "Hill": 0x8B4513,
    "Forest": 0x006400, "Mountain": 0x808080, "Swamp": 0x556B2F, "Waste": 0xDEB887,
    "Farm": 0xFFD700, "Lava": 0xFC470A, "None": 0xff00ff
}

# ==========================================
#        TOWER DEFENSE GAME SETTINGS
# ==========================================

MAX_PLAYERS = 4
ICO_SUBDIVISIONS = 2  

# --- Resources & Economy ---
STARTING_UNITS = 30
NEUTRAL_GARRISON = 5
NPC_STARTING_NODES = 2 # How many bases the NPC starts with
NPC_MOVE_INTERVAL = 3.0 # Seconds between NPC moves

# --- Visual Settings ---
PLAYER_COLORS = [(255,0,0), (0,0,255), (0,255,255), (255,255,0)]
COLOR_NEUTRAL = 0x888888
COLOR_HIGHLIGHT = 0xffff00
COLOR_CONN_VALID = 0x00ff00
COLOR_CONN_INVALID = 0xff0000

# --- Races & Units ---
RACES = {
    "Human": {
        "color": 0x3366ff,
        "base_atk": 1.0,
        "base_def": 1.0,
        "speed": 1.0,
        "special_unit": "Paladin",
        "special_bonus": 1.5,
        "sprite": "human_icon.png" # Placeholder for future
    },
    "Orc": {
        "color": 0xff3333,
        "base_atk": 1.4, # Orcs are aggressive
        "base_def": 0.7,
        "speed": 1.2,
        "special_unit": "Berserker",
        "special_bonus": 1.6,
        "sprite": "orc_icon.png"
    },
    "Dark Elf": {
        "color": 0x9933ff,
        "base_atk": 1.1,
        "base_def": 0.9,
        "speed": 1.4,
        "special_unit": "Assassin",
        "special_bonus": 1.4,
        "sprite": "elf_icon.png"
    },
    "Troll": {
        "color": 0x00cc66,
        "base_atk": 0.9,
        "base_def": 1.4,
        "speed": 0.8,
        "special_unit": "Giant",
        "special_bonus": 1.8,
        "sprite": "troll_icon.png"
    },
    "Neutral": {
        "color": 0x888888,
        "base_atk": 0.5,
        "base_def": 1.0,
        "speed": 1.0,
        "special_unit": "None",
        "special_bonus": 1.0
    }
}