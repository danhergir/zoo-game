# Tiny Zoo

A little zoo that runs by itself in the browser. Zebras, elephants, lions, giraffes, penguins and
monkeys live in their habitats, flamingos wade in the pond, visitors wander the paths, keepers do
their rounds and a train circles the park during opening hours.

It opens in a top-down pixel-art view. Press **P** to switch to the 3D view.

## One zoo for everyone

The zoo runs on a clock derived from real time, so everyone who opens the game sees the same
moment of the same day.

- A zoo day lasts 6 real minutes. Daylight (6:00 to 19:00) takes most of it and the night
  hurries by.
- The zoo resets to a known state at 4:00 each night, and the simulation is deterministic from
  there.
- Weather changes from day to day: sun, clouds, rain and fog.

## Controls

| Input | Action |
| --- | --- |
| Left-drag or WASD | Pan |
| Right-drag or Q / E | Rotate |
| Wheel | Zoom |
| Click an animal | Inspect it |
| + / − / 0 | Zoom in, out, whole zoo (2D) |
| 1–9 or the minimap | Jump to a place (2D) |
| P | Switch between 2D and 3D |
| G | Toggle graphics quality |

## Development

```sh
npm install
npm run dev      # dev server at http://localhost:5173/zoo-game/
npm run build    # type-check and bundle into dist/
npm run deploy   # build and publish dist/ to the gh-pages branch
```

Built with TypeScript, Vite and Three.js. All the sprites in the 2D view are drawn in code, in
`src/pixel/`.
