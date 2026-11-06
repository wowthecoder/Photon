import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Built from source rather than downloaded: upstream sd-server has no API key option, so we apply sd-server-api-key.patch.
// ponytail: drop the patch and switch to release zips once https://github.com/leejet/stable-diffusion.cpp/issues/1988 lands
const TAG = "master-1053-5a1ba5d";
const dir = path.join(import.meta.dirname, "../resources/sd");
const marker = path.join(dir, "BUILD");
const patch = path.join(import.meta.dirname, "sd-server-api-key.patch");

if (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== TAG) {
  console.log(`Building stable-diffusion.cpp ${TAG}. This needs git, cmake and Xcode, and takes a minute or two...`);
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "sdcpp-"));
  const run = (cmd, args, cwd = src) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
  try {
    run("git", ["clone", "-q", "--depth", "1", "--branch", TAG, "--recurse-submodules", "--shallow-submodules", "https://github.com/leejet/stable-diffusion.cpp", src], os.tmpdir());
    run("git", ["apply", patch]);
    run("cmake", ["-S", ".", "-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DSD_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON", "-DSD_BUILD_SHARED_LIBS=OFF"]);
    run("cmake", ["--build", "build", "--target", "sd-server", "-j"]);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(src, "build/bin/sd-server"), path.join(dir, "sd-server"));
    fs.chmodSync(path.join(dir, "sd-server"), 0o755);
    fs.copyFileSync(path.join(src, "LICENSE"), path.join(dir, "LICENSE"));
    fs.writeFileSync(marker, TAG);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}
