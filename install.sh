#!/bin/bash

# 🚀 Spectrum CLI - Automatic Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/dnwsilver/spectrum-cli/main/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/dnwsilver/spectrum-cli"
INSTALL_DIR="$HOME/.spectrum-cli"
BINARY_PATH="$HOME/.local/bin/spectrum"
VERSION="latest"

echo -e "${BLUE}🚀 Spectrum CLI Installer${NC}"
echo -e "${BLUE}=========================${NC}"

# Check requirements
check_requirements() {
    echo -e "${YELLOW}📋 Checking system requirements...${NC}"

    # Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found. Please install Node.js >= 20${NC}"
        echo -e "${YELLOW}💡 Install from: https://nodejs.org/${NC}"
        exit 1
    fi

    NODE_VERSION=$(node --version | sed 's/v//')
    echo -e "${GREEN}✅ Node.js ${NODE_VERSION}${NC}"

    # npm
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm not found${NC}"
        exit 1
    fi

    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✅ npm ${NPM_VERSION}${NC}"

    # Git
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git not found. Please install Git${NC}"
        exit 1
    fi

    GIT_VERSION=$(git --version | cut -d' ' -f3)
    echo -e "${GREEN}✅ Git ${GIT_VERSION}${NC}"

}

# Download and install
install_spectrum() {
    echo -e "${YELLOW}📦 Installing Spectrum CLI...${NC}"

    # Create directories
    mkdir -p "$(dirname "$BINARY_PATH")"
    mkdir -p "$INSTALL_DIR"

    # Download latest release
    echo -e "${BLUE}⬇️ Downloading from ${REPO_URL}...${NC}"

    if command -v curl &> /dev/null; then
        curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar -xz -C "$INSTALL_DIR" --strip-components=1
    elif command -v wget &> /dev/null; then
        wget -qO- "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar -xz -C "$INSTALL_DIR" --strip-components=1
    else
        echo -e "${RED}❌ Neither curl nor wget found${NC}"
        exit 1
    fi

    # Install dependencies
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    cd "$INSTALL_DIR"
    npm install --production --silent

    # Make executable
    chmod +x "$INSTALL_DIR/index.js"

    # Create symlink
    ln -sf "$INSTALL_DIR/index.js" "$BINARY_PATH"

    echo -e "${GREEN}✅ Installation completed!${NC}"
}

# Add to PATH
setup_path() {
    echo -e "${YELLOW}🔧 Setting up PATH...${NC}"

    BIN_DIR=$(dirname "$BINARY_PATH")

    # Add to .bashrc/.zshrc if not already present
    for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        if [[ -f "$RC_FILE" ]]; then
            if ! grep -q "$BIN_DIR" "$RC_FILE"; then
                echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$RC_FILE"
                echo -e "${GREEN}✅ Added to PATH in $RC_FILE${NC}"
            fi
        fi
    done

    # Add to current session
    export PATH="$BIN_DIR:$PATH"
}

# Verify installation
verify_installation() {
    echo -e "${YELLOW}🧪 Verifying installation...${NC}"

    if command -v spectrum &> /dev/null; then
        SPECTRUM_VERSION=$(spectrum --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✅ Spectrum CLI installed successfully! (${SPECTRUM_VERSION})${NC}"
        echo -e "${BLUE}📖 Run 'spectrum --help' to get started${NC}"
    else
        echo -e "${RED}❌ Installation verification failed${NC}"
        echo -e "${YELLOW}💡 Try: export PATH=\"$(dirname "$BINARY_PATH"):\$PATH\"${NC}"
        echo -e "${YELLOW}💡 Or use: $BINARY_PATH --help${NC}"
    fi
}

# Usage information
show_usage() {
    echo -e "${BLUE}📚 Quick Start:${NC}"
    echo -e "  spectrum --help           # Show help"
    echo -e "  spectrum version up patch # Bump patch version"
    echo -e "  spectrum release start    # Start release process"
    echo ""
    echo -e "${BLUE}📖 Documentation:${NC}"
    echo -e "  ${REPO_URL}#readme"
    echo ""
    echo -e "${BLUE}🗂️ Installation directory:${NC}"
    echo -e "  $INSTALL_DIR"
    echo ""
    echo -e "${BLUE}🔗 Binary location:${NC}"
    echo -e "  $BINARY_PATH"
}

# Uninstall function
uninstall() {
    echo -e "${YELLOW}🗑️ Uninstalling Spectrum CLI...${NC}"
    rm -rf "$INSTALL_DIR"
    rm -f "$BINARY_PATH"
    echo -e "${GREEN}✅ Uninstalled successfully${NC}"
}

# Main installation flow
main() {
    # Handle uninstall
    if [[ "$1" == "--uninstall" ]]; then
        uninstall
        exit 0
    fi

    # Show help
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        echo "Usage: $0 [--uninstall] [--help]"
        echo ""
        echo "Options:"
        echo "  --uninstall    Remove Spectrum CLI"
        echo "  --help         Show this help"
        exit 0
    fi

    check_requirements
    install_spectrum
    setup_path
    verify_installation
    show_usage
}

# Handle Ctrl+C
trap 'echo -e "\n${RED}❌ Installation cancelled${NC}"; exit 1' INT

# Run main function
main "$@"
