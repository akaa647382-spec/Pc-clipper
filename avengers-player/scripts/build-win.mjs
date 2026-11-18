#!/usr/bin/env node
// Builds the Windows release of Avengers Player:
//
//   1. packages the app for win32/x64 with @electron/packager into out/
//   2. trims the Electron distribution (unused locale files only)
//   3. verifies the packaged folder (files, app.asar contents, exe resources)
//   4. compiles build/installer.nsi with makensis
//   5. verifies the installer and moves it to ../download/
//
// Usage (from the project root):
//   node scripts/build-win.mjs [--skip-installer] [--keep] [--keep-locales]
//
//   --skip-installer  package and verify only, do not run makensis
//   --keep            do not delete out/ before building
//   --keep-locales    keep every Chromium locale file (bigger installer)
//   --keep-webgpu     keep the WebGPU shader compiler DLLs (bigger installer)
//
// The person who installs the result is not technical, so this script would
// rather stop with a clear message than hand over a build it could not check.
// Every step either passes or ends the run with a non-zero exit code.
//
// ES modules are always in strict mode, so there is no 'use strict' line.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Fixed facts about this build
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'out');
// The repository keeps release binaries one level above the app folder.
const DOWNLOAD_DIR = path.resolve(ROOT, '..', 'download');

const APP_NAME = 'Avengers Player';
const EXE_NAME = `${APP_NAME}.exe`;
const PLATFORM = 'win32';
const ARCH = 'x64';
const PACKAGED_DIR = path.join(OUT_DIR, `${APP_NAME}-${PLATFORM}-${ARCH}`);

const ICON_ICO = path.join(ROOT, 'build', 'icon.ico');
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const INSTALLER_SCRIPT = path.join(ROOT, 'build', 'installer.nsi');
const UNINSTALL_LIST = path.join(OUT_DIR, 'uninstall-files.nsh');
const MAKENSIS_LOG = path.join(OUT_DIR, 'makensis.log');

// GitHub rejects files over 100 MB; 95 leaves room for a little growth.
const MAX_INSTALLER_BYTES = 95 * 1024 * 1024;

// Everything the app needs at runtime. Anything else in the project (tests,
// scripts, build inputs, node_modules, README, ...) stays out of the package.
const RUNTIME_DIRS = ['/main', '/src'];
const RUNTIME_FILES = ['/package.json', '/build/icon.png', '/build/icon.ico'];
const REQUIRED_APP_FILES = [
  'main/main.js', 'main/preload.js', 'main/store.js', 'main/lastrun.js', 'main/webm.js', 'main/ntp.js', 'main/ffmpeg.js', 'main/watchdog.js',
  'src/index.html', 'src/styles.css', 'src/core.js', 'src/subs-core.js', 'src/fx.js', 'src/fx-arc.js', 'src/fx-gamma.js', 'src/fx-warmachine.js', 'src/fx-tva.js', 'src/fx-doom.js', 'src/app.js',
];

// Files of the Electron distribution the app cannot do without. Checked after
// trimming so a mistake there is caught here and not on New Year's Eve.
const REQUIRED_DIST_FILES = [
  EXE_NAME,
  'LICENSE',
  'LICENSES.chromium.html',
  'resources.pak',
  'icudtl.dat',
  'ffmpeg.dll',
  'locales/en-US.pak',
  'resources/app.asar',
];

const WIN32_METADATA = {
  CompanyName: 'akaa',
  ProductName: APP_NAME,
  FileDescription: APP_NAME,
  InternalName: APP_NAME,
  OriginalFilename: EXE_NAME,
};

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const KNOWN_FLAGS = ['--skip-installer', '--keep', '--keep-locales', '--keep-webgpu'];

// Files of the Electron distribution that only WebGPU uses. The player never touches WebGPU,
// and the DirectX shader compiler alone is 25 MB: without it the installer fits under
// GitHub's file size limit.
const WEBGPU_ONLY_FILES = ['dxcompiler.dll', 'dxil.dll'];

const PE_MACHINE_X64 = 0x8664;
const PE_MACHINE_X86 = 0x014c;
const PE_SUBSYSTEM_GUI = 2;
const RT_MANIFEST = 24;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// An expected failure: the message is written for a human and shown without
// a stack trace. Anything else that throws is a bug and keeps its stack.
class BuildError extends Error {}

