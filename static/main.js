// --- Setup Scene, Camera, and Renderer ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

// --- Add OrbitControls ---
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404040, 2); // Soft white light
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
scene.add(directionalLight);

// --- Camera Position ---
camera.position.z = 3;

// --- Variables for interactivity ---
let sphereMesh;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoveredFaceIndex = null;
const infoDiv = document.getElementById('info');


// --- Fetch and Create the Sphere ---
fetch('/get_sphere_data')
    .then(response => response.json())
    .then(data => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(data.vertices.flat());
        const indices = new Uint32Array(data.faces.flat());

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals(); // For smooth lighting

        // Material with two faces (outside and inside)
        const material = new THREE.MeshPhongMaterial({
            color: 0x2194ce,
            emissive: 0x072534,
            side: THREE.DoubleSide, // Render both sides
            flatShading: true,
            shininess: 30
        });

        sphereMesh = new THREE.Mesh(geometry, material);
        scene.add(sphereMesh);
    });


// --- Event Listeners for Interactivity ---
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);
window.addEventListener('resize', onWindowResize);


function onMouseMove(event) {
    if (!sphereMesh) return;

    // Update mouse coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycasting
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

    if (intersects.length > 0) {
        const faceIndex = intersects[0].faceIndex;
        if (faceIndex !== lastHoveredFaceIndex) {
            // Display tile ID
            infoDiv.style.display = 'block';
            infoDiv.style.left = `${event.clientX + 10}px`;
            infoDiv.style.top = `${event.clientY + 10}px`;
            infoDiv.innerText = `TILE ID: ${faceIndex}`;
            lastHoveredFaceIndex = faceIndex;
        }
    } else {
        infoDiv.style.display = 'none';
        lastHoveredFaceIndex = null;
    }
}

function onMouseClick(event) {
    if (!sphereMesh || lastHoveredFaceIndex === null) return;

    // Simple alert on click, you can expand this functionality
    alert(`You clicked on TILE ID: ${lastHoveredFaceIndex}`);

    // Example: Change color of the clicked tile
    const geometry = sphereMesh.geometry;
    const colorAttribute = geometry.attributes.color;

    // If there's no color attribute, create one
    if (!colorAttribute) {
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        // We also need to tell the material to use vertex colors
        sphereMesh.material.vertexColors = true;
    }
    
    const face = sphereMesh.geometry.index.array.slice(lastHoveredFaceIndex * 3, lastHoveredFaceIndex * 3 + 3);
    const highlightColor = new THREE.Color(0xff0000); // Red

    for (let i = 0; i < face.length; i++) {
        const vertexIndex = face[i];
        sphereMesh.geometry.attributes.color.setXYZ(vertexIndex, highlightColor.r, highlightColor.g, highlightColor.b);
    }
    sphereMesh.geometry.attributes.color.needsUpdate = true;
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // For damping
    renderer.render(scene, camera);
}

animate();