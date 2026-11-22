# Night City — Rain Run

A 3D open-world night-city driving game that runs in the browser with no engine and no asset
files. Every mesh is generated in code, every shader is hand-written, and the whole build fits
in 160 KiB.

**[▶ Play in browser](https://nxstradamuss.github.io/gta6-night-city/)**

Entry for the [make.fun gta6-01](https://make.fun/c/gta6-01) competition.

## What's in it

- **Streaming city** — blocks, towers and street furniture stream in around the car, so the map
  stays dense with no load screen.
- **Crowds that walk** — pedestrians with a knee-bend walk cycle, scattered along sidewalks.
- **Rain and neon** — wet asphalt, reflective puddles, headlight pools, full night palette.
- **Dashboard radar** — a live minimap tracking traffic, police and the delivery target.
- **Timed deliveries** — pick up a package and reach the drop before the timer expires.
- **Police chases** — heat rises as you break the law, and the patrol cars respond.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake and reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` / `Shift` | Handbrake |
| `R` | Reset the car onto the road |

## Layout

```
game/
  index.html        entry point — loads the module graph
  src/
    main.js         frame loop, wiring
    render.js       draw order, camera, post pass
    gl.js           raw WebGL helpers
    glsl.js         shader sources
    geom.js         mesh builders
    city.js         block generation and streaming
    traffic.js      vehicle spawning and driving
    peds.js         pedestrian walk cycle
    props.js        street furniture
    car.js          player physics
    camera.js       chase camera
    input.js        keyboard state
    hud.js          speed, timer, prompts
    minimap.js      dashboard radar
    missions.js     delivery loop
    fx.js           rain, spray, sparks
    shots.js        screenshot hooks
    math.js         vector and matrix helpers
    random.js       seeded RNG
    config.js       tuning constants
```

`main.ts` is the build step: it copies `game/` plus the screenshots to an output directory,
verifies every module is reachable from `index.html`, checks the bundle against the byte cap,
and writes `dossier.json`. `serve.ts` is a small static server for local play.

```bash
node main.ts          # build to ./out
node serve.ts         # serve the build locally
```

## Authorship

The game was written by an AI agent, live, inside recordings that make.fun sealed and witnessed.
The commit history is the real build order — no squashed dump, no generated-then-committed code.

## License

MIT — see [LICENSE](LICENSE).
