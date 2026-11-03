using NAudio.CoreAudioApi;

namespace PcClipper.App.Platform;

public sealed record AudioDeviceInfo(string Id, string Name, bool IsDefault);

/// <summary>Audio device lists for the Settings page.</summary>
public static class AudioDevices
{
    /// <summary>Active recording devices, default first. Empty list (never throws) if enumeration fails.</summary>
    /// <remarks>
    /// "Default" is the Windows default recording device (Role.Console - the "Default Device", not the "Default
    /// Communication Device"), the same one <see cref="WasapiAudioSource"/> uses when no microphone is chosen. The COM work runs on a thread-pool thread (never the UI's STA thread) with a 5 s limit.
    /// </remarks>
    public static IReadOnlyList<AudioDeviceInfo> Microphones()
    {
        try
        {
            return WasapiAudioSource.RunOffUiThread<IReadOnlyList<AudioDeviceInfo>>(() =>
            {
                using var en = new MMDeviceEnumerator();
                string? defaultId = null;
                try
                {
                    if (en.HasDefaultAudioEndpoint(DataFlow.Capture, Role.Console))
                    {
                        using var d = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
                        defaultId = d.ID;
                    }
                }
                catch (Exception) { /* no default: none is marked */ }

                var list = new List<AudioDeviceInfo>();
                foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
                {
                    try
                    {
                        string id = dev.ID;
                        string name;
                        try { name = dev.FriendlyName; } catch { name = "Microphone"; }
                        list.Add(new AudioDeviceInfo(id, name, id == defaultId));
                    }
                    catch (Exception) { /* a device that vanished mid-enumeration */ }
                    finally { dev.Dispose(); }
                }
                return list.OrderByDescending(d => d.IsDefault).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
            }, 5000, "listing microphones");
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("Microphones could not be listed: " + ex.Message);
            return Array.Empty<AudioDeviceInfo>();
        }
    }
}
