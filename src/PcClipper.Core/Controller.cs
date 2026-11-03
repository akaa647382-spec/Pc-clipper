namespace PcClipper.Core;

/// <summary>Controller buttons in one layout for every pad (Xbox names; PlayStation equivalents in <see cref="PadLabels"/>).</summary>
[Flags]
public enum PadButtons : uint
{
    None = 0,
    A = 1 << 0,            // PlayStation: Cross
    B = 1 << 1,            // Circle
    X = 1 << 2,            // Square
    Y = 1 << 3,            // Triangle
    LeftBumper = 1 << 4,   // L1
    RightBumper = 1 << 5,  // R1
    LeftTrigger = 1 << 6,  // L2 (pressed past half way)
    RightTrigger = 1 << 7, // R2
    View = 1 << 8,         // Share (PS4) / Create (PS5)
    Menu = 1 << 9,         // Options
    LeftStick = 1 << 10,   // L3
    RightStick = 1 << 11,  // R3
    DpadUp = 1 << 12,
    DpadDown = 1 << 13,
    DpadLeft = 1 << 14,
    DpadRight = 1 << 15,
    Guide = 1 << 16,       // Xbox button / PS button
    Touchpad = 1 << 17,    // PlayStation touchpad click
    Mute = 1 << 18,        // DualSense mic button
}

public enum ControllerKind
{
    Xbox,
    PlayStation4,
    PlayStation5,
}

/// <summary>A connected controller. <see cref="Id"/> is stable while it stays connected.</summary>
public sealed record ControllerInfo(string Id, ControllerKind Kind, string Name, string Connection)
{
    public bool IsPlayStation => Kind is ControllerKind.PlayStation4 or ControllerKind.PlayStation5;
    public override string ToString() => $"{Name} ({Connection})";
}

/// <summary>
/// A controller shortcut: hold <see cref="Hold"/> (or nothing) and press <see cref="Press"/>.
/// Press = None means the shortcut is off.
/// </summary>
public sealed class PadChord
{
    public PadButtons Hold { get; set; }
    public PadButtons Press { get; set; }

    public bool IsAssigned => Press != PadButtons.None;
    public PadChord Clone() => new() { Hold = Hold, Press = Press };
    public bool SameAs(PadChord? o) => o is not null && o.Hold == Hold && o.Press == Press;
    public static PadChord Of(PadButtons hold, PadButtons press) => new() { Hold = hold, Press = press };
    public static PadChord Off => new();

    /// <summary>Shortcut choices offered in Settings (hold the Share/View button, or a shoulder, plus a face button).</summary>
    public static IReadOnlyList<PadChord> Presets { get; } = new[]
    {
        Off,
        Of(PadButtons.View, PadButtons.A), Of(PadButtons.View, PadButtons.B), Of(PadButtons.View, PadButtons.X), Of(PadButtons.View, PadButtons.Y),
        Of(PadButtons.View, PadButtons.DpadUp), Of(PadButtons.View, PadButtons.DpadDown),
        Of(PadButtons.View, PadButtons.DpadLeft), Of(PadButtons.View, PadButtons.DpadRight),
        Of(PadButtons.View, PadButtons.Menu),
        Of(PadButtons.LeftBumper | PadButtons.RightBumper, PadButtons.A),
        Of(PadButtons.LeftStick, PadButtons.RightStick),
        // No Xbox/PS-button combos: Windows Game Bar and Steam react to that button and would pull focus from the game.
    };
}

/// <summary>Button names as each controller family prints them.</summary>
public static class PadLabels
{
    public static string Name(PadButtons button, bool playStation) => button switch
    {
        PadButtons.A => playStation ? "Cross" : "A",
        PadButtons.B => playStation ? "Circle" : "B",
        PadButtons.X => playStation ? "Square" : "X",
        PadButtons.Y => playStation ? "Triangle" : "Y",
        PadButtons.LeftBumper => playStation ? "L1" : "LB",
        PadButtons.RightBumper => playStation ? "R1" : "RB",
        PadButtons.LeftTrigger => playStation ? "L2" : "LT",
        PadButtons.RightTrigger => playStation ? "R2" : "RT",
        PadButtons.View => playStation ? "Create/Share" : "View",
        PadButtons.Menu => playStation ? "Options" : "Menu",
        PadButtons.LeftStick => playStation ? "L3" : "Left stick click",
        PadButtons.RightStick => playStation ? "R3" : "Right stick click",
        PadButtons.DpadUp => "D-pad up",
        PadButtons.DpadDown => "D-pad down",
        PadButtons.DpadLeft => "D-pad left",
        PadButtons.DpadRight => "D-pad right",
        PadButtons.Guide => playStation ? "PS button" : "Xbox button",
        PadButtons.Touchpad => "Touchpad",
        PadButtons.Mute => "Mute",
        _ => button.ToString(),
    };

