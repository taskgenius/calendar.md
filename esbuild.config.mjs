import builtins from "builtin-modules";
import esbuild from "esbuild";
import { lessLoader } from "esbuild-plugin-less";
import fs from "fs";
import process from "process";

const isProd = process.argv[2] === "production";

/**
 * Plugin to rename output CSS file to styles.css
 */
const renamePlugin = {
  name: "rename-styles",
  setup(build) {
    build.onEnd(() => {
      const outcss = "./main.css";
      const fixcss = "./styles.css";
      if (fs.existsSync(outcss)) {
        console.log("Renaming", outcss, "to", fixcss);
        fs.renameSync(outcss, fixcss);
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["./src/main.ts", "./src/styles.less"],
  bundle: true,
  define: {
    global: "window",
  },
  plugins: [lessLoader(), renamePlugin],
  external: [
    "obsidian",
    "electron",
    "moment",
    "@codemirror/autocomplete",
    "@codemirror/closebrackets",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/comment",
    "@codemirror/fold",
    "@codemirror/gutter",
    "@codemirror/highlight",
    "@codemirror/history",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/matchbrackets",
    "@codemirror/panel",
    "@codemirror/rangeset",
    "@codemirror/rectangular-selection",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/stream-parser",
    "@codemirror/text",
    "@codemirror/tooltip",
    "@codemirror/view",
    "node:*",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: isProd ? false : "inline",
  treeShaking: true,
  outdir: isProd ? "./dist" : "./",
  minify: isProd,
});

if (isProd) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