function fail(message) {
  throw new BuildError(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relative(file) {
  return path.relative(ROOT, file) || '.';
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    return fail(`Could not read ${relative(file)}: ${err.message}`);
  }
}

// Lists every file under dir as { relPath, size }, relPath with forward slashes.
function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, relPath));
    } else {
      files.push({ relPath, size: fs.statSync(fullPath).size });
    }
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function totalSize(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// @electron/asar and resedit are dependencies of @electron/packager, not of
// this project, so npm may or may not hoist them to the top of node_modules.
// Resolving from inside the packager finds them in either layout.
async function importBuildTool(name) {
  try {
    const fromProject = createRequire(path.join(ROOT, 'package.json'));
    const packagerEntry = fromProject.resolve('@electron/packager');
    const entry = name === '@electron/packager' ? packagerEntry : createRequire(packagerEntry).resolve(name);
    return await import(pathToFileURL(entry).href);
  } catch (err) {
    return fail(`Could not load the build tool "${name}" (${err.message}).\nRun "npm install" in ${ROOT} and try again.`);
  }
}

// ---------------------------------------------------------------------------
// Step 1: inputs
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.includes(arg));
  check(unknown.length === 0, `Unknown option: ${unknown.join(' ')}\nKnown options: ${KNOWN_FLAGS.join(' ')}`);
  return {
    skipInstaller: argv.includes('--skip-installer'),
    keepOut: argv.includes('--keep'),
    keepLocales: argv.includes('--keep-locales'),
    keepWebgpu: argv.includes('--keep-webgpu'),
  };
}

function readAppManifest() {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  // Windows version resources (and NSIS VIProductVersion) hold four numbers,
  // so "1.0.0-beta" style versions cannot be represented.
  check(
    typeof pkg.version === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.version),
    `package.json "version" is ${JSON.stringify(pkg.version)} but must be three numbers such as 1.0.0.`
  );
  check(typeof pkg.main === 'string' && pkg.main.length > 0, 'package.json has no "main" entry.');
  // node_modules is left out of the package on purpose. If the app ever gains
  // a runtime dependency it would start fine here and crash once installed.
  const runtimeDeps = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  check(
    runtimeDeps.length === 0,
    `package.json now lists runtime dependencies (${runtimeDeps.join(', ')}) but this build leaves node_modules out of the app.\n` +
      'Teach isRuntimePath() in scripts/build-win.mjs to include them before building.'
  );
  return pkg;
}

function readElectronVersion() {
  const manifest = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  check(fs.existsSync(manifest), `Electron is not installed. Run "npm install" in ${ROOT} and try again.`);
  return readJson(manifest).version;
}

// Returns the pixel sizes stored in an .ico file, plus the raw bytes of each image.
function readIco(file) {
  const data = fs.readFileSync(file);
  check(data.length >= 6 && data.readUInt16LE(0) === 0 && data.readUInt16LE(2) === 1, `${relative(file)} is not a valid .ico file.`);
  const count = data.readUInt16LE(4);
  const images = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    check(entry + 16 <= data.length, `${relative(file)} is truncated.`);
    const size = data.readUInt8(entry) || 256; // 0 means 256
    const length = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    check(offset + length <= data.length, `${relative(file)} is truncated.`);
    images.push({ size, bytes: data.subarray(offset, offset + length) });
  }
  return images;
}

function checkIcons() {
  check(fs.existsSync(ICON_PNG), `Missing ${relative(ICON_PNG)} (window icon).`);
  check(fs.existsSync(ICON_ICO), `Missing ${relative(ICON_ICO)} (exe and installer icon).`);
  const sizes = readIco(ICON_ICO).map((image) => image.size).sort((a, b) => a - b);
  const missing = ICON_SIZES.filter((size) => !sizes.includes(size));
  check(missing.length === 0, `${relative(ICON_ICO)} lacks these sizes: ${missing.join(', ')} (found ${sizes.join(', ')}).`);
}

function checkAppFiles(pkg) {
  for (const file of new Set([pkg.main, ...REQUIRED_APP_FILES])) {
    check(fs.existsSync(path.join(ROOT, file)), `The app file ${file} does not exist.`);
  }
}

