# WebGL2 FLIP/PIC Fluid Text Simulation

A high-performance, GPU-accelerated Eulerian-Lagrangian fluid simulation running entirely in the browser using WebGL2. 

This project converts a standard string of text into a physical boundary of particles, and simulates complex fluid dynamics through mass-advection and grid-based pressure solving (FLIP/PIC) allowing you to interact with the words as if they were a pool of water.

## 🚀 Features

- **Massively Parallel Physics:** Simulates hundreds of thousands of particles in real-time at 60fps utilizing multi-pass GPGPU fragment shaders.
- **Eulerian Grid Computations:** Sub-pixel additive point scatter to calculate fluid density, followed by multi-pass Gauss-Seidel/Jacobi ping-ponging to solve for strict incompressibility.
- **Vorticity Confinement:** Real-time microscopic grid curl mathematics to artificially inject physical turbulence and rolling whirlpools into the fluid.
- **Metaball Rendering:** Advanced screen-space post-processing threshold filters to visually merge separated points into a single flowing, refractive liquid gel.
- **Watercolor Advection:** Encodes layout coordinates structurally into the Vertex Buffer Objects to map vivid neon gradients that authentically mix and swirl like physical dye over time.
- **Interactive Obstacles:** Right-click dragging injects mathematical Wall collision thresholds natively into the fluid divergence passes.

## 🛠️ Tech Stack & Architecture

- **Vanilla Javascript** + **WebGL2 / GLSL**
- **Extensions:** Requires `EXT_color_buffer_float` and `OES_texture_float_linear` for RGBA32F grid sampling.
- **Transform Feedback:** The physical simulation avoids expensive GPU->CPU memory readbacks. The simulation state is piped seamlessly through Vertex shaders to process Particle->Grid advection computations directly in graphical memory.
- **Fallback:** Includes the original pure-JS CPU loop (`script.js`) for reference.

## 💻 Running Locally

Because the pipeline relies on floating-point Framebuffer Objects and advanced Pixel read/write rules, browsers will block it from running directly over the `file://` protocol due to CORS security policies.

You **must** run it using a local development server:

\`\`\`bash
# If you have Node.js installed
npx serve . 

# Or if you have Python
python -m http.server
\`\`\`

Then navigate to `http://localhost:3000` (or `8080`) in your browser.

## 🎮 Controls

- **Left-Click & Drag:** Acts as a massive repulsive wind forcing fluid apart.
- **Right-Click & Drag (Toggle On):** Spawns an invisible solid boulder that fluid mathematically crashes and parts against.
- **UI Settings Panel:** Located in the top right window to tweak FLIP/PIC blend rates, grid resolution, string text, and toggle advanced graphics features on the fly!
