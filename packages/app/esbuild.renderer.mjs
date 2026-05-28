import * as esbuild from "esbuild";

const isProduction = process.argv[2] === "production";

await esbuild.build({
  entryPoints: ["src/renderer/main.tsx"],
  bundle: true,
  platform: "browser",
  target: "chrome130",
  format: "iife",
  outfile: "renderer/bundle.js",
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
  define: {
    "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
  },
  logLevel: "info",
});

console.log("Renderer build complete");
