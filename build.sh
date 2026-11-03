#!/usr/bin/env bash
# Builds PC Clipper on Linux: core + harness, optional engine test run, then the Windows exe.
#   ./build.sh          build everything and publish publish/PC Clipper.exe
#   ./build.sh test     also run the engine harness against real ffmpeg (about 3 minutes)
set -euo pipefail
cd "$(dirname "$0")"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

dotnet build src/PcClipper.Core -c Release -nologo -v quiet
dotnet build tests/PcClipper.Harness -c Release -nologo -v quiet

if [[ "${1:-}" == "test" ]]; then
  dotnet run --no-build -c Release --project tests/PcClipper.Harness | grep -E '^(PASS|FAIL)|checks passed'
fi

rm -rf publish
dotnet publish src/PcClipper.App -c Release -o publish -nologo -v quiet
rm -f publish/*.pdb
ls -la publish
