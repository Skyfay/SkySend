# SkySend CLI installer for Windows.
# Usage (PowerShell):
#   irm https://skysend.ch/install.ps1 | iex
#
# Options (environment variables):
#   $env:INSTALL_DIR - installation directory (default: $HOME\.skysend\bin)
#   $env:VERSION     - specific version to install (default: latest)

$ErrorActionPreference = "Stop"
# Suppress PowerShell's built-in Invoke-WebRequest progress UI.
# Without this, IWR can be 10-100x slower due to progress event overhead.
$ProgressPreference = "SilentlyContinue"

$Repo = "skyfay/SkySend"
$BinaryName = "skysend"

# ── Resolve install directory ─────────────────────────────────
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME ".skysend\bin" }

# ── Resolve version ──────────────────────────────────────────
function Resolve-Version {
    if ($env:VERSION) {
        $v = $env:VERSION
        if (-not $v.StartsWith("v")) { $v = "v$v" }
        return $v
    }

    Write-Host "Fetching latest version..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "SkySend-Installer" }
    return $release.tag_name
}

# ── Download and install ─────────────────────────────────────
function Install-SkySend {
    $Version = Resolve-Version
    $AssetName = "$BinaryName-windows-x64.exe"
    $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$AssetName"
    $ChecksumUrl = "https://github.com/$Repo/releases/download/$Version/checksums.txt"

    Write-Host "Installing SkySend CLI $Version (windows-x64)..."
    Write-Host "  From: $DownloadUrl"

    # Ensure install directory exists
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "skysend-install"
    if (Test-Path $TmpDir) { Remove-Item -Recurse -Force $TmpDir }
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

    try {
        # Download binary
        $BinaryPath = Join-Path $TmpDir $AssetName
        Write-Host "  Downloading $AssetName..." -NoNewline
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $BinaryPath -UseBasicParsing
        $DownloadSize = (Get-Item $BinaryPath).Length
        $SizeStr = if ($DownloadSize -ge 1MB) { "{0:F1} MB" -f ($DownloadSize / 1MB) } else { "{0:F0} KB" -f ($DownloadSize / 1KB) }
        Write-Host " done ($SizeStr)"

        # Download and verify checksum
        try {
            $ChecksumPath = Join-Path $TmpDir "checksums.txt"
            Write-Host "  Verifying checksum..." -NoNewline
            Invoke-WebRequest -Uri $ChecksumUrl -OutFile $ChecksumPath -UseBasicParsing

            $checksums = Get-Content $ChecksumPath
            $expectedLine = $checksums | Where-Object { $_ -match $AssetName }
            if ($expectedLine) {
                $expected = ($expectedLine -split "\s+")[0]
                $actual = (Get-FileHash -Path $BinaryPath -Algorithm SHA256).Hash.ToLower()
                if ($expected -eq $actual) {
                    Write-Host " ok"
                } else {
                    Write-Error "Checksum mismatch! Expected: $expected, Actual: $actual"
                    exit 1
                }
            }
        } catch {
            Write-Host " skipped (not available)"
        }

        # Move binary to install dir
        $DestPath = Join-Path $InstallDir "$BinaryName.exe"
        Move-Item -Force $BinaryPath $DestPath

    } finally {
        Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    }

    # Add to PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        Write-Host "  Adding $InstallDir to user PATH..."
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
        $env:Path = "$env:Path;$InstallDir"
    }

    Write-Host ""
    Write-Host "SkySend CLI $Version installed to $DestPath"
    Write-Host ""
    Write-Host "Get started:"
    Write-Host "  skysend --help"
    Write-Host "  skysend config set-server https://your-instance.example.com"
    Write-Host "  skysend upload ./file.txt"
    Write-Host ""
    Write-Host "Note: Restart your terminal for PATH changes to take effect."
}

Install-SkySend
