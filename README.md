# cfx-pausemenu-ui

Drives the native GTA V pause menu from a NUI page, with the native pause menu scaleforms kept hidden and patched (see `stream/`).

## Credits

Making the native pause menu controllable from a UI page took a lot of reverse engineering. The research behind it (how the pause menu scaleforms work, how they can be patched and driven from a resource) was done by two of us, together. This resource is the result of that shared work.

## Build

`client.js` is not in the repository, so the resource has to be built once before it can start. Node.js is required.

```
cd src
npm install
npm run build
```

This type-checks the TypeScript sources and writes `client.js` at the root of the resource. Run `npm run build` again after changing a file in `src/`.

## Usage

Open the pause UI in game with **F6** (or `pmui` in the F8 console).
