using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// PlayStation pads (DualShock 4, its USB wireless adapter, DualSense, DualSense Edge; USB and Bluetooth) read directly
/// from their HID input reports, for <see cref="ControllerManager"/>. Used only on its polling thread.
/// </summary>
/// <remarks>
/// <para>Discovery: every 2 s the present HID interfaces are listed (SetupDiGetClassDevs(HidD_GetHidGuid,
/// DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)). A new path is probed once with a zero-access handle (allowed even for
/// keyboards and mice): HidD_GetAttributes for vendor/product id, HidP_GetCaps for the top-level collection (only the
/// Generic Desktop game pad / joystick collection is used) and InputReportByteLength, HidD_GetProductString for the
/// name. Paths that aren't supported pads are remembered while they stay present, so they aren't opened again.</para>
/// <para>Reading: a supported pad is opened with GENERIC_READ only, FILE_SHARE_READ | FILE_SHARE_WRITE (Steam, the
/// game and DS4Windows keep their own handles; Windows gives every handle its own copy of each input report) and
/// FILE_FLAG_OVERLAPPED. Each pad has one <see cref="OverlappedReader"/> (one ReadFile always pending); every poll
/// collects the reports that arrived without waiting (HidD_SetNumInputBuffers(64) on our handle, so 250-1000 reports/s
/// fit between two polls). Nothing is ever written to a pad: no output or feature reports, so no LED, rumble or mode
/// change that could fight with a game (a DualShock 4 on Bluetooth therefore usually stays in its default "simple"
/// report mode unless Steam or a game switches it, and both modes are parsed). Layouts: <see cref="SonyReportParser"/>.</para>
/// <para>Bluetooth full reports are checked against their CRC-32. Like SDL, a pad that has sent valid checksums drops
/// a report whose checksum fails; one that never sent a valid checksum (some clones) is trusted anyway.</para>
/// <para>Connected: a pad is reported connected from its first input report, not when its path opens (Windows keeps a
/// paired Bluetooth pad's HID interface present after it is switched off; opening it still works and reads just stay
/// pending). A Bluetooth pad that streams checksummed full reports and goes silent for 5 s is reported disconnected (its
/// handle and read stay open) and connected again by its next report.</para>
/// <para>Failure handling: access denied (HidHide hiding the pad, another program holding it exclusively) or any other
/// open error is logged once per pad and retried at every scan quietly. A read error (unplugged, Bluetooth link lost)
/// closes the pad and reports it disconnected; it reconnects at the next scan if it is still there. A pad whose reads
/// fail again right after opening is retried with a growing delay (up to a minute) so a broken device can't make the
/// log flicker every 2 s.</para>
/// <para>Caveat: while PC Clipper holds its shared handle, a program that later asks for exclusive access (share mode
/// 0, e.g. DS4Windows' old "Hide DS4 Controller" exclusive mode) is refused by Windows, and a non-elevated DS4Windows
/// then falls back to a shared open, so games see the real pad next to the virtual one. HidHide-based setups are not
/// affected; the README and the Settings > Controller hint say so.</para>
/// </remarks>
internal sealed unsafe class SonyHidPads : IDisposable
{
    private const int RescanIntervalMs = 2000;
    private const int ReportsPerPollLimit = 128;
    private const uint InputBuffers = 64;
    /// <summary>A pad whose reads fail within this time after opening counts as flaky (exponential retry delay).</summary>
    private const int FlakyWithinMs = 5000;
    private const int MaxRetryDelayMs = 60_000;
    /// <summary>
    /// A Bluetooth pad that streams full (checksummed) reports and has sent nothing for this long is switched off or out of
    /// range: Windows keeps the HID interface of a paired pad present and its reads just stay pending, so silence is the
    /// only sign. It is reported disconnected (handle and read kept) and connected again by its next report.
    /// </summary>
    private const int BluetoothSilenceMs = 5000;

