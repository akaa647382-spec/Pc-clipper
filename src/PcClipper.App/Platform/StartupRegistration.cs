using Microsoft.Win32;

namespace PcClipper.App.Platform;

/// <summary>
/// "Start with Windows" through HKCU\Software\Microsoft\Windows\CurrentVersion\Run (no admin rights needed).
/// </summary>
/// <remarks>
/// <para>The value is <c>"C:\full\path\PC Clipper.exe" --minimized</c> with REAL quote characters (backslash-escaped
/// quotes in a Run value have been seen to crash Task Manager). The path is <see cref="Environment.ProcessPath"/>,
/// never Assembly.Location (empty in a single-file app). <see cref="RefreshPath"/> at every launch updates it if the exe
/// was moved, and never touches anything else.</para>
/// <para>Task Manager / Settings "disable" does not delete the Run value; it writes a flag under
/// ...\Explorer\StartupApproved\Run (first byte odd = disabled). <see cref="ReadState"/> reads that flag so the checkbox
/// shows the truth. Only the user ticking our checkbox (<see cref="Apply"/>(true)) deletes that flag (the format is
/// undocumented, deleting is safe) - never a launch, or a "Disabled" choice made in Task Manager would be undone.</para>
/// </remarks>
public static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private const string ValueName = "PC Clipper";

    /// <summary>The exact command written to the Run key.</summary>
    public static string Command => $"\"{ExePath}\" --minimized";

    private static string ExePath =>
        Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "PC Clipper.exe");

    /// <summary>Add/remove HKCU\...\Run "PC Clipper" = "&lt;exe&gt;" --minimized.</summary>
    /// <exception cref="InvalidOperationException">Windows refused the change (plain-language message; already logged).</exception>
    public static void Apply(bool enabled)
    {
        try
        {
            using var run = Registry.CurrentUser.CreateSubKey(RunKey, writable: true)
                            ?? throw new InvalidOperationException("the Run key could not be opened");
            if (enabled)
            {
                if (run.GetValue(ValueName) as string != Command)
                    run.SetValue(ValueName, Command, RegistryValueKind.String);
                // Clear a "disabled in Task Manager" flag so ticking the box really turns it on.
                try
                {
                    using var approved = Registry.CurrentUser.OpenSubKey(ApprovedKey, writable: true);
                    approved?.DeleteValue(ValueName, throwOnMissingValue: false);
                }
                catch (Exception ex)
                {
                    PlatformLog.Warn("Could not clear the Task Manager startup flag: " + ex.Message);
                }
            }
            else
            {
                run.DeleteValue(ValueName, throwOnMissingValue: false);
            }
        }
        catch (Exception ex)
        {
            PlatformLog.Error($"Start with Windows could not be {(enabled ? "turned on" : "turned off")}", ex);
            throw new InvalidOperationException(
                $"Windows didn't let PC Clipper {(enabled ? "add itself to" : "remove itself from")} the start-up list ({ex.Message}).", ex);
        }
    }

    /// <summary>True when our Run value exists and is not disabled in Task Manager. False on any error.</summary>
    public static bool IsEnabled() => ReadState() ?? false;

    /// <summary>
    /// True when our Run value exists and is not disabled in Task Manager / Settings > Startup apps; false when it is
    /// missing or disabled; null when the registry could not be read (then nothing should be concluded).
    /// </summary>
    public static bool? ReadState()
    {
        try
        {
            using var run = Registry.CurrentUser.OpenSubKey(RunKey);
            if (run?.GetValue(ValueName) is not string) return false;
            using var approved = Registry.CurrentUser.OpenSubKey(ApprovedKey);
            return !(approved?.GetValue(ValueName) is byte[] b && b.Length > 0 && (b[0] & 1) == 1);
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("Could not read the start-up setting: " + ex.Message);
            return null;
        }
    }

    /// <summary>
    /// Updates the exe path in our Run value if the exe was moved. Only rewrites a value that already exists (a missing
    /// value means the user or a cleaner removed it) and never touches the Task Manager "disabled" flag.
    /// Returns true when the value was rewritten. Never throws.
    /// </summary>
    public static bool RefreshPath()
    {
        try
        {
            using var run = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (run?.GetValue(ValueName) is not string current || current == Command) return false;
            run.SetValue(ValueName, Command, RegistryValueKind.String);
            PlatformLog.Info("Start with Windows: updated the program path.");
            return true;
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("Could not update the start-with-Windows entry: " + ex.Message);
            return false;
        }
    }
}
