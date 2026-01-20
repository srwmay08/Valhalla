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
#        WORLD GENERATION
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
#        GAMEPLAY SETTINGS
# ==========================================

MAX_PLAYERS = 4
ICO_SUBDIVISIONS = 2  

# --- Resources & Economy ---
STARTING_UNITS_POOL = 45 
NEUTRAL_GARRISON_MIN = 5
NEUTRAL_GARRISON_MAX = 100
TICK_RATE = 1.0
FLOW_RATE = 0.5 

# --- Upgrades ---
UPGRADE_COST_TIER_2 = 50
UPGRADE_COST_TIER_3 = 120

# --- Fortress Types & Unit Classes ---
# Includes 'unit_class' required for Phase 3 combat logic
FORTRESS_TYPES = {
    "Keep":           {"prob": 0.3, "gen_mult": 1.0, "cap": 60,  "def_mod": 1.0, "atk_mod": 1.0, "unit_class": "Soldier", "desc": "Balanced"},
    "Grain Farm":     {"prob": 0.15, "gen_mult": 2.0, "cap": 40, "def_mod": 0.7, "atk_mod": 0.8, "unit_class": "Swarm",   "desc": "Conscript/Swarm"},
    "Livestock Farm": {"prob": 0.15, "gen_mult": 1.5, "cap": 40, "def_mod": 0.8, "atk_mod": 1.2, "unit_class": "Cavalry", "desc": "Horse/Fast"},
    "Tower":          {"prob": 0.1, "gen_mult": 0.5, "cap": 40,  "def_mod": 1.5, "atk_mod": 1.5, "unit_class": "Ranged",  "desc": "High DMG"},
    "Laboratory":     {"prob": 0.15, "gen_mult": 0.8, "cap": 50,  "def_mod": 1.2, "atk_mod": 1.1, "unit_class": "Mage",    "desc": "Support"},
    "Blacksmith":     {"prob": 0.15, "gen_mult": 0.8, "cap": 80,  "def_mod": 1.4, "atk_mod": 1.0, "unit_class": "Siege",   "desc": "Siege/Tank"}
}

# --- Special Units (Sanctuary Spawns) ---
SPECIAL_UNITS = {
    "Hero":  {"atk": 3.0, "def": 2.0, "speed": 1.0, "size": 15, "cooldown": 50, "desc": "Patrols Sector"},
    "Titan": {"atk": 5.0, "def": 4.0, "speed": 0.5, "size": 30, "cooldown": 100, "desc": "Siege Unit"}
}

# --- Class Combat Multipliers ---
CLASS_MULTIPLIERS = {
    "Siege":   {"Fortress": 3.0, "Unit": 0.5},
    "Ranged":  {"Unit": 1.5, "Fortress": 0.8},
    "Mage":    {"Unit": 1.2, "Fortress": 1.2}, 
    "Cavalry": {"Unit": 1.0, "Fortress": 0.8},
    "Soldier": {"Unit": 1.0, "Fortress": 1.0},
    "Swarm":   {"Unit": 0.8, "Fortress": 1.2},
    "Hero":    {"Unit": 2.0, "Fortress": 0.5}, 
    "Titan":   {"Unit": 1.0, "Fortress": 4.0}  
}

# --- Terrain Construction Rules ---
TERRAIN_BUILD_OPTIONS = {
    "Waste":    ["Keep"],
    "Mountain": ["Keep", "Tower", "Laboratory", "Blacksmith"],
    "Swamp":    ["Keep", "Laboratory"],
    "Lava":     ["Keep", "Blacksmith"],
    "Deep Sea": ["Keep"], 
    "Sea":      ["Keep"],
    "Plain":    ["Keep", "Grain Farm", "Livestock Farm", "Tower"],
    "Forest":   ["Keep", "Livestock Farm", "Tower"],
    "Hill":     ["Keep", "Tower", "Blacksmith"],
    "Farm":     ["Grain Farm", "Livestock Farm"],
    "Default":  ["Keep"]
}

# --- Terrain Bonuses ---
# The dictionary missing from your previous version
TERRAIN_BONUSES = {
    "Mountain": {"def_mod": 0.2, "atk_mod": 0.1, "desc": "+Def/Atk"},
    "Lava":     {"atk_mod": 0.2, "def_mod": -0.1, "desc": "+Atk/-Def"},
    "Forest":   {"range": 15, "gen_mult": 0.1, "desc": "+Range/Gen"},
    "Hill":     {"range": 10, "def_mod": 0.1, "desc": "+Range/Def"},
    "Swamp":    {"def_mod": 0.3, "gen_mult": -0.1, "desc": "Turtle"},
    "Farm":     {"gen_mult": 0.3, "cap": 20, "desc": "Massive Gen"},
    "Waste":    {"cap": -10, "atk_mod": 0.1, "desc": "Hardship"},
    "Deep Sea": {"def_mod": 0.5, "desc": "Natural Barrier"},
    "Sea":      {"gen_mult": 0.05, "desc": "Trade"}
}

# --- AI Settings ---
AI_DIFFICULTY = "Normal" 
AI_PROFILES = {
    "Very Easy": {"expand_bias": 0.1, "reaction_delay": 4},
    "Easy":      {"expand_bias": 0.3, "reaction_delay": 3},
    "Normal":    {"expand_bias": 0.5, "reaction_delay": 1},
    "Hard":      {"expand_bias": 0.8, "reaction_delay": 0},
    "Very Hard": {"expand_bias": 1.0, "reaction_delay": 0}
}

# --- Visual Settings ---
PLAYER_COLORS = [(255,0,0), (0,0,255), (0,255,255), (255,255,0)]
COLOR_NEUTRAL = 0x888888
COLOR_HIGHLIGHT = 0xffff00
COLOR_CONN_VALID = 0x00ff00
COLOR_CONN_INVALID = 0xff0000

# --- Races ---
RACES = {
    "Human": {"color": 0x3366ff, "base_atk": 1.0, "base_def": 1.0, "speed": 1.0},
    "Orc": {"color": 0xff3333, "base_atk": 1.4, "base_def": 0.7, "speed": 1.2},
    "Dark Elf": {"color": 0x9933ff, "base_atk": 1.1, "base_def": 0.9, "speed": 1.4},
    "Troll": {"color": 0x00cc66, "base_atk": 0.9, "base_def": 1.4, "speed": 0.8},
    "Neutral": {"color": 0x888888, "base_atk": 0.5, "base_def": 1.0, "speed": 1.0}
}