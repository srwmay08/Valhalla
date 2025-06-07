class GameEngine:
    """Manages the overall game state, players, and the main game loop."""
    def __init__(self, screen):
        self.screen = screen
        self.clock = pygame.time.Clock()
        self.sphere = IcosahedronSphere(subdivisions=SUBDIVISIONS)
        self.players = []
        self.player_colors = {}
        self.last_tick_time = time.time()
        self.hourly_production_rates = {
            "Alchemy": 45, "Peasant": 2.7, "Farm": 80, "Dock": 35,
            "Lumberyard": 50, "Tower": 25, "Wizard Guild": 5, "Ore Mine": 60,
            "Diamond Mine": 15, "FoodConsumption": 0.25
        }
        self.angle_x, self.angle_y, self.angle_z = 0, 0, 0
        
        # New state and interactivity attributes
        self.game_state = 'SETUP'  # 'SETUP' or 'RUNNING'
        self.selected_face = None
        self.prompt_active = False
        self.font = pygame.font.SysFont(None, 24)
        self.picking_surface = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))

    def setup_game(self, num_human_players=1, num_ai_enemies=3):
        """Initializes players and AI for the setup phase."""
        self.players = []
        self.player_colors = {}
        # Add human player(s) without assigning locations
        for i in range(num_human_players):
            player = Player(f"Player {i+1}", is_ai=False)
            self.players.append(player)
            self.player_colors[player.name] = config.PLAYER_COLORS[len(self.players) - 1]
        # Add AI players
        num_ai_to_add = min(num_ai_enemies, config.MAX_PLAYERS - len(self.players))
        for i in range(num_ai_to_add):
            ai_player = Player(f"AI Enemy {i+1}", is_ai=True)
            self.players.append(ai_player)
            self.player_colors[ai_player.name] = config.PLAYER_COLORS[len(self.players) - 1]
        # Pre-assign AI locations for visual feedback during setup
        self._setup_ai_locations()

    def _setup_ai_locations(self, player_start_face=None):
        """Assigns random start locations to AI players, avoiding forbidden zones."""
        for p in self.players:
            if p.is_ai:
                p.owned_faces = []
                p.buildings = {}
        
        forbidden_faces = {face for p in self.players for face in p.owned_faces}
        if player_start_face is not None:
            forbidden_faces.add(player_start_face)
            forbidden_faces.update(self.sphere.face_neighbors[player_start_face])

        for p in self.players:
            if p.is_ai:
                available_faces = list(set(range(len(self.sphere.faces))) - forbidden_faces)
                if not available_faces:
                    print(f"Warning: No available faces for AI {p.name}")
                    continue
                start_face = random.choice(available_faces)
                p.owned_faces.append(start_face)
                p.buildings[start_face] = "Farm"
                forbidden_faces.add(start_face)
                forbidden_faces.update(self.sphere.face_neighbors[start_face])

    def _handle_click(self, mouse_pos):
        """Identifies which face was clicked using a picking buffer."""
        if self.prompt_active: return # Don't re-trigger while prompt is up
        try:
            clicked_color = self.picking_surface.get_at(mouse_pos)
            face_index = (clicked_color[0] << 16) + (clicked_color[1] << 8) + clicked_color[2]

            if face_index < len(self.sphere.faces):
                all_owned_faces = {face for p in self.players for face in p.owned_faces}
                if face_index in all_owned_faces:
                    print(f"Face {face_index} is already claimed.")
                    return
                self.selected_face = face_index
                self.prompt_active = True
        except IndexError:
            pass # Clicked outside the window area

    def _handle_prompt_response(self, key):
        """Handles Y/N input for the start location prompt."""
        if key == pygame.K_y:
            print(f"Player selected face {self.selected_face}. Starting game.")
            human_player = next((p for p in self.players if not p.is_ai), None)
            if human_player and self.selected_face is not None:
                human_player.owned_faces = [self.selected_face]
                human_player.buildings[self.selected_face] = "Farm"
                self._setup_ai_locations(player_start_face=self.selected_face)
                self.prompt_active = False
                self.game_state = 'RUNNING'
                self.last_tick_time = time.time() # Start ticking immediately
        elif key == pygame.K_n:
            self.prompt_active = False
            self.selected_face = None

    def _handle_tick(self):
        """Processes one game tick, updating resources for all players."""
        tick_duration_hours = config.TICK_INTERVAL_SECONDS / 3600.0
        print(f"\n--- Game Tick ({time.ctime()}) ---")
        for player in self.players:
            resources_before = {k: int(v) for k, v in player.resources.items()}
            player.update_resources(self.hourly_production_rates, tick_duration_hours)
            resources_after = {k: int(v) for k, v in player.resources.items()}
            print(f"Player {player.name}: {resources_before} -> {resources_after}")
        print("-" * 20)

    def _update_display(self):
        """Draws the current game state, including numbers and prompts."""
        self.angle_x += ROTATION_SPEED
        self.angle_y += ROTATION_SPEED
        
        rot_y = np.array([[np.cos(self.angle_y), 0, np.sin(self.angle_y)], [0, 1, 0], [-np.sin(self.angle_y), 0, np.cos(self.angle_y)]])
        rot_x = np.array([[1, 0, 0], [0, np.cos(self.angle_x), -np.sin(self.angle_x)], [0, np.sin(self.angle_x), np.cos(self.angle_x)]])
        rotated_vertices = self.sphere.vertices @ (rot_y @ rot_x).T

        self.screen.fill(BACKGROUND_COLOR)
        self.picking_surface.fill((0, 0, 0))
        
        sorted_faces_indices = sorted(range(len(self.sphere.faces)), key=lambda i: sum(rotated_vertices[v][2] for v in self.sphere.faces[i]), reverse=True)

        for i in sorted_faces_indices:
            face = self.sphere.faces[i]
            v0, v1, v2 = [rotated_vertices[idx] for idx in face]
            if np.cross(v1 - v0, v2 - v0)[2] > 0: continue
            points = [(int(v[0] * SCALE + SCREEN_WIDTH / 2), int(v[1] * SCALE + SCREEN_HEIGHT / 2)) for v in [v0, v1, v2]]
            
            # --- Main screen drawing ---
            face_owner = next((p for p in self.players if i in p.owned_faces), None)
            color = self.player_colors.get(face_owner.name) if face_owner else BIOMES.get(self.sphere.face_biomes[i], (255, 255, 255))
            pygame.draw.polygon(self.screen, color, points)
            pygame.draw.polygon(self.screen, (50, 50, 50), points, 1)

            # Draw face number
            center_x = sum(p[0] for p in points) / 3
            center_y = sum(p[1] for p in points) / 3
            text_surf = self.font.render(str(i), True, (255, 255, 255))
            self.screen.blit(text_surf, text_surf.get_rect(center=(center_x, center_y)))

            # --- Picking surface drawing ---
            picking_color = ((i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF)
            pygame.draw.polygon(self.picking_surface, picking_color, points)

        if self.prompt_active:
            prompt_text = f"Do you want to start here ({self.selected_face})? (Y/N)"
            prompt_surf = self.font.render(prompt_text, True, (255, 255, 0))
            prompt_rect = prompt_surf.get_rect(center=(SCREEN_WIDTH / 2, SCREEN_HEIGHT - 30))
            pygame.draw.rect(self.screen, (0,0,0), prompt_rect.inflate(10,10))
            self.screen.blit(prompt_surf, prompt_rect)

        pygame.display.flip()

    def run(self):
        """The main loop of the game engine, managing states."""
        running = True
        while running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                if self.game_state == 'SETUP':
                    if event.type == pygame.MOUSEBUTTONDOWN:
                        self._handle_click(event.pos)
                    if event.type == pygame.KEYDOWN and self.prompt_active:
                        self._handle_prompt_response(event.key)
            
            if self.game_state == 'RUNNING':
                current_time = time.time()
                if current_time - self.last_tick_time >= config.TICK_INTERVAL_SECONDS:
                    self._handle_tick()
                    self.last_tick_time = current_time

            self._update_display()
            self.clock.tick(60)
        pygame.quit()

def main():
    """Initializes and runs the game engine."""
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Valhalla Game Engine - Setup Phase")
    
    engine = GameEngine(screen)
    engine.setup_game(num_human_players=1, num_ai_enemies=3)
    engine.run()