    private readonly ILog _log;
    private readonly Dictionary<string, Pad> _pads = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Present paths that aren't supported pads (or are other collections of one).</summary>
    private readonly HashSet<string> _ignored = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Paths whose open problem has been logged (cleared when the device goes away).</summary>
    private readonly HashSet<string> _problemLogged = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Flaky paths: consecutive quick failures and the earliest next attempt.</summary>
    private readonly Dictionary<string, (int Failures, long RetryAt)> _backoff = new(StringComparer.OrdinalIgnoreCase);
    private Guid _hidGuid;
    private bool _haveGuid;
    private long _nextScan;
    private bool _enumerationProblemLogged;
    /// <summary>The current poll's time, for <see cref="OnReport"/> (its cached callback takes no extra arguments).</summary>
    private long _nowMs;

    public SonyHidPads(ILog log) => _log = log;

    public void Poll(long nowMs, IPadSink sink)
    {
        _nowMs = nowMs;
        if (nowMs >= _nextScan)
        {
            _nextScan = nowMs + RescanIntervalMs;
            Rescan(nowMs, sink);
        }
        if (_pads.Count == 0) return;

        List<Pad>? dead = null;
        foreach (var pad in _pads.Values)
        {
            if (!Pump(pad))
            {
                (dead ??= new List<Pad>()).Add(pad);
                continue;
            }
            // A Bluetooth pad that was switched off (or went out of range) mostly doesn't fail its read: it just goes quiet.
            // Only pads known to stream continuously (genuine pads sending checksummed full reports, 250-1000 per second)
            // are timed out; some clones only report changes and would flap between connected and disconnected.
            if (pad.BluetoothPath && !pad.IsDongle && pad.Announced && pad.ValidChecksums > 0 &&
                nowMs - pad.LastReportMs > BluetoothSilenceMs)
            {
                pad.Announced = false; // the next report announces it again (the toast is once per controller and session)
                sink.OnPadDisconnected(pad.Info);
            }
        }
        if (dead is null) return;
        foreach (var pad in dead) Close(pad, nowMs, sink, failed: true);
    }

    // ---- discovery ----

    private void Rescan(long nowMs, IPadSink sink)
    {
        List<string>? paths = EnumerateHidPaths();
        if (paths is null) return; // keep what is open; logged once
        var present = new HashSet<string>(paths, StringComparer.OrdinalIgnoreCase);

        // Gone from the device list (normally the read failed first, but not always on Bluetooth).
        foreach (var pad in _pads.Values.Where(p => !present.Contains(p.Path)).ToList()) Close(pad, nowMs, sink, failed: false);
        _ignored.RemoveWhere(p => !present.Contains(p));
        _problemLogged.RemoveWhere(p => !present.Contains(p));
        foreach (var p in _backoff.Keys.Where(p => !present.Contains(p)).ToList()) _backoff.Remove(p);

        foreach (var path in paths)
        {
            if (_pads.ContainsKey(path) || _ignored.Contains(path)) continue;
            if (_backoff.TryGetValue(path, out var b) && nowMs < b.RetryAt) continue;
            TryOpen(path, nowMs, sink);
        }
    }

    private void TryOpen(string path, long nowMs, IPadSink sink)
    {
        ushort vid, pid;
        ControllerKind kind;
        string name;
        int inputLength;
        // 1) Identify with a zero-access handle (no read rights needed; never disturbs the device).
        using (var probe = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero))
        {
            if (probe.IsInvalid)
            {
                int err = Marshal.GetLastWin32Error();
                // Can't tell what it is. A Sony path is worth retrying (and mentioning); anything else is ignored.
                if (path.Contains("054c", StringComparison.OrdinalIgnoreCase)) LogProblemOnce(path, $"A Sony HID device couldn't be queried (Windows error {err}).");
                else _ignored.Add(path);
                return;
            }
            var attributes = new HIDD_ATTRIBUTES { Size = (uint)sizeof(HIDD_ATTRIBUTES) };
            if (!HidD_GetAttributes(probe, ref attributes)) { _ignored.Add(path); return; }
            vid = attributes.VendorID;
            pid = attributes.ProductID;
            if (SonyReportParser.KindFor(vid, pid) is not { } k) { _ignored.Add(path); return; }
            kind = k;

            if (!TryGetCaps(probe, out var caps))
            {
                LogProblemOnce(path, $"{SonyReportParser.DefaultName(pid)}: its HID description couldn't be read.");
                return;
            }
            // Only the game pad collection carries the buttons (UsagePage Generic Desktop, Usage Joystick/Game Pad).
            if (caps.UsagePage != 0x01 || (caps.Usage != 0x04 && caps.Usage != 0x05) || caps.InputReportByteLength < 10)
            {
                _ignored.Add(path);
                return;
            }
            inputLength = caps.InputReportByteLength;
            name = SonyReportParser.DisplayName(GetProductString(probe), pid);
        }

