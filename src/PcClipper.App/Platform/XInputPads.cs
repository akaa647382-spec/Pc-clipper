using System.Runtime.InteropServices;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Xbox and other XInput pads (Xbox 360/One/Series, most third-party PC pads, and PlayStation pads that DS4Windows or
/// similar tools turn into a virtual Xbox pad) for <see cref="ControllerManager"/>. Used only on its polling thread.
/// </summary>
/// <remarks>
/// <para>The DLL is loaded at run time from System32: xinput1_4.dll (Windows 8+), else xinput1_3.dll (DirectX
/// redistributable), else xinput9_1_0.dll. XInput doesn't care which window has focus, so it keeps working while a game
/// is in front (unlike Windows.Gaming.Input).</para>
/// <para>XInputGetState on an empty slot is slow (it looks for new devices every call, up to milliseconds), so empty
/// slots are only asked every 2 s, staggered; connected slots at every poll. The Guide (Xbox) button is only reported
/// by the undocumented XInputGetStateEx (ordinal 100 in xinput1_4/xinput1_3, same struct plus 4 bytes); if that export
/// is missing the Guide button simply never shows as pressed.</para>
/// <para>Rumble: XInputSetState with both motors at ~25000 of 65535, stopped by a later poll. A game that rumbles at the
/// same time shares the motors with us for that moment; the stop sets 0, which a game overrides with its next update.</para>
/// </remarks>
internal sealed unsafe class XInputPads : IDisposable
{
    private const uint ERROR_SUCCESS = 0;
    private const uint ERROR_DEVICE_NOT_CONNECTED = 1167;
    private const int Slots = 4; // XUSER_MAX_COUNT
    private const int EmptySlotIntervalMs = 2000;
    private const ushort RumbleStrength = 25000;
    private const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;

    // XINPUT_GAMEPAD wButtons.
    private const ushort DPAD_UP = 0x0001, DPAD_DOWN = 0x0002, DPAD_LEFT = 0x0004, DPAD_RIGHT = 0x0008;
    private const ushort START = 0x0010, BACK = 0x0020, LEFT_THUMB = 0x0040, RIGHT_THUMB = 0x0080;
    private const ushort LEFT_SHOULDER = 0x0100, RIGHT_SHOULDER = 0x0200, GUIDE = 0x0400; // GUIDE: XInputGetStateEx only
    private const ushort BUTTON_A = 0x1000, BUTTON_B = 0x2000, BUTTON_X = 0x4000, BUTTON_Y = 0x8000;
    private const byte TriggerHalfWay = 128;

    private readonly ILog _log;
    private readonly delegate* unmanaged<uint, XInputState*, uint> _getState;
    private readonly delegate* unmanaged<uint, XInputVibration*, uint> _setState;
    private readonly ControllerInfo?[] _pads = new ControllerInfo?[Slots];
    private readonly long[] _nextEmptyPoll = new long[Slots];
    private readonly long[] _rumbleUntil = new long[Slots]; // 0 = motors off
    private readonly bool[] _oddErrorLogged = new bool[Slots];
    private bool _firstRound = true;

    /// <summary>"xinput1_4.dll" etc., for the log.</summary>
    public string DllName { get; }
    public bool HasGuideButton { get; }

    private XInputPads(ILog log, string dll, IntPtr getState, bool guide, IntPtr setState)
    {
        _log = log;
        DllName = dll;
        HasGuideButton = guide;
        _getState = (delegate* unmanaged<uint, XInputState*, uint>)getState;
        _setState = (delegate* unmanaged<uint, XInputVibration*, uint>)setState;
    }

    /// <summary>Loads XInput, or returns null (logged) if no XInput DLL can be used. Never throws.</summary>
    public static XInputPads? TryLoad(ILog log)
    {
        foreach (var dll in new[] { "xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll" })
        {
            try
            {
                IntPtr module = LoadLibraryExW(dll, IntPtr.Zero, LOAD_LIBRARY_SEARCH_SYSTEM32);
                if (module == IntPtr.Zero) continue;
                IntPtr plain = GetProcAddress(module, "XInputGetState");
                IntPtr ex = dll == "xinput9_1_0.dll" ? IntPtr.Zero : GetProcAddressOrdinal(module, (IntPtr)100);
                IntPtr set = GetProcAddress(module, "XInputSetState");
                if (plain == IntPtr.Zero && ex == IntPtr.Zero) continue; // not a usable XInput (never FreeLibrary'd: harmless)
                var pads = new XInputPads(log, dll, ex != IntPtr.Zero ? ex : plain, ex != IntPtr.Zero, set);
                log.Info($"XInput: {dll} loaded (Xbox button {(pads.HasGuideButton ? "readable" : "not readable")}).");
                return pads;
            }
            catch (Exception ex)
            {
                log.Warn($"XInput: loading {dll} failed: {ex.Message}");
            }
        }
        log.Warn("XInput isn't available (no xinput1_4/xinput1_3/xinput9_1_0.dll), so Xbox controllers won't be detected.");
        return null;
    }

    /// <summary>Reads every slot that is due; reports connects, disconnects and buttons to <paramref name="sink"/>.</summary>
    public void Poll(long nowMs, IPadSink sink)
    {
        for (int slot = 0; slot < Slots; slot++)
        {
            var pad = _pads[slot];
            if (pad is null && nowMs < _nextEmptyPoll[slot]) continue;

            XInputState state = default;
            uint result = _getState((uint)slot, &state);
            if (result == ERROR_SUCCESS)
            {
                if (pad is null)
                {
                    pad = new ControllerInfo($"xinput:{slot}", ControllerKind.Xbox, "Xbox controller", $"Player {slot + 1}");
                    _pads[slot] = pad;
                    sink.OnPadConnected(pad);
                }
                sink.OnPadState(pad, Map(in state));
                if (_rumbleUntil[slot] != 0 && nowMs >= _rumbleUntil[slot]) SetMotors(slot, 0);
                continue;
            }

            if (result != ERROR_DEVICE_NOT_CONNECTED && !_oddErrorLogged[slot])
            {
                _oddErrorLogged[slot] = true;
                _log.Warn($"XInput: slot {slot + 1} returned error {result}; treating it as empty.");
            }
            if (pad is not null)
            {
                _pads[slot] = null;
                _rumbleUntil[slot] = 0;
                sink.OnPadDisconnected(pad);
            }
            // Spread the slow empty-slot calls over the 2 s (one slot every 500 ms) instead of all four in one poll.
            _nextEmptyPoll[slot] = nowMs + EmptySlotIntervalMs + (_firstRound ? slot * (EmptySlotIntervalMs / Slots) : 0);
        }
        _firstRound = false;
    }

    /// <summary>Rumbles the pad in <paramref name="slot"/> for <paramref name="milliseconds"/> (stopped by <see cref="Poll"/>).</summary>
    public void StartRumble(int slot, int milliseconds, long nowMs)
    {
        if (slot < 0 || slot >= Slots || _pads[slot] is null || _setState == null) return;
        if (SetMotors(slot, RumbleStrength)) _rumbleUntil[slot] = nowMs + Math.Max(1, milliseconds);
    }

    private bool SetMotors(int slot, ushort strength)
    {
        _rumbleUntil[slot] = 0;
        if (_setState == null) return false;
        var v = new XInputVibration { LeftMotorSpeed = strength, RightMotorSpeed = strength };
        return _setState((uint)slot, &v) == ERROR_SUCCESS;
    }

    internal static PadButtons Map(in XInputState s)
    {
        ushort w = s.Buttons;
        var p = PadButtons.None;
        if ((w & DPAD_UP) != 0) p |= PadButtons.DpadUp;
        if ((w & DPAD_DOWN) != 0) p |= PadButtons.DpadDown;
        if ((w & DPAD_LEFT) != 0) p |= PadButtons.DpadLeft;
        if ((w & DPAD_RIGHT) != 0) p |= PadButtons.DpadRight;
        if ((w & START) != 0) p |= PadButtons.Menu;
        if ((w & BACK) != 0) p |= PadButtons.View;
        if ((w & LEFT_THUMB) != 0) p |= PadButtons.LeftStick;
        if ((w & RIGHT_THUMB) != 0) p |= PadButtons.RightStick;
        if ((w & LEFT_SHOULDER) != 0) p |= PadButtons.LeftBumper;
        if ((w & RIGHT_SHOULDER) != 0) p |= PadButtons.RightBumper;
        if ((w & GUIDE) != 0) p |= PadButtons.Guide;
        if ((w & BUTTON_A) != 0) p |= PadButtons.A;
        if ((w & BUTTON_B) != 0) p |= PadButtons.B;
        if ((w & BUTTON_X) != 0) p |= PadButtons.X;
        if ((w & BUTTON_Y) != 0) p |= PadButtons.Y;
        if (s.LeftTrigger > TriggerHalfWay) p |= PadButtons.LeftTrigger;
        if (s.RightTrigger > TriggerHalfWay) p |= PadButtons.RightTrigger;
        return p;
    }

    /// <summary>Stops any rumble we started. The DLL stays loaded (it's a system DLL; unloading gains nothing).</summary>
    public void Dispose()
    {
        for (int slot = 0; slot < Slots; slot++)
        {
            if (_rumbleUntil[slot] == 0) continue;
            try { SetMotors(slot, 0); } catch { }
        }
    }

    /// <summary>XINPUT_STATE (16 bytes) plus room for XInputGetStateEx's extra DWORD and some slack.</summary>
    [StructLayout(LayoutKind.Sequential, Size = 32)]
    internal struct XInputState
    {
        public uint PacketNumber;
        public ushort Buttons;
        public byte LeftTrigger;
        public byte RightTrigger;
        public short ThumbLX, ThumbLY, ThumbRX, ThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct XInputVibration
    {
        public ushort LeftMotorSpeed;
        public ushort RightMotorSpeed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr LoadLibraryExW(string lpLibFileName, IntPtr hFile, uint dwFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

    /// <summary>GetProcAddress with an ordinal (MAKEINTRESOURCE) instead of a name.</summary>
    [DllImport("kernel32.dll", EntryPoint = "GetProcAddress", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetProcAddressOrdinal(IntPtr hModule, IntPtr ordinal);
}