function findMakensis() {
  const candidates = ['makensis'];
  if (process.platform === 'win32') {
    // The NSIS setup program does not add itself to PATH.
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (base) candidates.push(path.join(base, 'NSIS', 'makensis.exe'));
    }
  }
  const versionFlag = process.platform === 'win32' ? '/VERSION' : '-VERSION';
  for (const command of candidates) {
    const result = spawnSync(command, [versionFlag], { encoding: 'utf8' });
    if (!result.error && result.status === 0) {
      const version = result.stdout.trim();
      check(/^v3\./.test(version), `makensis ${version} was found but NSIS 3 is required.`);
      return { command, version };
    }
  }
  return fail(
    'makensis (NSIS 3) was not found, so the installer cannot be built.\n' +
      'Install NSIS (Debian/Ubuntu: "apt-get install nsis", Windows: https://nsis.sourceforge.io) ' +
      'or run with --skip-installer to package only.'
  );
}

function checkInputs(flags) {
  const pkg = readAppManifest();
  const electronVersion = readElectronVersion();
  checkAppFiles(pkg);
  checkIcons();
  let makensis = null;
  if (!flags.skipInstaller) {
    check(fs.existsSync(INSTALLER_SCRIPT), `Missing ${relative(INSTALLER_SCRIPT)}.`);
    makensis = findMakensis();
  }
  console.log(`  app ${pkg.version}, Electron ${electronVersion}${makensis ? `, makensis ${makensis.version}` : ''}`);
  return { pkg, electronVersion, makensis };
}

// ---------------------------------------------------------------------------
// Step 2: package
// ---------------------------------------------------------------------------

// name is the path inside the project with a leading slash ('' for the root).
function isRuntimePath(name) {
  if (name === '' || name === '/') return true;
  // The build folder itself must be entered to reach the two icons in it.
  if (name === '/build') return true;
  if (RUNTIME_FILES.includes(name)) return true;
  return RUNTIME_DIRS.some((dir) => name === dir || name.startsWith(`${dir}/`));
}

