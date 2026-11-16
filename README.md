# pm-example

Drives the native GTA V pause menu from a UI page

## Build

`client.js` is not in the repository, so the resource has to be built once before it can start. Node.js is required.

```
cd src
npm install
npm run build
```

This type-checks the TypeScript sources and writes `client.js` at the root of the resource. Run `npm run build` again after changing a file in `src/`.

Open the pause UI in game with **F6** (or `pmui` in the F8 console).
