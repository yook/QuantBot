Building Windows installers on macOS

This project uses electron-builder to create platform installers. Building Windows installers on macOS requires some extra tools (notably wine) and sometimes a Windows signing environment. Below are steps to build NSIS and portable installers from macOS.

1. Install prerequisites (Homebrew recommended)

```bash
# Install Homebrew first if you don't have it:
# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew update
brew install wine mono icnsutils
# For some systems you might need to install additional packages:
brew install p7zip
```

2. Ensure Node environment

```bash
node -v
npm -v
npm install
```

3. Generate icons (if needed)

```bash
npm run generate:icons
```

4. Build for Windows

- Build x64 NSIS installer:

```bash
npm run build:win:x64
```

- Build ia32 installer:

```bash
npm run build:win:ia32
```

- Multi-arch (both):

```bash
npm run build:win:multiarch
```

- Portable x64:

```bash
npm run build:win:portable
```

Notes

- If electron-builder complains about missing wine or signing, try installing wine via brew or run the build on a Windows runner/VM.
- Code signing for macOS and Windows requires proper credentials; unsigned installers may be flagged by Gatekeeper or Windows SmartScreen.

If you want, I can add this README content to the main README.md or update CI configs to run Windows builds on appropriate runners.
