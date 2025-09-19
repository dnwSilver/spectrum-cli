class SpectrumCli < Formula
  desc "🚀 Modern CLI for development workflow automation"
  homepage "https://github.com/dnwsilver/spectrum-cli"
  url "https://registry.npmjs.org/spectrum-cli/-/spectrum-cli-1.0.2.tgz"
  sha256 "" # Will be filled automatically by homebrew
  license "MIT"

  depends_on "node@18"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "spectrum", shell_output("#{bin}/spectrum --version")
    assert_match "Spectrum CLI for development workflow", shell_output("#{bin}/spectrum --help")
  end
end
