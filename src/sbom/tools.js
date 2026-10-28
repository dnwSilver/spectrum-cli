const {
  fs,
  path,
  ensure,
  sha,
  request,
  tarEntries,
  sleep,
} = require("../automation");
const TOOLS = Object.freeze({
  oras: [
    "https://github.com/oras-project/oras/releases/download/v1.3.0/oras_1.3.0_linux_amd64.tar.gz",
    "6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64",
  ],
  syft: [
    "https://github.com/anchore/syft/releases/download/v1.44.0/syft_1.44.0_linux_amd64.tar.gz",
    "0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a",
  ],
});
async function toolDownload(url, transport = request) {
  const deadline = Date.now() + 600000;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let current = url;
      for (let hop = 0; hop < 6; hop++) {
        const parsed = new URL(current);
        ensure(
          parsed.protocol === "https:" && !parsed.username && !parsed.password,
          "Unsafe tool URL",
        );
        const res = await transport(current, {
          limit: 100 * 1024 * 1024,
          timeout: Math.min(180000, deadline - Date.now()),
        });
        if (
          [301, 302, 303, 307, 308].includes(res.status) &&
          res.headers.get("location")
        ) {
          current = new URL(res.headers.get("location"), current).href;
          continue;
        }
        ensure(res.status === 200, "Tool download failed");
        return res.body;
      }
      throw new Error("Too many tool redirects");
    } catch (error) {
      if (attempt === 3 || Date.now() + 5000 >= deadline) throw error;
      await sleep(5000);
    }
  }
}
async function bootstrap(directory, names = ["oras", "syft"], transport) {
  ensure(
    process.platform === "linux" && process.arch === "x64",
    "Catalog runtime requires linux/amd64",
  );
  for (const name of names) {
    const [url, checksum] = TOOLS[name];
    const archive = await toolDownload(url, transport);
    ensure(sha(archive) === checksum, "Tool checksum mismatch: " + name);
    const entries = tarEntries(archive, {
      maxFile: 200 * 1024 * 1024,
      maxEntries: 100,
    });
    const binaries = entries.filter(
      (entry) => entry.name === name && !entry.directory,
    );
    ensure(binaries.length === 1, "Invalid tool archive");
    fs.writeFileSync(path.join(directory, name), binaries[0].data, {
      mode: 0o700,
    });
  }
}
module.exports = { TOOLS, toolDownload, bootstrap };
