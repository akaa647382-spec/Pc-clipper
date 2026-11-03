using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Reads the buttons out of one raw HID input report of a Sony pad (DualShock 4, DualSense, DualSense Edge), plus the
/// small device facts the reader needs (which kind a product id is, Bluetooth or not, report checksum). Pure: no I/O,
/// no state, so it is unit-checked on Linux with hand-built reports.
/// </summary>
/// <remarks>
/// <para>Offsets count the report id at [0], exactly as Windows' ReadFile returns a report. Windows pads every report to
/// the collection's InputReportByteLength (that is why a 10-byte Bluetooth "simple" report arrives as 78 bytes from a
/// DualSense). Verified against Linux drivers/hid/hid-playstation.c (dualshock4_parse_report, dualsense_parse_report)
/// and SDL src/joystick/hidapi/SDL_hidapi_ps4.c / SDL_hidapi_ps5.c (UpdateDevice, HandleStatePacket, HandleSimpleStatePacket):</para>
/// <code>
/// pad        report             length (Windows)  L2,R2 analog  buttons[0..2]  notes
/// DS4        0x01 USB full      64                [8],[9]       [5],[6],[7]    also the dongle (0x0BA0); [31] bit 2 = no pad behind the dongle
/// DS4        0x01 BT simple     10 (padded)       [8],[9]       [5],[6],[7]    same start as USB: the pad's default mode over Bluetooth
/// DS4        0x11..0x19 BT full 78+               [10],[11]     [7],[8],[9]    [1] bit 7 = report carries HID data; CRC-32 in [74..77]
/// DualSense  0x01 USB full      64                [5],[6]       [8],[9],[10]   [7] is a sequence counter
/// DualSense  0x01 BT simple     10 / 78           [8],[9]       [5],[6],[7]    DS4-style layout; no mute bit
/// DualSense  0x31 BT full       78                [6],[7]       [9],[10],[11]  CRC-32 in [74..77]
/// </code>
/// <para>buttons[0]: bits 0-3 hat (0 up, 1 up-right, 2 right, 3 down-right, 4 down, 5 down-left, 6 left, 7 up-left,
/// 8-15 centred), bit 4 Square, 5 Cross, 6 Circle, 7 Triangle. buttons[1]: bit 0 L1, 1 R1, 2 L2, 3 R2, 4 Share/Create,
/// 5 Options, 6 L3, 7 R3. buttons[2]: bit 0 PS, 1 touchpad click, 2 mic mute (DualSense full reports only; on the DS4
/// and in simple reports bits 2-7 are a frame counter).</para>
/// <para>L2/R2 count as pressed past half way (analog &gt; 128), like the Xbox triggers. The digital L2/R2 bits are only
/// used when the analog value is 0, which is how some fight sticks report a digital-only trigger (SDL does the same).</para>
/// </remarks>
public static class SonyReportParser
{
    public const ushort SonyVendorId = 0x054C;
    public const ushort PidDualShock4 = 0x05C4;
    public const ushort PidDualShock4V2 = 0x09CC;
    public const ushort PidDualShock4Dongle = 0x0BA0;
    public const ushort PidDualSense = 0x0CE6;
    public const ushort PidDualSenseEdge = 0x0DF2;

    /// <summary>Size of the Bluetooth "full" reports (DS4 0x11, DualSense 0x31), checksum included.</summary>
    public const int BluetoothFullLength = 78;

    /// <summary>The Bluetooth HID service class GUID that the Microsoft Bluetooth stack puts into a pad's device path.</summary>
    private const string BluetoothHidServiceGuid = "{00001124-0000-1000-8000-00805f9b34fb}";
    /// <summary>HID over GATT (Bluetooth LE); not used by these pads today, listed so such a path still reads as Bluetooth.</summary>
    private const string BluetoothLeHidServiceGuid = "{00001812-0000-1000-8000-00805f9b34fb}";

    /// <summary>The controller family for a Sony product id, or null if it isn't a supported pad.</summary>
    public static ControllerKind? KindFor(ushort vendorId, ushort productId)
    {
        if (vendorId != SonyVendorId) return null;
        return productId switch
        {
            PidDualShock4 or PidDualShock4V2 or PidDualShock4Dongle => ControllerKind.PlayStation4,
            PidDualSense or PidDualSenseEdge => ControllerKind.PlayStation5,
            _ => null,
        };
    }