    /// <summary>All pressed buttons, e.g. "Create/Share + Cross".</summary>
    public static string Combo(PadButtons buttons, bool playStation)
    {
        var parts = Enum.GetValues<PadButtons>().Where(b => b != PadButtons.None && buttons.HasFlag(b)).Select(b => Name(b, playStation));
        var text = string.Join(" + ", parts);
        return text.Length == 0 ? "Nothing pressed" : text;
    }

    /// <summary>"Hold View + press A" / "Hold Create/Share + press Cross" / "Off".</summary>
    public static string Describe(PadChord chord, bool playStation)
    {
        if (!chord.IsAssigned) return "Off";
        var press = Name(chord.Press, playStation);
        if (chord.Hold == PadButtons.None) return $"Press {press}";
        return $"Hold {Combo(chord.Hold, playStation)} + press {press}";
    }

    /// <summary>Both namings in one, for settings shared by both families: "View/Create + A/Cross".</summary>
    public static string DescribeBoth(PadChord chord)
    {
        if (!chord.IsAssigned) return "Off";
        string Both(PadButtons b)
        {
            var x = Combo(b, false);
            var p = Combo(b, true);
            return x == p ? x : $"{x} / {p}";
        }
        var press = Both(chord.Press);
        return chord.Hold == PadButtons.None ? press : $"{Both(chord.Hold)} + {press}";
    }
}

public enum PadAction { SaveReplay, ToggleRecording, Screenshot, ToggleReplay }

/// <summary>
/// Turns raw controller states into shortcut actions. A chord fires once when its Press button goes down while all of
/// its Hold buttons are already down (holding the combo doesn't repeat). Each controller is tracked separately.
/// Pure logic: the platform layer feeds it states, the app acts on what it returns.
/// </summary>
public sealed class ChordDetector
{
    private readonly Dictionary<string, PadButtons> _last = new();
    private readonly Dictionary<PadAction, long> _lastFired = new();
    private IReadOnlyDictionary<PadAction, PadChord> _bindings = new Dictionary<PadAction, PadChord>();

    /// <summary>The same action can't fire again within this time (bouncy buttons, two pads pressed together).</summary>
    public int RepeatGuardMs { get; set; } = 800;

    public void SetBindings(IReadOnlyDictionary<PadAction, PadChord> bindings) => _bindings = bindings;

    /// <summary>Forget a controller (disconnected), so a reconnect doesn't see stale "held" buttons.</summary>
    public void Forget(string controllerId) => _last.Remove(controllerId);

    /// <summary>Feed the current buttons of one controller; returns the actions triggered by this change.</summary>
    public IReadOnlyList<PadAction> Update(string controllerId, PadButtons buttons, long nowMs)
    {
        var previous = _last.TryGetValue(controllerId, out var p) ? p : PadButtons.None;
        _last[controllerId] = buttons;
        var newlyDown = buttons & ~previous;
        if (newlyDown == PadButtons.None) return Array.Empty<PadAction>();

        List<PadAction>? fired = null;
        // Longest Hold first, so "LB+RB + A" wins over a plain "A" chord if both were configured.
        foreach (var (action, chord) in _bindings.OrderByDescending(kv => BitCount(kv.Value.Hold)))
        {
            if (!chord.IsAssigned || (newlyDown & chord.Press) == PadButtons.None) continue;
            // Hold buttons must have been down before Press (pressing both in the same instant also counts).
            if ((buttons & chord.Hold) != chord.Hold) continue;
            if (_lastFired.TryGetValue(action, out var t) && nowMs - t < RepeatGuardMs) continue;
            _lastFired[action] = nowMs;
            (fired ??= new List<PadAction>()).Add(action);
        }
        return (IReadOnlyList<PadAction>?)fired ?? Array.Empty<PadAction>();
    }

    private static int BitCount(PadButtons b) => System.Numerics.BitOperations.PopCount((uint)b);
}