function prepareOutDir(flags) {
  if (!flags.keepOut) fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function packageApp({ pkg, electronVersion }) {
  const { packager } = await importBuildTool('@electron/packager');
  const options = {
    dir: ROOT,
    out: OUT_DIR,
    name: APP_NAME,
    executableName: APP_NAME,
    platform: PLATFORM,
    arch: ARCH,
    electronVersion,
    asar: true,
    prune: true,
    overwrite: true,
    appVersion: pkg.version,
    buildVersion: pkg.version,
    icon: ICON_ICO,
    appCopyright: `Copyright (C) ${new Date().getFullYear()} ${APP_NAME}`,
    win32metadata: WIN32_METADATA,
    // An allowlist: a new top-level file or folder is left out until someone
    // decides it belongs in the app, which is the safe default.
    ignore: (name) => !isRuntimePath(name),
  };
  // Offline builds: a folder that already holds electron-v<version>-win32-x64.zip.
  if (process.env.ELECTRON_ZIP_DIR) options.electronZipDir = path.resolve(process.env.ELECTRON_ZIP_DIR);

  let appPaths;
  try {
    appPaths = await packager(options);
  } catch (err) {
    fail(
      `@electron/packager failed: ${err.message}\n` +
        `If this is a download problem, check the internet connection (Electron ${electronVersion} for Windows is fetched ` +
        'from github.com once and then cached), or set ELECTRON_ZIP_DIR to a folder that holds ' +
        `electron-v${electronVersion}-${PLATFORM}-${ARCH}.zip.`
    );
  }
  check(
    appPaths.length === 1 && path.resolve(appPaths[0]) === PACKAGED_DIR,
    `The packager wrote ${JSON.stringify(appPaths)} instead of ${relative(PACKAGED_DIR)}.`
  );
  console.log(`  ${relative(PACKAGED_DIR)}`);
}

// ---------------------------------------------------------------------------
// Step 3: trim
// ---------------------------------------------------------------------------

// Chromium ships a translation file per language (about 50 of them). When the
// file for the user's language is missing it falls back to en-US, so only
// that one is kept. Nothing else is removed: no DLL, no licence file.
function trimLocales(flags) {
  if (flags.keepLocales) {
    console.log('  --keep-locales: nothing removed');
    return 0;
  }
  const localesDir = path.join(PACKAGED_DIR, 'locales');
  const keep = 'en-US.pak';
  check(fs.existsSync(path.join(localesDir, keep)), `locales/${keep} is missing from the Electron distribution; refusing to trim.`);

  const before = listFiles(PACKAGED_DIR).filter((file) => !file.relPath.startsWith('locales/'));

  let removed = 0;
  let savedBytes = 0;
  for (const name of fs.readdirSync(localesDir)) {
    if (name === keep || !name.endsWith('.pak')) continue;
    const file = path.join(localesDir, name);
    savedBytes += fs.statSync(file).size;
    fs.rmSync(file);
    removed += 1;
  }

  // Belt and braces: prove that nothing outside locales/ changed.
  const after = listFiles(PACKAGED_DIR).filter((file) => !file.relPath.startsWith('locales/'));
  check(JSON.stringify(before) === JSON.stringify(after), 'Trimming changed files outside locales/. This is a bug in trimLocales().');

  console.log(`  removed ${removed} locale files, saved ${formatMb(savedBytes)} (kept locales/${keep})`);
  return savedBytes;
}

// The WebGPU shader compiler: large, and unused by a video player.
function trimWebGpu(flags) {
  if (flags.keepWebgpu) {
    console.log('  --keep-webgpu: WebGPU files kept');
    return 0;
  }
  let savedBytes = 0;
  const removed = [];
  for (const name of WEBGPU_ONLY_FILES) {
    const file = path.join(PACKAGED_DIR, name);
    if (!fs.existsSync(file)) continue;
    savedBytes += fs.statSync(file).size;
    fs.rmSync(file);
    removed.push(name);
  }
  console.log(removed.length ? `  removed ${removed.join(', ')} (used by WebGPU only), saved ${formatMb(savedBytes)}` : '  no WebGPU-only files in this Electron version');
  return savedBytes;
}

// ---------------------------------------------------------------------------
// Step 4: verify the packaged folder
// ---------------------------------------------------------------------------

function verifyDistFiles() {
  for (const file of REQUIRED_DIST_FILES) {
    const fullPath = path.join(PACKAGED_DIR, file);
    check(fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0, `The packaged app is missing ${file}.`);
  }
  console.log(`  ${REQUIRED_DIST_FILES.length} required files present (exe, licences, ffmpeg.dll, en-US locale, app.asar)`);
}

async function verifyAsar(pkg) {
  const asar = await importBuildTool('@electron/asar');
  const asarPath = path.join(PACKAGED_DIR, 'resources', 'app.asar');
  // Entries come back as "/main/main.js" (backslashes on Windows).
  const entries = asar.listPackage(asarPath, { isPack: false }).map((entry) => entry.replace(/\\/g, '/'));

  for (const file of new Set(['package.json', pkg.main, ...REQUIRED_APP_FILES, 'build/icon.png', 'build/icon.ico'])) {
    check(entries.includes(`/${file}`), `app.asar does not contain ${file}.`);
  }
  const strays = entries.filter((entry) => !isRuntimePath(entry));
  check(strays.length === 0, `app.asar contains files that do not belong in the app: ${strays.slice(0, 10).join(', ')}`);

  const packed = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  check(packed.version === pkg.version, `app.asar package.json has version ${packed.version}, expected ${pkg.version}.`);
  check(packed.main === pkg.main, `app.asar package.json has main ${packed.main}, expected ${pkg.main}.`);
  console.log(`  app.asar: ${entries.length} entries, only package.json, main/, src/ and the two icons`);
}

// Reads what Windows shows for an .exe: header, version strings, icons, manifest.
function readExeResources(resedit, file) {
  const exe = resedit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const resources = resedit.NtExecutableResource.from(exe);
  const versions = resedit.Resource.VersionInfo.fromEntries(resources.entries);
  check(versions.length === 1, `${relative(file)} has ${versions.length} version resources, expected 1.`);
  const languages = versions[0].getAllLanguagesForStringValues();
  check(languages.length >= 1, `${relative(file)} has no version strings.`);
  const iconGroups = resedit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const manifest = resources.entries.find((entry) => entry.type === RT_MANIFEST);
  const fixed = versions[0].fixedInfo;
  return {
    machine: exe.newHeader.fileHeader.machine,
    subsystem: exe.newHeader.optionalHeader.subsystem,
    strings: versions[0].getStringValues(languages[0]),
    fileVersion: [fixed.fileVersionMS >>> 16, fixed.fileVersionMS & 0xffff, fixed.fileVersionLS >>> 16, fixed.fileVersionLS & 0xffff].join('.'),
    iconGroups,
    icons: iconGroups.flatMap((group) => group.getIconItemsFromEntries(resources.entries)),
    manifest: manifest ? Buffer.from(manifest.bin).toString('utf8') : '',
  };
}

function checkVersionStrings(what, strings, expected) {
  for (const [key, value] of Object.entries(expected)) {
    check(strings[key] === value, `${what}: version resource ${key} is ${JSON.stringify(strings[key])}, expected ${JSON.stringify(value)}.`);
  }
}

// True when the exe carries our icon and not the stock Electron or NSIS one:
// the largest image in build/icon.ico must be embedded byte for byte.
function hasOurIcon(resources) {
  const largest = readIco(ICON_ICO).sort((a, b) => b.size - a.size)[0];
  return resources.icons.some((icon) => icon.isRaw() && Buffer.from(icon.bin).equals(largest.bytes));
}

async function verifyAppExe(pkg) {
  const resedit = await importBuildTool('resedit');
  const exePath = path.join(PACKAGED_DIR, EXE_NAME);
  const resources = readExeResources(resedit, exePath);

  check(resources.machine === PE_MACHINE_X64, `${EXE_NAME} is not a 64-bit x64 program (machine 0x${resources.machine.toString(16)}).`);
  check(resources.subsystem === PE_SUBSYSTEM_GUI, `${EXE_NAME} is not a Windows GUI program.`);
  checkVersionStrings(EXE_NAME, resources.strings, {
    ...WIN32_METADATA,
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  });
  check(resources.fileVersion === `${pkg.version}.0`, `${EXE_NAME}: numeric file version is ${resources.fileVersion}, expected ${pkg.version}.0.`);
  check(resources.iconGroups.length >= 1, `${EXE_NAME} has no icon.`);
  check(hasOurIcon(resources), `${EXE_NAME} does not carry build/icon.ico (it still has another icon).`);
  console.log(`  ${EXE_NAME}: x64 GUI, ProductName "${resources.strings.ProductName}", FileVersion ${resources.strings.FileVersion}, ` +
    `${resources.iconGroups.length} icon group with ${resources.icons.length} images from build/icon.ico`);
}

async function verifyPackage(pkg) {
  verifyDistFiles();
  await verifyAsar(pkg);
  await verifyAppExe(pkg);
}

// ---------------------------------------------------------------------------
// Step 5: installer
// ---------------------------------------------------------------------------

// NSIS reads "$" as the start of a variable; "$$" is a literal dollar sign.
function nsisPath(relPath) {
  check(!/["\r\n]/.test(relPath), `The file name ${JSON.stringify(relPath)} cannot be written into the installer script.`);
  return relPath.replace(/\$/g, '$$$$').replace(/\//g, '\\');
}

// The uninstaller removes exactly the files the installer copied, then each
// folder if it is empty (deepest first). See the notes in build/installer.nsi
// for why it must never delete the install folder recursively.
function writeUninstallList(files) {
  const dirs = new Set();
  for (const file of files) {
    let dir = path.posix.dirname(file.relPath);
    while (dir !== '.') {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  const deepestFirst = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
  const lines = [
    '; Generated by scripts/build-win.mjs. Do not edit.',
    ...files.map((file) => `Delete "$INSTDIR\\${nsisPath(file.relPath)}"`),
    ...deepestFirst.map((dir) => `RMDir "$INSTDIR\\${nsisPath(dir)}"`),
  ];
  fs.writeFileSync(UNINSTALL_LIST, `${lines.join('\r\n')}\r\n`);
}

function runMakensis(makensis, version, outputFile) {
  // makensis takes "-" options everywhere except on Windows.
  const dash = process.platform === 'win32' ? '/' : '-';
  const args = [
    `${dash}V4`,
    `${dash}WX`, // warnings are errors: an installer nobody can test here must at least compile cleanly
    `${dash}INPUTCHARSET`, 'UTF8',
    `${dash}DAPP_VERSION=${version}`,
    `${dash}DSOURCE_DIR=${PACKAGED_DIR}`,
    `${dash}DOUTPUT_FILE=${outputFile}`,
    `${dash}DUNINSTALL_LIST=${UNINSTALL_LIST}`,
    INSTALLER_SCRIPT,
  ];
  const result = spawnSync(makensis.command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(MAKENSIS_LOG, log);

  if (result.error || result.status !== 0) {
    const tail = log.trim().split(/\r?\n/).slice(-25).join('\n');
    fail(`makensis failed${result.error ? ` (${result.error.message})` : ` with exit code ${result.status}`}.\n` +
      `Full log: ${relative(MAKENSIS_LOG)}\n--- last lines ---\n${tail}`);
  }
  // -WX already turns warnings into a failure; this catches a makensis that ignores the flag.
  check(!/^\s*\d+ warnings?:/im.test(log), `makensis reported warnings. See ${relative(MAKENSIS_LOG)}.`);
  const totals = log.match(/^Total size:.*$/m);
  console.log(`  makensis: ${totals ? totals[0].trim() : 'done'} (log: ${relative(MAKENSIS_LOG)})`);
}

// NSIS appends its data to a small Windows program. The data starts with a
// 28-byte header on a 512-byte boundary: flags, 0xDEADBEEF, "NullsoftInst",
// header size, and the length of everything from here to the end of the file.
function findNsisHeader(data) {
  for (let offset = 0; offset + 28 <= data.length; offset += 512) {
    if (data.readUInt32LE(offset + 4) === 0xdeadbeef && data.toString('latin1', offset + 8, offset + 20) === 'NullsoftInst') {
      return { offset, flags: data.readUInt32LE(offset), length: data.readUInt32LE(offset + 24) };
    }
  }
  return null;
}

async function verifyInstaller(installerPath, pkg) {
  const resedit = await importBuildTool('resedit');
  const data = fs.readFileSync(installerPath);
  const what = path.basename(installerPath);

  const resources = readExeResources(resedit, installerPath);
  // The NSIS launcher is a 32-bit program on purpose; it runs on every 64-bit Windows.
  check(resources.machine === PE_MACHINE_X86, `${what} is not a 32-bit x86 program (machine 0x${resources.machine.toString(16)}).`);
  check(resources.subsystem === PE_SUBSYSTEM_GUI, `${what} is not a Windows GUI program.`);
  checkVersionStrings(what, resources.strings, { ProductName: APP_NAME, FileVersion: pkg.version, ProductVersion: pkg.version });
  check(resources.fileVersion === `${pkg.version}.0`, `${what}: numeric file version is ${resources.fileVersion}, expected ${pkg.version}.0.`);
  check(resources.iconGroups.length >= 1 && hasOurIcon(resources), `${what} does not carry build/icon.ico.`);
  // asInvoker = start with the user's own rights, which is what keeps Windows from showing a UAC prompt.
  check(/requestedExecutionLevel\s+level="asInvoker"/.test(resources.manifest), `${what} would ask for administrator rights (no asInvoker manifest).`);

  const header = findNsisHeader(data);
  check(header !== null, `${what} contains no NSIS installer data.`);
  check(header.offset + header.length === data.length,
    `${what} is truncated or padded: NSIS data should end at byte ${header.offset + header.length} but the file has ${data.length} bytes.`);
  // The last four bytes are the checksum the installer verifies about itself
  // on start ("Installer integrity check has failed" when it does not match).
  // NSIS leaves the first 512 bytes (the part of the Windows program header
  // that code signing rewrites) out of that checksum.
  const storedCrc = data.readUInt32LE(data.length - 4);
  const actualCrc = zlib.crc32(data.subarray(512, data.length - 4));
  check(storedCrc === actualCrc, `${what} fails its own integrity check (CRC ${actualCrc.toString(16)} != ${storedCrc.toString(16)}).`);

  console.log(`  ${what}: 32-bit NSIS launcher, no-UAC manifest, our icon, version ${resources.strings.FileVersion}, ` +
    `data block complete (${formatMb(header.length)}), CRC ok`);
}

// Copy next to the destination first, then rename: the download folder never
// holds a half-written installer, even if the copy is interrupted.
function publishInstaller(builtFile, finalFile) {
  fs.mkdirSync(path.dirname(finalFile), { recursive: true });
  const partial = `${finalFile}.partial`;
  fs.copyFileSync(builtFile, partial);
  fs.renameSync(partial, finalFile);
  fs.rmSync(builtFile);
}

async function buildInstaller({ pkg, makensis }, files) {
  const fileName = `Avengers-Player-Setup-${pkg.version}.exe`;
  const builtFile = path.join(OUT_DIR, fileName);
  const finalFile = path.join(DOWNLOAD_DIR, fileName);

  // A leftover installer of this version would be mistaken for the result of
  // this run if a later step fails, so it goes first. Other files in the
  // download folder are not touched.
  fs.rmSync(finalFile, { force: true });
  fs.rmSync(builtFile, { force: true });

  writeUninstallList(files);
  console.log('  compressing (solid LZMA, this takes a minute or two)...');
  runMakensis(makensis, pkg.version, builtFile);
  check(fs.existsSync(builtFile), `makensis reported success but ${relative(builtFile)} does not exist.`);
  await verifyInstaller(builtFile, pkg);

  const size = fs.statSync(builtFile).size;
  if (size > MAX_INSTALLER_BYTES) {
    // Left in out/ on purpose: a file GitHub would reject must not land in the release folder.
    fail(
      `The installer is ${formatMb(size)}, over the ${formatMb(MAX_INSTALLER_BYTES)} limit (GitHub rejects files above 100 MB).\n` +
        `It was left at ${relative(builtFile)} and not copied to the download folder.\n` +
        'Look for large files that slipped into main/ or src/ (movies, test media), and make sure --keep-locales is not set.'
    );
  }
  publishInstaller(builtFile, finalFile);
  return { file: finalFile, size, sha256: sha256(finalFile) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runStep(title, action) {
  console.log(`\n${title}`);
  try {
    return await action();
  } catch (err) {
    err.step = title;
    throw err;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const stepCount = flags.skipInstaller ? 4 : 5;
  console.log(`Building ${APP_NAME} for Windows (${ARCH})`);

  const inputs = await runStep(`[1/${stepCount}] Checking inputs`, () => checkInputs(flags));
  await runStep(`[2/${stepCount}] Packaging the app`, async () => {
    prepareOutDir(flags);
    await packageApp(inputs);
  });
  const savedBytes = await runStep(`[3/${stepCount}] Trimming the Electron distribution`, () => trimLocales(flags) + trimWebGpu(flags));
  await runStep(`[4/${stepCount}] Verifying the packaged app`, () => verifyPackage(inputs.pkg));

  const files = listFiles(PACKAGED_DIR);
  let installer = null;
  if (!flags.skipInstaller) {
    installer = await runStep(`[5/${stepCount}] Building the installer`, () => buildInstaller(inputs, files));
  }

  console.log('\nSummary');
  console.log(`  version          ${inputs.pkg.version} (Electron ${inputs.electronVersion})`);
  console.log(`  packaged folder  ${relative(PACKAGED_DIR)}`);
  console.log(`  folder size      ${formatMb(totalSize(files))} in ${files.length} files (trimming saved ${formatMb(savedBytes)})`);
  if (installer) {
    console.log(`  installer        ${installer.file}`);
    console.log(`  installer size   ${formatMb(installer.size)} (${installer.size} bytes, limit ${formatMb(MAX_INSTALLER_BYTES)})`);
    console.log(`  SHA-256          ${installer.sha256}`);
  } else {
    console.log('  installer        skipped (--skip-installer)');
  }
  console.log('\nBuild OK');
}

main().catch((err) => {
  console.error(`\nBUILD FAILED${err.step ? ` at ${err.step}` : ''}`);
  console.error(err instanceof BuildError ? err.message : err.stack || String(err));
  process.exitCode = 1;
});