        // 2) Open for reading. Shared both ways; read access only (we never write to the pad).
        var handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int err = Marshal.GetLastWin32Error();
            handle.Dispose();
            string why = err switch
            {
                ERROR_ACCESS_DENIED => "Windows denied access (error 5). If HidHide hides it, add PC Clipper to HidHide's allowed apps; DS4Windows' virtual Xbox controller is picked up either way.",
                ERROR_SHARING_VIOLATION => "another program has it open exclusively (error 32), e.g. DS4Windows in exclusive mode.",
                _ => $"it couldn't be opened (Windows error {err}).",
            };
            LogProblemOnce(path, $"Controller found but not readable: {name}: {why}");
            return;
        }
        try { HidD_SetNumInputBuffers(handle, InputBuffers); } catch { /* the default (32) is fine too */ }

        bool bluetooth = SonyReportParser.IsBluetoothPath(path) || inputLength > 64; // USB pads have 64-byte reports
        bool dongle = pid == SonyReportParser.PidDualShock4Dongle;
        var info = new ControllerInfo(path, kind, name, bluetooth ? "Bluetooth" : "USB");
        OverlappedReader reader;
        try { reader = new OverlappedReader(handle, inputLength); }
        catch (Exception ex)
        {
            handle.Dispose();
            LogProblemOnce(path, $"{name}: reading couldn't be set up ({ex.Message}).");
            return;
        }
        var pad = new Pad(path, reader, info, kind, SonyReportParser.IsBluetoothPath(path), dongle, nowMs);
        pad.Handler = report => OnReport(pad, report, sink);
        _pads[path] = pad;
        _problemLogged.Remove(path);
        // Not announced yet: a pad counts as connected from its first input report (OnReport). Windows keeps a paired
        // Bluetooth pad's HID interface present while the pad is off, and opening it still works, so an open path proves
        // nothing. USB pads stream at 250-1000 Hz and are announced within a poll or two; a wireless adapter is
        // "connected" only while a pad is paired and on (its reports say so).
    }

    private static bool TryGetCaps(SafeFileHandle h, out HIDP_CAPS caps)
    {
        caps = default;
        if (!HidD_GetPreparsedData(h, out IntPtr pp) || pp == IntPtr.Zero) return false;
        try { return HidP_GetCaps(pp, out caps) == HIDP_STATUS_SUCCESS; }
        finally { HidD_FreePreparsedData(pp); }
    }

    private static string? GetProductString(SafeFileHandle h)
    {
        const int bytes = 512; // 255 UTF-16 characters + terminator; USB strings are at most 126 characters
        byte* buffer = stackalloc byte[bytes];
        new Span<byte>(buffer, bytes).Clear();
        try
        {
            if (!HidD_GetProductString(h, buffer, bytes)) return null;
            return new string((char*)buffer, 0, bytes / 2 - 1).Split('\0')[0];
        }
        catch { return null; }
    }

    /// <summary>The device paths of all present HID interfaces, or null if the list couldn't be read.</summary>
    private List<string>? EnumerateHidPaths()
    {
        try
        {
            if (!_haveGuid)
            {
                HidD_GetHidGuid(out _hidGuid);
                _haveGuid = true;
            }
            var list = new List<string>();
            IntPtr set = SetupDiGetClassDevsW(ref _hidGuid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (set == INVALID_HANDLE_VALUE)
            {
                LogEnumerationProblem($"SetupDiGetClassDevs failed (Windows error {Marshal.GetLastWin32Error()})");
                return null;
            }
            try
            {
                for (uint index = 0; index < 1024; index++)
                {
                    var data = new SP_DEVICE_INTERFACE_DATA { cbSize = (uint)sizeof(SP_DEVICE_INTERFACE_DATA) };
                    if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref _hidGuid, index, ref data)) break; // ERROR_NO_MORE_ITEMS
                    SetupDiGetDeviceInterfaceDetailW(set, ref data, IntPtr.Zero, 0, out uint required, IntPtr.Zero);
                    if (required < 8 || required > 64 * 1024) continue;
                    IntPtr detail = Marshal.AllocHGlobal((int)required);
                    try
                    {
                        // SP_DEVICE_INTERFACE_DETAIL_DATA_W: DWORD cbSize (= 8 on x64, 6 on x86) + WCHAR DevicePath[].
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetailW(set, ref data, detail, required, out _, IntPtr.Zero)) continue;
                        string? path = Marshal.PtrToStringUni(detail + 4);
                        if (!string.IsNullOrEmpty(path)) list.Add(path);
                    }
                    finally { Marshal.FreeHGlobal(detail); }
                }
            }
            finally { SetupDiDestroyDeviceInfoList(set); }
            _enumerationProblemLogged = false;
            return list;
        }
        catch (Exception ex)
        {
            LogEnumerationProblem(ex.GetType().Name + ": " + ex.Message);
            return null;
        }
    }

    // ---- reading ----

    /// <summary>Hands the reports that arrived since the last poll to <see cref="OnReport"/>. False when the pad is gone or broken.</summary>
    private static bool Pump(Pad pad)
    {
        int error = pad.Reader.Pump(ReportsPerPollLimit, pad.Handler);
        if (error == 0) return true;
        pad.LastError = error;
        return false;
    }

    private void OnReport(Pad pad, ReadOnlySpan<byte> report, IPadSink sink)
    {
        if (SonyReportParser.HasBluetoothChecksum(report, pad.Kind))
        {
            if (SonyReportParser.BluetoothChecksumOk(report))
            {
                if (pad.ValidChecksums < 1000) pad.ValidChecksums++;
            }
            else if (pad.ValidChecksums > 0)
            {
                pad.ValidChecksums--;
                if (pad.ValidChecksums >= 3) return; // a pad with good checksums sent a damaged report: skip it
            }
        }
        pad.LastReportMs = _nowMs;

        // A report means the pad is really there (on, and in range): announce it now (again after a silence timeout).
        if (!pad.IsDongle && !pad.Announced)
        {
            pad.Announced = true;
            sink.OnPadConnected(pad.Info);
        }

        if (pad.IsDongle && SonyReportParser.DongleHasController(report) is { } hasPad)
        {
            if (hasPad && !pad.Announced)
            {
                pad.Announced = true;
                sink.OnPadConnected(pad.Info);
            }
            else if (!hasPad && pad.Announced)
            {
                pad.Announced = false;
                sink.OnPadDisconnected(pad.Info);
                return;
            }
            if (!hasPad) return;
        }

        if (!pad.Announced) return;
        if (SonyReportParser.Parse(report, pad.Kind, pad.BluetoothPath) is { } buttons) sink.OnPadState(pad.Info, buttons);
    }

    private void Close(Pad pad, long nowMs, IPadSink sink, bool failed)
    {
        _pads.Remove(pad.Path);
        bool announced = pad.Announced;
        pad.Dispose();
        if (failed)
        {
            // 1167 = unplugged / Bluetooth link dropped, the normal case. Anything else is worth a line in the log.
            if (pad.LastError != ERROR_DEVICE_NOT_CONNECTED && announced) _log.Info($"{pad.Info}: reading stopped (Windows error {pad.LastError}).");
            // Quick repeated failures: back off.
            bool flaky = nowMs - pad.OpenedAtMs < FlakyWithinMs;
            int failures = flaky && _backoff.TryGetValue(pad.Path, out var b) ? b.Failures + 1 : flaky ? 1 : 0;
            if (failures > 0)
            {
                long delay = Math.Min(MaxRetryDelayMs, (long)RescanIntervalMs << Math.Min(failures, 5));
                _backoff[pad.Path] = (failures, nowMs + delay);
                if (failures == 2) _log.Info($"{pad.Info.Name}: reading keeps failing (Windows error {pad.LastError}); retrying less often.");
            }
            else _backoff.Remove(pad.Path);
        }
        if (announced) sink.OnPadDisconnected(pad.Info);
    }

    private void LogProblemOnce(string path, string message)
    {
        if (_problemLogged.Add(path)) _log.Warn(message);
    }

    private void LogEnumerationProblem(string message)
    {
        if (_enumerationProblemLogged) return;
        _enumerationProblemLogged = true;
        _log.Warn($"PlayStation controllers can't be listed right now: {message}. Retrying every few seconds.");
    }

    /// <summary>Cancels every pending read and closes all handles (no events).</summary>
    public void Dispose()
    {
        foreach (var pad in _pads.Values)
        {
            try { pad.Dispose(); } catch { }
        }
        _pads.Clear();
    }

    /// <summary>One opened pad: its reader (which owns the handle) and what its reports mean.</summary>
    private sealed class Pad : IDisposable
    {
        public readonly string Path;
        public readonly OverlappedReader Reader;
        public readonly ControllerInfo Info;
        public readonly ControllerKind Kind;
        /// <summary>The device path says Bluetooth (the parser's hint for the DualSense report 0x01 layout).</summary>
        public readonly bool BluetoothPath;
        public readonly bool IsDongle;
        public readonly long OpenedAtMs;
        /// <summary>Cached callback for <see cref="OverlappedReader.Pump"/> (no allocation per poll).</summary>
        public ReportHandler Handler = static _ => { };
        public bool Announced;
        public int ValidChecksums;
        /// <summary>When the last accepted report arrived (the poll's clock), for the Bluetooth silence timeout.</summary>
        public long LastReportMs;
        public int LastError;

        public Pad(string path, OverlappedReader reader, ControllerInfo info, ControllerKind kind, bool bluetoothPath, bool dongle, long nowMs)
        {
            Path = path;
            Reader = reader;
            Info = info;
            Kind = kind;
            BluetoothPath = bluetoothPath;
            IsDongle = dongle;
            OpenedAtMs = nowMs;
        }

        public void Dispose() => Reader.Dispose();
    }

    // ---- Win32 ----

    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x1, FILE_SHARE_WRITE = 0x2;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OVERLAPPED = 0x40000000;
    private const uint DIGCF_PRESENT = 0x2, DIGCF_DEVICEINTERFACE = 0x10;
    private const int ERROR_ACCESS_DENIED = 5, ERROR_SHARING_VIOLATION = 32, ERROR_DEVICE_NOT_CONNECTED = 1167;
    private const int HIDP_STATUS_SUCCESS = 0x00110000;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVICE_INTERFACE_DATA
    {
        public uint cbSize;
        public Guid InterfaceClassGuid;
        public uint Flags;
        public IntPtr Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HIDD_ATTRIBUTES
    {
        public uint Size;
        public ushort VendorID;
        public ushort ProductID;
        public ushort VersionNumber;
    }

    /// <summary>HIDP_CAPS: the first five USHORTs are used; the rest (27 USHORTs) is covered by Size = 64.</summary>
    [StructLayout(LayoutKind.Sequential, Size = 64)]
    private struct HIDP_CAPS
    {
        public ushort Usage;
        public ushort UsagePage;
        public ushort InputReportByteLength;
        public ushort OutputReportByteLength;
        public ushort FeatureReportByteLength;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes,
        uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("hid.dll")]
    private static extern void HidD_GetHidGuid(out Guid hidGuid);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool HidD_GetAttributes(SafeFileHandle hidDeviceObject, ref HIDD_ATTRIBUTES attributes);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool HidD_GetPreparsedData(SafeFileHandle hidDeviceObject, out IntPtr preparsedData);

    [DllImport("hid.dll")]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool HidD_FreePreparsedData(IntPtr preparsedData);

    [DllImport("hid.dll")]
    private static extern int HidP_GetCaps(IntPtr preparsedData, out HIDP_CAPS capabilities);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool HidD_GetProductString(SafeFileHandle hidDeviceObject, byte* buffer, uint bufferLength);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool HidD_SetNumInputBuffers(SafeFileHandle hidDeviceObject, uint numberBuffers);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevsW(ref Guid classGuid, IntPtr enumerator, IntPtr hwndParent, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetupDiEnumDeviceInterfaces(IntPtr deviceInfoSet, IntPtr deviceInfoData, ref Guid interfaceClassGuid, uint memberIndex,
        ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr deviceInfoSet, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData,
        IntPtr deviceInterfaceDetailData, uint deviceInterfaceDetailDataSize, out uint requiredSize, IntPtr deviceInfoData);

    [DllImport("setupapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);
}
