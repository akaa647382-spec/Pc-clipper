using System.Runtime.InteropServices;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Monitor list that matches what ffmpeg will capture. <see cref="MonitorInfo.AdapterIndex"/> is the index ffmpeg's
/// <c>-init_hw_device d3d11va=dda:N</c> uses (CreateDXGIFactory1 -> EnumAdapters1(N), counting the software adapter even
/// though it is skipped here) and <see cref="MonitorInfo.OutputIndex"/> is ddagrab's <c>output_idx</c> (EnumOutputs on
/// that adapter). Raw COM through function pointers, no extra packages.
/// </summary>
/// <remarks>
/// <para>vtable slots (IUnknown 0-2, IDXGIObject 3-6): IDXGIFactory1.EnumAdapters1 = 12; IDXGIAdapter.EnumOutputs = 7;
/// IDXGIAdapter1.GetDesc1 = 10; IDXGIOutput.GetDesc = 7; IDXGIOutput6.GetDesc1 = 27. Struct sizes (x64):
/// DXGI_ADAPTER_DESC1 312, DXGI_OUTPUT_DESC 96, DXGI_OUTPUT_DESC1 152, DEVMODEW 220.</para>
/// <para>Sizes and positions are DXGI desktop coordinates, which are physical pixels in our per-monitor-DPI-aware process
/// (= what Desktop Duplication captures). The refresh rate comes from the active display path (exact, e.g. 119.88 Hz is
/// reported as 120) or else EnumDisplaySettings. The monitor model ("DELL U2723QE") comes from its EDID through
/// DisplayConfigGetDeviceInfo. HDR = IDXGIOutput6 colour space 12 (G2084/P2020).</para>
/// <para>Caveat: Windows' per-app GPU preference can reorder adapters for ffmpeg.exe vs. PC Clipper; ffmpeg logs
/// "Using device VVVV:DDDD" so a mismatch shows in the log.</para>
/// </remarks>
public static unsafe class DxgiMonitors
{
    private static readonly Guid IID_IDXGIFactory1 = new("770aae78-f26f-4dba-a829-253c83d1b387");
    private static readonly Guid IID_IDXGIOutput6 = new("068346e8-aaec-4b84-add7-137f513f77a1");
    private const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);
    private const uint DXGI_ADAPTER_FLAG_SOFTWARE = 2;
    private const int DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 = 12;

    private const int Slot_QueryInterface = 0, Slot_Release = 2;
    private const int Slot_Factory1_EnumAdapters1 = 12;
    private const int Slot_Adapter_EnumOutputs = 7, Slot_Adapter1_GetDesc1 = 10;
    private const int Slot_Output_GetDesc = 7, Slot_Output6_GetDesc1 = 27;

    /// <summary>One output before names are assigned.</summary>
    private sealed record Raw(int Adapter, int Output, string Device, Rectangle Bounds, uint Vendor, string AdapterName,
        IntPtr Monitor, bool Hdr, int RotationDegrees = 0);

    /// <summary>All monitors (DXGI adapters/outputs), primary first, with MonitorHandle (HMONITOR), IsHdr, rotation, Left/Top and refresh
    /// rate filled in. Falls back to Screen.AllScreens. Never empty, never throws.</summary>
    public static IReadOnlyList<MonitorInfo> Enumerate(ILog log)
    {
        var paths = new Dictionary<string, PathInfo>(StringComparer.OrdinalIgnoreCase);
        try { paths = QueryDisplayPaths(); }
        catch (Exception ex) { log.Info($"Display path query unavailable ({ex.Message}); monitor names will be generic."); }

        var raw = new List<Raw>();
        string source = "DXGI";
        try
        {
            raw = EnumerateDxgi();
        }
        catch (Exception ex)
        {
            log.Warn($"DXGI monitor enumeration failed ({ex.Message}); using the basic screen list.");
        }
        if (raw.Count == 0)
        {
            source = "screen list";
            try { raw = FromScreens(); }
            catch (Exception ex) { log.Warn("Screen list unavailable: " + ex.Message); }
        }

        var result = new List<MonitorInfo>();
        try
        {
            string? primaryName = null;
            try { primaryName = Screen.PrimaryScreen?.DeviceName; } catch { }
            bool IsPrimary(Raw r) => primaryName is not null
                ? string.Equals(Trim(primaryName), r.Device, StringComparison.OrdinalIgnoreCase)
                : r.Bounds.Left == 0 && r.Bounds.Top == 0;

            var ordered = raw
                .GroupBy(r => r.Device, StringComparer.OrdinalIgnoreCase).Select(g => g.First()) // a monitor once, first adapter wins
                .OrderByDescending(IsPrimary).ThenBy(r => r.Bounds.Left).ThenBy(r => r.Bounds.Top)
                .ToList();
            int n = 0;
            foreach (var r in ordered)
            {
                n++;
                paths.TryGetValue(r.Device, out var path);
                int hz = path?.RefreshHz ?? 0;
                if (hz <= 0) hz = RefreshFromDevMode(r.Device);
                string name = $"Monitor {n}" + (string.IsNullOrWhiteSpace(path?.MonitorName) ? "" : $" ({path!.MonitorName})");
                result.Add(new MonitorInfo(r.Adapter, r.Output, r.Device, name, r.Bounds.Width, r.Bounds.Height, hz, r.Vendor,
                    r.AdapterName, IsPrimary(r))
                {
                    Left = r.Bounds.Left,
                    Top = r.Bounds.Top,
                    MonitorHandle = r.Monitor.ToInt64(),
                    IsHdr = r.Hdr,
                    RotationDegrees = r.RotationDegrees,
                });
            }
        }
        catch (Exception ex)
        {
            log.Error("Building the monitor list failed", ex);
        }

        if (result.Count == 0)
            result.Add(new MonitorInfo(0, 0, @"\\.\DISPLAY1", "Main screen", 1920, 1080, 60, 0, "", true));

        foreach (var m in result)
        {
            log.Info($"Monitor ({source}): {m.FriendlyName} {m.DeviceName} {m.Width}x{m.Height} at ({m.Left},{m.Top}) {m.RefreshHz} Hz" +
                     $"{(m.IsPrimary ? " primary" : "")}{(m.IsHdr ? " HDR" : "")}{(m.RotationDegrees != 0 ? $" rotated {m.RotationDegrees}" : "")} - adapter {m.AdapterIndex} '{m.AdapterName}' " +
                     $"(vendor 0x{m.GpuVendorId:X4}) output {m.OutputIndex}");
        }
        return result;
    }

    /// <summary>The monitor with this device name, else the primary, else the first.</summary>
    public static MonitorInfo Pick(IReadOnlyList<MonitorInfo> monitors, string? deviceName)
    {
        if (monitors is null || monitors.Count == 0)
            return new MonitorInfo(0, 0, @"\\.\DISPLAY1", "Main screen", 1920, 1080, 60, 0, "", true);
        if (!string.IsNullOrEmpty(deviceName))
        {
            foreach (var m in monitors)
                if (string.Equals(m.DeviceName, deviceName, StringComparison.OrdinalIgnoreCase)) return m;
        }
        foreach (var m in monitors)
            if (m.IsPrimary) return m;
        return monitors[0];
    }

    // ---------------------------------------------------------------- DXGI

    private static List<Raw> EnumerateDxgi()
    {
        var result = new List<Raw>();
        Guid iid = IID_IDXGIFactory1;
        IntPtr factory;
        int hr = CreateDXGIFactory1(&iid, &factory);
        if (hr < 0) throw new COMException("CreateDXGIFactory1 failed", hr);
        try
        {
            for (uint a = 0; a < 64; a++)
            {
                IntPtr adapter;
                hr = ((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Slot(factory, Slot_Factory1_EnumAdapters1))(factory, a, &adapter);
                if (hr == DXGI_ERROR_NOT_FOUND) break;
                if (hr < 0) throw new COMException("EnumAdapters1 failed", hr);
                try
                {
                    DXGI_ADAPTER_DESC1 ad;
                    hr = ((delegate* unmanaged[Stdcall]<IntPtr, DXGI_ADAPTER_DESC1*, int>)Slot(adapter, Slot_Adapter1_GetDesc1))(adapter, &ad);
                    if (hr < 0 || (ad.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) continue; // index still counts (ffmpeg's N)
                    string adapterName = new string(ad.Description).Trim();

                    for (uint o = 0; o < 64; o++)
                    {
                        IntPtr output;
                        hr = ((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Slot(adapter, Slot_Adapter_EnumOutputs))(adapter, o, &output);
                        if (hr == DXGI_ERROR_NOT_FOUND) break;
                        if (hr < 0) break;
                        try
                        {
                            DXGI_OUTPUT_DESC od;
                            hr = ((delegate* unmanaged[Stdcall]<IntPtr, DXGI_OUTPUT_DESC*, int>)Slot(output, Slot_Output_GetDesc))(output, &od);
                            if (hr < 0 || od.AttachedToDesktop == 0) continue;
                            var r = od.DesktopCoordinates;
                            var bounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
                            if (bounds.Width <= 0 || bounds.Height <= 0) continue;
                            result.Add(new Raw((int)a, (int)o, Trim(new string(od.DeviceName)), bounds, ad.VendorId, adapterName,
                                od.Monitor, IsHdr(output), DegreesFromDxgiRotation(od.Rotation)));
                        }
                        finally { Release(output); }
                    }
                }
                finally { Release(adapter); }
            }
        }
        finally { Release(factory); }
        return result;
    }

    private static bool IsHdr(IntPtr output)
    {
        try
        {
            Guid iid = IID_IDXGIOutput6;
            IntPtr o6;
            if (((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Slot(output, Slot_QueryInterface))(output, &iid, &o6) < 0 || o6 == IntPtr.Zero)
                return false; // Windows before 1803
            try
            {
                DXGI_OUTPUT_DESC1 d1;
                return ((delegate* unmanaged[Stdcall]<IntPtr, DXGI_OUTPUT_DESC1*, int>)Slot(o6, Slot_Output6_GetDesc1))(o6, &d1) >= 0
                       && d1.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
            }
            finally { Release(o6); }
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>DXGI_MODE_ROTATION (1 identity, 2 = 90, 3 = 180, 4 = 270; 0 unspecified) in degrees.</summary>
    private static int DegreesFromDxgiRotation(int dxgiRotation) => dxgiRotation switch
    {
        2 => 90,
        3 => 180,
        4 => 270,
        _ => 0,
    };

    private static void* Slot(IntPtr com, int index) => (*(void***)com)[index];

    private static void Release(IntPtr com)
    {
        if (com != IntPtr.Zero) ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Slot(com, Slot_Release))(com);
    }

    private static string Trim(string s) => s.TrimEnd('\0').Trim();

    // ---------------------------------------------------------------- Screen.AllScreens fallback

    private static List<Raw> FromScreens()
    {
        var list = new List<Raw>();
        var screens = Screen.AllScreens;
        for (int i = 0; i < screens.Length; i++)
        {
            var s = screens[i];
            IntPtr hmon = IntPtr.Zero;
            try
            {
                var c = new POINT { X = s.Bounds.Left + s.Bounds.Width / 2, Y = s.Bounds.Top + s.Bounds.Height / 2 };
                hmon = MonitorFromPoint(c, MONITOR_DEFAULTTONEAREST);
            }
            catch (Exception) { }
            // Output index = order (best guess when DXGI is unavailable).
            list.Add(new Raw(0, i, Trim(s.DeviceName), s.Bounds, 0, "", hmon, false));
        }
        return list;
    }

    // ---------------------------------------------------------------- refresh rate

    private static readonly int[] CommonRates = { 24, 25, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 160, 165, 170, 175, 180, 200, 240, 280, 360, 480, 500, 540 };

    private static int RefreshFromDevMode(string deviceName)
    {
        try
        {
            var dm = new DEVMODEW { dmSize = (ushort)Marshal.SizeOf<DEVMODEW>() };
            if (EnumDisplaySettingsW(deviceName, ENUM_CURRENT_SETTINGS, ref dm))
            {
                int hz = (int)dm.dmDisplayFrequency;
                if (hz <= 1) return 60; // 0/1 = "hardware default"
                // 59/119/143 Hz are 59.94/119.88/143.98 truncated.
                if (Array.IndexOf(CommonRates, hz) < 0 && Array.IndexOf(CommonRates, hz + 1) >= 0) hz++;
                return hz;
            }
        }
        catch (Exception) { }
        return 60;
    }

    // ---------------------------------------------------------------- DisplayConfig: EDID names + exact refresh

    private sealed record PathInfo(string? MonitorName, int RefreshHz);

    private static Dictionary<string, PathInfo> QueryDisplayPaths()
    {
        var map = new Dictionary<string, PathInfo>(StringComparer.OrdinalIgnoreCase);
        DISPLAYCONFIG_PATH_INFO[] paths;
        uint numPaths, numModes;
        int err;
        int attempts = 0;
        do
        {
            err = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out numPaths, out numModes);
            if (err != 0) return map;
            paths = new DISPLAYCONFIG_PATH_INFO[numPaths];
            var modes = new DISPLAYCONFIG_MODE_INFO[numModes];
            err = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref numPaths, paths, ref numModes, modes, IntPtr.Zero);
        } while (err == ERROR_INSUFFICIENT_BUFFER && ++attempts < 5); // the layout changed between the two calls
        if (err != 0) return map;

        for (int i = 0; i < numPaths; i++)
        {
            var p = paths[i];
            var src = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
            src.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            src.header.size = (uint)sizeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME);
            src.header.adapterId = p.sourceInfo.adapterId;
            src.header.id = p.sourceInfo.id;
            if (DisplayConfigGetDeviceInfo(&src.header) != 0) continue;
            string gdiName = Trim(new string(src.viewGdiDeviceName));
            if (gdiName.Length == 0 || map.ContainsKey(gdiName)) continue; // clones: first target wins

            string? monitorName = null;
            var tgt = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
            tgt.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            tgt.header.size = (uint)sizeof(DISPLAYCONFIG_TARGET_DEVICE_NAME);
            tgt.header.adapterId = p.targetInfo.adapterId;
            tgt.header.id = p.targetInfo.id;
            if (DisplayConfigGetDeviceInfo(&tgt.header) == 0)
            {
                monitorName = Trim(new string(tgt.monitorFriendlyDeviceName));
                if (monitorName.Length == 0 && IsInternal(tgt.outputTechnology)) monitorName = "built-in screen";
            }

            int hz = 0;
            var rr = p.targetInfo.refreshRate;
            if (rr.Denominator != 0 && rr.Numerator != 0) hz = (int)Math.Round(rr.Numerator / (double)rr.Denominator);
            map[gdiName] = new PathInfo(string.IsNullOrWhiteSpace(monitorName) ? null : monitorName, hz);
        }
        return map;
    }

    private static bool IsInternal(int tech) =>
        tech == unchecked((int)0x80000000) /* INTERNAL */ || tech == 11 /* DISPLAYPORT_EMBEDDED */ || tech == 13 /* UDI_EMBEDDED */;

    // ---------------------------------------------------------------- interop

    [StructLayout(LayoutKind.Sequential)] private struct LUID { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_ADAPTER_DESC1 // 312 bytes on x64
    {
        public fixed char Description[128];
        public uint VendorId, DeviceId, SubSysId, Revision;
        public nuint DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public LUID AdapterLuid;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTPUT_DESC // 96 bytes on x64
    {
        public fixed char DeviceName[32];
        public RECT DesktopCoordinates;
        public int AttachedToDesktop;
        public int Rotation;
        public IntPtr Monitor;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTPUT_DESC1 // 152 bytes on x64
    {
        public fixed char DeviceName[32];
        public RECT DesktopCoordinates;
        public int AttachedToDesktop;
        public int Rotation;
        public IntPtr Monitor;
        public uint BitsPerColor;
        public int ColorSpace;
        public fixed float Primaries[8];
        public float MinLuminance, MaxLuminance, MaxFullFrameLuminance;
    }

    private const int ENUM_CURRENT_SETTINGS = -1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DEVMODEW // 220 bytes
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public uint dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    private const uint QDC_ONLY_ACTIVE_PATHS = 0x2;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;
    private const int DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME = 1;
    private const int DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME = 2;

    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_RATIONAL { public uint Numerator, Denominator; }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_SOURCE_INFO // 20 bytes
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public uint statusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_TARGET_INFO // 48 bytes
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public int outputTechnology;
        public int rotation;
        public int scaling;
        public DISPLAYCONFIG_RATIONAL refreshRate;
        public int scanLineOrdering;
        public int targetAvailable;
        public uint statusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_INFO // 72 bytes
    {
        public DISPLAYCONFIG_PATH_SOURCE_INFO sourceInfo;
        public DISPLAYCONFIG_PATH_TARGET_INFO targetInfo;
        public uint flags;
    }

    /// <summary>Only the size matters here (the union is not read).</summary>
    [StructLayout(LayoutKind.Sequential, Size = 64)]
    private struct DISPLAYCONFIG_MODE_INFO
    {
        public int infoType;
        public uint id;
        public LUID adapterId;
        public ulong unionStart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_DEVICE_INFO_HEADER // 20 bytes
    {
        public int type;
        public uint size;
        public LUID adapterId;
        public uint id;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_SOURCE_DEVICE_NAME // 84 bytes
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public fixed char viewGdiDeviceName[32];
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_TARGET_DEVICE_NAME // 420 bytes
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public uint flags;
        public int outputTechnology;
        public ushort edidManufactureId;
        public ushort edidProductCodeId;
        public uint connectorInstance;
        public fixed char monitorFriendlyDeviceName[64];
        public fixed char monitorDevicePath[128];
    }

    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("dxgi.dll")]
    private static extern int CreateDXGIFactory1(Guid* riid, IntPtr* ppFactory);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplaySettingsW(string deviceName, int modeNum, ref DEVMODEW devMode);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] DISPLAYCONFIG_PATH_INFO[] pathArray,
        ref uint numModeInfoArrayElements, [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray, IntPtr currentTopologyId);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(DISPLAYCONFIG_DEVICE_INFO_HEADER* requestPacket);

    /// <summary>Struct sizes, for a test on Windows (must be 312, 96, 152, 220, 72, 64, 84, 420).</summary>
    internal static int[] StructSizesForTest() => new[]
    {
        sizeof(DXGI_ADAPTER_DESC1), sizeof(DXGI_OUTPUT_DESC), sizeof(DXGI_OUTPUT_DESC1), Marshal.SizeOf<DEVMODEW>(),
        sizeof(DISPLAYCONFIG_PATH_INFO), sizeof(DISPLAYCONFIG_MODE_INFO), sizeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME),
        sizeof(DISPLAYCONFIG_TARGET_DEVICE_NAME),
    };
}
