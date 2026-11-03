using System.Runtime.InteropServices;
using PcClipper.Core;

namespace PcClipper.App.Platform;

public enum HotkeyAction { SaveReplay, ToggleRecording, Screenshot, ToggleReplay }

/// <summary>Global hotkeys via RegisterHotKey on a message-only window. Create and use on the UI thread.</summary>
/// <remarks>
/// <para>RegisterHotKey only works for a window created by the calling thread, and WM_HOTKEY is posted to that window, so
/// the hidden message-only window (parent HWND_MESSAGE: no taskbar entry, never shown, no broadcasts) belongs to the UI
/// thread. Calls from another thread are marshalled to it. MOD_NOREPEAT: holding the keys down fires once.</para>
/// <para>Error 1409 (ERROR_HOTKEY_ALREADY_REGISTERED) means another app registered the same combination. Overlays that read
/// keys through hooks instead (some GPU overlays, Discord) don't cause an error: both apps react.</para>
/// <para>NEVER show or activate a normal window from <see cref="Pressed"/>: a hotkey gives this process the foreground right,
/// so Activate() would pull focus from the game (and can minimize an exclusive-fullscreen game). Only start work and show
/// the non-activating toast. A game that registers raw input with RIDEV_NOHOTKEYS disables all app hotkeys while it has
/// focus; nothing can be done about that.</para>
/// </remarks>
public sealed class HotkeyManager : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const int ERROR_HOTKEY_ALREADY_REGISTERED = 1409;
    private const uint MOD_ALT = 0x0001, MOD_CONTROL = 0x0002, MOD_SHIFT = 0x0004, MOD_WIN = 0x0008, MOD_NOREPEAT = 0x4000;
    private static readonly IntPtr HWND_MESSAGE = new(-3);

    private readonly MessageWindow _window;
    private readonly SynchronizationContext? _ui;
    private readonly int _ownerThread;
    private readonly HashSet<int> _registeredIds = new();
    private bool _disposed;

    public HotkeyManager()
    {
        _ui = SynchronizationContext.Current;
        _ownerThread = Environment.CurrentManagedThreadId;
        _window = new MessageWindow(this);
        try
        {
            _window.CreateHandle(new CreateParams { Caption = "PC Clipper hotkeys", Parent = HWND_MESSAGE });
        }
        catch (Exception ex)
        {
            // Degrade: Register() then reports every hotkey as unavailable instead of the app failing to start.
            PlatformLog.Error("The hidden hotkey window could not be created", ex);
        }
    }

    /// <summary>Raised on the UI thread.</summary>
    public event Action<HotkeyAction>? Pressed;

    /// <summary>Unregisters everything, registers the assigned bindings, returns a plain-language error per action that failed.</summary>
    /// <remarks>Never throws: if hotkeys can't work at all, every assigned binding gets an error message.</remarks>
    public IReadOnlyDictionary<HotkeyAction, string> Register(IReadOnlyDictionary<HotkeyAction, HotkeyBinding> bindings)
    {
        try
        {
            if (Environment.CurrentManagedThreadId != _ownerThread && _ui is not null)
            {
                IReadOnlyDictionary<HotkeyAction, string>? result = null;
                _ui.Send(_ => result = RegisterOnOwnerThread(bindings), null);
                return result ?? AllFailed(bindings, "Hotkeys aren't available right now.");
            }
            return RegisterOnOwnerThread(bindings);
        }
        catch (Exception ex)
        {
            PlatformLog.Error("Registering hotkeys failed", ex);
            return AllFailed(bindings, "Hotkeys aren't available right now.");
        }
    }

    private static Dictionary<HotkeyAction, string> AllFailed(IReadOnlyDictionary<HotkeyAction, HotkeyBinding> bindings, string message) =>
        bindings.Where(kv => kv.Value is { IsAssigned: true }).ToDictionary(kv => kv.Key, _ => message);

    private IReadOnlyDictionary<HotkeyAction, string> RegisterOnOwnerThread(IReadOnlyDictionary<HotkeyAction, HotkeyBinding> bindings)
    {
        var errors = new Dictionary<HotkeyAction, string>();
        if (_disposed) return errors;
        if (_window.Handle == IntPtr.Zero)
            return AllFailed(bindings, "Hotkeys aren't available right now (Windows refused the hotkey window). Restart PC Clipper.");
        UnregisterAll();

        var taken = new Dictionary<(uint Mods, int Key), HotkeyAction>();
        foreach (var (action, binding) in bindings.OrderBy(kv => kv.Key))
        {
            if (binding is null || !binding.IsAssigned) continue;
            string text = Describe(binding);
            uint mods = (binding.Ctrl ? MOD_CONTROL : 0) | (binding.Alt ? MOD_ALT : 0) | (binding.Shift ? MOD_SHIFT : 0) | (binding.Win ? MOD_WIN : 0);
            var key = binding.KeyCode & 0xFF;

            bool highFKey = key >= (int)Keys.F13 && key <= (int)Keys.F24;
            if (mods == 0 && !highFKey)
            {
                errors[action] = $"{text} needs Ctrl, Alt, Shift or Win with it, so normal typing isn't blocked. Pick another.";
                continue;
            }
            if (taken.TryGetValue((mods, key), out var other))
            {
                errors[action] = $"{text} is already used for \"{ActionLabel(other)}\". Pick another.";
                continue;
            }

            int id = IdFor(action);
            bool ok;
            int err = 0;
            try
            {
                ok = RegisterHotKey(_window.Handle, id, mods | MOD_NOREPEAT, (uint)key);
                if (!ok) err = Marshal.GetLastWin32Error();
            }
            catch (Exception ex)
            {
                PlatformLog.Error($"RegisterHotKey({text}) threw", ex);
                ok = false;
                err = -1;
            }

            if (ok)
            {
                _registeredIds.Add(id);
                taken[(mods, key)] = action;
                PlatformLog.Info($"Hotkey {text} -> {action}");
            }
            else if (err == ERROR_HOTKEY_ALREADY_REGISTERED)
            {
                errors[action] = $"{text} is already used by another app{OwnerHint(binding)}. Pick another.";
            }
            else
            {
                errors[action] = $"{text} couldn't be set up (Windows error {err}). Pick another.";
            }
        }
        return errors;
    }

    /// <summary>"Ctrl+Alt+F10" style text; "Not set" when unassigned.</summary>
    public static string Describe(HotkeyBinding binding)
    {
        if (binding is null || !binding.IsAssigned) return "Not set";
        var parts = new List<string>(5);
        if (binding.Ctrl) parts.Add("Ctrl");
        if (binding.Alt) parts.Add("Alt");
        if (binding.Shift) parts.Add("Shift");
        if (binding.Win) parts.Add("Win");
        parts.Add(KeyName(binding.KeyCode));
        return string.Join("+", parts);
    }

    /// <summary>Readable name of a virtual-key code ("F9", "A", "7", "Num 4", "PageDown"; layout characters for OEM keys).</summary>
    public static string KeyName(int keyCode)
    {
        var k = (Keys)(keyCode & 0xFF);
        if (k >= Keys.D0 && k <= Keys.D9) return ((char)('0' + (k - Keys.D0))).ToString();
        if (k >= Keys.NumPad0 && k <= Keys.NumPad9) return "Num " + (k - Keys.NumPad0);
        if (k >= Keys.A && k <= Keys.Z) return k.ToString();
        if (k >= Keys.F1 && k <= Keys.F24) return k.ToString();
        switch (k)
        {
            case Keys.Next: return "PageDown";
            case Keys.Prior: return "PageUp";
            case Keys.Snapshot: return "PrintScreen";
            case Keys.Scroll: return "ScrollLock";
            case Keys.Pause: return "Pause";
            case Keys.Insert: return "Insert";
            case Keys.Delete: return "Delete";
            case Keys.Home: return "Home";
            case Keys.End: return "End";
            case Keys.Up: return "Up";
            case Keys.Down: return "Down";
            case Keys.Left: return "Left";
            case Keys.Right: return "Right";
            case Keys.Space: return "Space";
            case Keys.Return: return "Enter";
            case Keys.Tab: return "Tab";
            case Keys.Back: return "Backspace";
            case Keys.Escape: return "Esc";
            case Keys.Multiply: return "Num *";
            case Keys.Add: return "Num +";
            case Keys.Subtract: return "Num -";
            case Keys.Divide: return "Num /";
            case Keys.Decimal: return "Num .";
        }
        if (k >= Keys.Oem1 && k <= Keys.Oem102 || k == Keys.Oemplus || k == Keys.Oemcomma || k == Keys.OemMinus || k == Keys.OemPeriod)
        {
            // The character this key types on the current keyboard layout (e.g. "ß" or "´" on German keyboards).
            try
            {
                uint ch = MapVirtualKeyW((uint)k, MAPVK_VK_TO_CHAR) & 0x7FFF; // high bit = dead key
                if (ch > ' ') return char.ToUpperInvariant((char)ch).ToString();
            }
            catch (Exception) { /* fall back to the US names below */ }
            return k switch
            {
                Keys.Oemtilde => "`",
                Keys.OemMinus => "-",
                Keys.Oemplus => "=",
                Keys.OemOpenBrackets => "[",
                Keys.OemCloseBrackets => "]",
                Keys.OemPipe => "\\",
                Keys.OemSemicolon => ";",
                Keys.OemQuotes => "'",
                Keys.Oemcomma => ",",
                Keys.OemPeriod => ".",
                Keys.OemQuestion => "/",
                Keys.OemBackslash => "\\",
                _ => k.ToString(),
            };
        }
        return k.ToString();
    }

    private static int IdFor(HotkeyAction action) => 1 + (int)action; // application ids must be 0x0000..0xBFFF

    private static string ActionLabel(HotkeyAction a) => a switch
    {
        HotkeyAction.SaveReplay => "Save the replay",
        HotkeyAction.ToggleRecording => "Start/stop recording",
        HotkeyAction.Screenshot => "Screenshot",
        _ => "Turn replay on/off",
    };

    /// <summary>A guess at who owns a taken combination, for the error message.</summary>
    private static string OwnerHint(HotkeyBinding b)
    {
        var k = (Keys)(b.KeyCode & 0xFF);
        if (b.Alt && !b.Ctrl && !b.Shift && !b.Win && k >= Keys.F1 && k <= Keys.F12) return " (probably the NVIDIA overlay)";
        if (b.Ctrl && b.Shift && !b.Alt && !b.Win && k >= Keys.A && k <= Keys.Z) return " (probably AMD Software)";
        if (b.Win && b.Alt) return " (probably the Xbox Game Bar)";
        return "";
    }

    private void UnregisterAll()
    {
        foreach (int id in _registeredIds)
        {
            try { UnregisterHotKey(_window.Handle, id); } catch { }
        }
        _registeredIds.Clear();
    }

    private void OnHotkey(int id)
    {
        foreach (HotkeyAction action in Enum.GetValues<HotkeyAction>())
        {
            if (IdFor(action) != id || !_registeredIds.Contains(id)) continue;
            try { Pressed?.Invoke(action); }
            catch (Exception ex)
            {
                // Don't let a handler error reach WinForms' crash dialog: a message box would take focus from the game.
                PlatformLog.Error($"Hotkey handler for {action} failed", ex);
            }
            return;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        void Destroy()
        {
            UnregisterAll();
            try { _window.DestroyHandle(); } catch { }
        }
        if (Environment.CurrentManagedThreadId != _ownerThread && _ui is not null)
        {
            try { _ui.Post(_ => Destroy(), null); } catch { }
        }
        else Destroy();
    }

    private sealed class MessageWindow : NativeWindow
    {
        private readonly HotkeyManager _owner;
        public MessageWindow(HotkeyManager owner) => _owner = owner;

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY)
            {
                _owner.OnHotkey((int)(long)m.WParam);
                return;
            }
            base.WndProc(ref m);
        }
    }

    private const uint MAPVK_VK_TO_CHAR = 2;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKeyW(uint uCode, uint uMapType);
}