    /// <summary>Display name when the device has no useful product string.</summary>
    public static string DefaultName(ushort productId) => productId switch
    {
        PidDualShock4Dongle => "DualShock 4 USB Wireless Adapter",
        PidDualSense => "DualSense Wireless Controller",
        PidDualSenseEdge => "DualSense Edge Wireless Controller",
        _ => "DualShock 4 Wireless Controller",
    };

    /// <summary>
    /// The name to show: the device's product string, unless it is empty or the DS4's generic "Wireless Controller"
    /// (which says nothing), then <see cref="DefaultName"/>. Control characters are removed; at most 64 characters.
    /// </summary>
    public static string DisplayName(string? productString, ushort productId)
    {
        var s = new string((productString ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (s.Length > 64) s = s[..64].TrimEnd();
        if (s.Length == 0 || s.Equals("Wireless Controller", StringComparison.OrdinalIgnoreCase)) return DefaultName(productId);
        return s;
    }

    /// <summary>True if the HID device path is a Bluetooth one (the Bluetooth HID service GUID is part of it).</summary>
    public static bool IsBluetoothPath(string? devicePath) =>
        devicePath is not null &&
        (devicePath.Contains(BluetoothHidServiceGuid, StringComparison.OrdinalIgnoreCase) ||
         devicePath.Contains(BluetoothLeHidServiceGuid, StringComparison.OrdinalIgnoreCase));

    /// <inheritdoc cref="Parse(ReadOnlySpan{byte}, ControllerKind, bool)"/>
    public static PadButtons? Parse(byte[] report, int length, ControllerKind kind, bool bluetooth)
    {
        if (report is null || length <= 0) return null;
        return Parse(report.AsSpan(0, Math.Min(length, report.Length)), kind, bluetooth);
    }

    /// <summary>
    /// The pressed buttons in <paramref name="report"/> (report id first), or null if it isn't a state report this
    /// parser knows (other report ids, too short, a Bluetooth report without HID data). <paramref name="bluetooth"/> is
    /// the connection as far as the device path tells; it only matters for the DualSense's report 0x01, which has a
    /// different layout over USB and Bluetooth (the length decides when the hint is missing).
    /// Doesn't check the Bluetooth checksum: see <see cref="BluetoothChecksumOk"/>.
    /// </summary>
    public static PadButtons? Parse(ReadOnlySpan<byte> report, ControllerKind kind, bool bluetooth)
    {
        if (report.Length < 10) return null;
        byte id = report[0];
        switch (kind)
        {
            case ControllerKind.PlayStation4:
                if (id == 0x01) return Decode(report, buttons: 5, triggers: 8, hasMute: false);
                if (id >= 0x11 && id <= 0x19)
                {
                    if (report.Length < 12 || (report[1] & 0x80) == 0) return null; // no HID data in this one (audio etc.)
                    return Decode(report, buttons: 7, triggers: 10, hasMute: false);
                }
                return null;

            case ControllerKind.PlayStation5:
                if (id == 0x01)
                {
                    // SDL: "if (size == 10 || size == 78) simple report". Over USB the full report is exactly 64 bytes.
                    if (bluetooth || report.Length == 10 || report.Length == BluetoothFullLength)
                        return Decode(report, buttons: 5, triggers: 8, hasMute: false);
                    if (report.Length < 11) return null;
                    return Decode(report, buttons: 8, triggers: 5, hasMute: true);
                }
                if (id == 0x31)
                {
                    if (report.Length < 12) return null;
                    return Decode(report, buttons: 9, triggers: 6, hasMute: true);
                }
                return null;

            default:
                return null;
        }
    }

    /// <summary>
    /// True for the 78-byte Bluetooth full state reports (DS4 0x11, DualSense 0x31) whose CRC-32 sits in [74..77].
    /// The DS4's longer 0x12..0x19 reports (state plus audio) have it at their own end and aren't checked.
    /// </summary>
    public static bool HasBluetoothChecksum(ReadOnlySpan<byte> report, ControllerKind kind) =>
        report.Length >= BluetoothFullLength &&
        (kind == ControllerKind.PlayStation5 ? report[0] == 0x31 : kind == ControllerKind.PlayStation4 && report[0] == 0x11);

    /// <summary>
    /// Checks the CRC-32 of a 78-byte Bluetooth full report: CRC-32 (IEEE, as zlib) over the HID transaction header 0xA1
    /// followed by bytes [0..73], stored little-endian in [74..77] (kernel ps_check_crc32 with PS_INPUT_CRC32_SEED,
    /// SDL VerifyCRC).
    /// </summary>
    public static bool BluetoothChecksumOk(ReadOnlySpan<byte> report)
    {
        if (report.Length < BluetoothFullLength) return false;
        uint crc = Crc32Update(0xFFFFFFFFu, stackalloc byte[] { 0xA1 });
        crc = ~Crc32Update(crc, report[..(BluetoothFullLength - 4)]);
        uint stored = report[74] | (uint)report[75] << 8 | (uint)report[76] << 16 | (uint)report[77] << 24;
        return crc == stored;
    }

    /// <summary>
    /// For the DualShock 4 USB wireless adapter: whether a pad is paired and on behind it (report 0x01, status byte [31]
    /// bit 2 is 0 = connected), or null if this report doesn't say.
    /// </summary>
    public static bool? DongleHasController(ReadOnlySpan<byte> report)
    {
        if (report.Length < 32 || report[0] != 0x01) return null;
        return (report[31] & 0x04) == 0;
    }

    private static PadButtons Decode(ReadOnlySpan<byte> r, int buttons, int triggers, bool hasMute)
    {
        byte b0 = r[buttons], b1 = r[buttons + 1], b2 = r[buttons + 2];
        byte l2 = r[triggers], r2 = r[triggers + 1];
        var p = PadButtons.None;

        p |= (b0 & 0x0F) switch
        {
            0 => PadButtons.DpadUp,
            1 => PadButtons.DpadUp | PadButtons.DpadRight,
            2 => PadButtons.DpadRight,
            3 => PadButtons.DpadDown | PadButtons.DpadRight,
            4 => PadButtons.DpadDown,
            5 => PadButtons.DpadDown | PadButtons.DpadLeft,
            6 => PadButtons.DpadLeft,
            7 => PadButtons.DpadUp | PadButtons.DpadLeft,
            _ => PadButtons.None, // 8 = centred
        };
        if ((b0 & 0x10) != 0) p |= PadButtons.X;  // Square
        if ((b0 & 0x20) != 0) p |= PadButtons.A;  // Cross
        if ((b0 & 0x40) != 0) p |= PadButtons.B;  // Circle
        if ((b0 & 0x80) != 0) p |= PadButtons.Y;  // Triangle

        if ((b1 & 0x01) != 0) p |= PadButtons.LeftBumper;   // L1
        if ((b1 & 0x02) != 0) p |= PadButtons.RightBumper;  // R1
        if (l2 > 128 || (l2 == 0 && (b1 & 0x04) != 0)) p |= PadButtons.LeftTrigger;   // L2
        if (r2 > 128 || (r2 == 0 && (b1 & 0x08) != 0)) p |= PadButtons.RightTrigger;  // R2
        if ((b1 & 0x10) != 0) p |= PadButtons.View;         // Share (DS4) / Create (DualSense)
        if ((b1 & 0x20) != 0) p |= PadButtons.Menu;         // Options
        if ((b1 & 0x40) != 0) p |= PadButtons.LeftStick;    // L3
        if ((b1 & 0x80) != 0) p |= PadButtons.RightStick;   // R3

        if ((b2 & 0x01) != 0) p |= PadButtons.Guide;        // PS
        if ((b2 & 0x02) != 0) p |= PadButtons.Touchpad;     // touchpad click
        if (hasMute && (b2 & 0x04) != 0) p |= PadButtons.Mute;
        return p;
    }

    private static readonly uint[] s_crcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    /// <summary>Reflected CRC-32 (polynomial 0xEDB88320) without the final inversion, so it can be chained.</summary>
    private static uint Crc32Update(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (byte b in data) crc = s_crcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc;
    }
}
